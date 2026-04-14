import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { loadConfig, configSummary, type CrankConfig } from "./config";
import { scanTriggeredVaults } from "./scanner";
import { executeRedistribution, type ExecutionResult } from "./executor";
import { log, setLogLevel } from "./logger";

// Load the IDL at runtime to avoid rootDir/include constraints
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Load the Deadswitch IDL JSON from the SDK package.
 * Uses runtime file read to avoid TypeScript rootDir issues with JSON imports.
 *
 * @returns Parsed IDL object
 */
function loadIdl(): Idl {
  // Works in both compiled (dist/) and tsx dev mode
  const idlPath = resolve(__dirname, "../../sdk/src/idl/deadswitch.json");
  const raw = readFileSync(idlPath, "utf-8");
  return JSON.parse(raw) as Idl;
}

/** Track health metrics across cycles */
interface HealthMetrics {
  /** Timestamp when the bot started */
  startedAt: number;
  /** Timestamp of the last completed scan */
  lastScanAt: number;
  /** Total number of completed scan cycles */
  totalCycles: number;
  /** Total number of successfully executed vaults */
  totalExecuted: number;
  /** Total number of failed executions */
  totalFailed: number;
  /** Total number of skipped vaults (below profit threshold) */
  totalSkipped: number;
}

/** How often to log health metrics (every N cycles) */
const HEALTH_LOG_INTERVAL = 10;

/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms - Duration to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Format uptime from milliseconds to a human-readable string.
 *
 * @param ms - Uptime in milliseconds
 * @returns Formatted string like "2h 15m 30s"
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1_000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Log health metrics summary.
 *
 * @param metrics - Current health metrics
 */
function logHealth(metrics: HealthMetrics): void {
  const uptime = Date.now() - metrics.startedAt;
  const lastScanAgo = metrics.lastScanAt
    ? `${Math.floor((Date.now() - metrics.lastScanAt) / 1_000)}s ago`
    : "never";

  log.info(
    [
      "--- Health Check ---",
      `  Uptime:        ${formatUptime(uptime)}`,
      `  Total Cycles:  ${metrics.totalCycles}`,
      `  Last Scan:     ${lastScanAgo}`,
      `  Executed:      ${metrics.totalExecuted}`,
      `  Failed:        ${metrics.totalFailed}`,
      `  Skipped:       ${metrics.totalSkipped}`,
      "--------------------",
    ].join("\n")
  );
}

/**
 * Run a single scan-and-execute cycle.
 *
 * Scans for triggered vaults and attempts redistribution on each one.
 * Results are logged and metrics are updated. Never throws.
 *
 * @param connection - Solana RPC connection
 * @param program - Anchor program instance
 * @param config - Crank bot configuration
 * @param metrics - Mutable health metrics to update
 */
async function runCycle(
  connection: Connection,
  program: Program<Idl>,
  config: CrankConfig,
  metrics: HealthMetrics
): Promise<void> {
  log.info("Scanning for triggered vaults...");

  const triggeredVaults = await scanTriggeredVaults(
    program,
    config.programId
  );

  metrics.lastScanAt = Date.now();

  if (triggeredVaults.length === 0) {
    log.info("No triggered vaults found");
    return;
  }

  log.info(`Found ${triggeredVaults.length} triggered vault(s), executing...`);

  for (const vault of triggeredVaults) {
    const result: ExecutionResult = await executeRedistribution(
      connection,
      program,
      config.crankKeypair,
      vault,
      config.minProfitLamports
    );

    if (result.skipped) {
      metrics.totalSkipped++;
    } else if (result.success) {
      metrics.totalExecuted++;
      log.info(
        `Vault ${result.vaultPubkey.toBase58().slice(0, 8)}... executed: tx ${result.txSignature}`
      );
    } else {
      metrics.totalFailed++;
      log.error(
        `Vault ${result.vaultPubkey.toBase58().slice(0, 8)}... failed: ${result.error}`
      );
    }
  }
}

/**
 * Create the Anchor Program instance from the IDL and provider.
 *
 * @param connection - Solana RPC connection
 * @param crankKeypair - The crank wallet keypair (used as provider wallet)
 * @param programId - The Deadswitch program ID
 * @returns Configured Anchor Program instance
 */
function createProgram(
  connection: Connection,
  crankKeypair: Keypair,
  _programId: PublicKey
): Program<Idl> {
  // Anchor requires a Wallet interface, wrap the keypair
  const wallet = new Wallet(crankKeypair);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const idl = loadIdl();
  return new Program(idl, provider);
}

/**
 * Main entry point for the Deadswitch crank bot.
 *
 * Loads configuration, creates the Solana connection and Anchor program,
 * then enters an infinite scan-execute loop. Handles graceful shutdown
 * on SIGINT/SIGTERM. Never crashes — all errors are caught and logged.
 */
async function main(): Promise<void> {
  // Load and validate configuration — fail fast if invalid
  let config: CrankConfig;
  try {
    config = loadConfig();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FATAL] Configuration error:\n${message}`);
    process.exit(1);
  }

  setLogLevel(config.logLevel);

  log.info("=== Deadswitch Crank Bot Starting ===");
  log.info(`\n${configSummary(config)}`);

  // Create Solana connection
  const connection = new Connection(config.rpcUrl, {
    commitment: "confirmed",
  });

  // Verify RPC connectivity
  try {
    const version = await connection.getVersion();
    log.info(`Connected to Solana RPC (version: ${version["solana-core"]})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Failed to connect to RPC: ${message}`);
    log.error("Check SOLANA_RPC_URL and ensure the endpoint is reachable");
    process.exit(1);
  }

  // Create Anchor program
  const program = createProgram(
    connection,
    config.crankKeypair,
    config.programId
  );

  // Initialize health metrics
  const metrics: HealthMetrics = {
    startedAt: Date.now(),
    lastScanAt: 0,
    totalCycles: 0,
    totalExecuted: 0,
    totalFailed: 0,
    totalSkipped: 0,
  };

  // Graceful shutdown flag
  let shutdownRequested = false;

  const shutdown = (signal: string): void => {
    if (shutdownRequested) {
      log.warn("Force shutdown requested, exiting immediately");
      process.exit(1);
    }
    shutdownRequested = true;
    log.info(`${signal} received, shutting down gracefully...`);
    logHealth(metrics);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  log.info("Entering main loop...");

  // Main loop — scan, execute, sleep, repeat
  while (!shutdownRequested) {
    try {
      await runCycle(connection, program, config, metrics);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Cycle error (non-fatal): ${message}`);
    }

    metrics.totalCycles++;

    // Health check every N cycles
    if (metrics.totalCycles % HEALTH_LOG_INTERVAL === 0) {
      logHealth(metrics);
    }

    // Sleep until next scan (check shutdown flag periodically to allow prompt exit)
    const sleepEnd = Date.now() + config.scanIntervalMs;
    while (Date.now() < sleepEnd && !shutdownRequested) {
      await sleep(Math.min(1_000, sleepEnd - Date.now()));
    }
  }

  log.info("=== Deadswitch Crank Bot Stopped ===");
  process.exit(0);
}

// Start the bot
main();
