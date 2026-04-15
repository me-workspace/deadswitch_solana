import { Keypair, PublicKey } from "@solana/web3.js";
import { z } from "zod";


/**
 * Zod schema for crank bot environment variables.
 * Validates and coerces all required and optional configuration.
 */
const envSchema = z.object({
  /** Solana RPC endpoint URL */
  SOLANA_RPC_URL: z
    .string({ required_error: "SOLANA_RPC_URL is required" })
    .url("SOLANA_RPC_URL must be a valid URL"),

  /** Base58-encoded private key for the crank wallet */
  CRANK_WALLET_PRIVATE_KEY: z
    .string({ required_error: "CRANK_WALLET_PRIVATE_KEY is required" })
    .min(1, "CRANK_WALLET_PRIVATE_KEY cannot be empty"),

  /** Deadswitch program ID (base58 public key) */
  DEADSWITCH_PROGRAM_ID: z
    .string({ required_error: "DEADSWITCH_PROGRAM_ID is required" })
    .min(1, "DEADSWITCH_PROGRAM_ID cannot be empty"),

  /** How often to scan for triggered vaults (milliseconds) */
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  /** Minimum profit in lamports to execute a vault */
  MIN_PROFIT_LAMPORTS: z.coerce.number().int().nonnegative().default(10_000),

  /** Optional database URL for execution logging */
  DATABASE_URL: z.string().url().optional(),

  /** Logging verbosity */
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

/** Parsed and validated configuration */
export interface CrankConfig {
  /** Solana RPC endpoint URL */
  rpcUrl: string;
  /** Crank bot wallet keypair */
  crankKeypair: Keypair;
  /** Deadswitch program public key */
  programId: PublicKey;
  /** Scan interval in milliseconds */
  scanIntervalMs: number;
  /** Minimum profit threshold in lamports */
  minProfitLamports: number;
  /** Optional database URL for logging */
  databaseUrl: string | undefined;
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * Load and validate environment configuration.
 *
 * Reads from `process.env`, validates with Zod, parses the private key
 * into a Keypair, and the program ID into a PublicKey.
 *
 * @returns Fully validated crank configuration
 * @throws {Error} If any required env var is missing or invalid
 */
export function loadConfig(): CrankConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid crank configuration:\n${issues}`);
  }

  const env = result.data;

  // Parse the private key into a Keypair
  // Supports JSON byte array [1,2,3,...] or base64 encoded string
  let crankKeypair: Keypair;
  try {
    const keyStr = env.CRANK_WALLET_PRIVATE_KEY.trim();
    let secretKey: Uint8Array;
    if (keyStr.startsWith("[")) {
      // JSON byte array format
      secretKey = Uint8Array.from(JSON.parse(keyStr) as number[]);
    } else {
      // Base64 encoded format
      secretKey = Uint8Array.from(Buffer.from(keyStr, "base64"));
    }
    crankKeypair = Keypair.fromSecretKey(secretKey);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse CRANK_WALLET_PRIVATE_KEY (JSON array or base64): ${message}`
    );
  }

  // Parse the program ID
  let programId: PublicKey;
  try {
    programId = new PublicKey(env.DEADSWITCH_PROGRAM_ID);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse DEADSWITCH_PROGRAM_ID as a valid PublicKey: ${message}`
    );
  }

  return {
    rpcUrl: env.SOLANA_RPC_URL,
    crankKeypair,
    programId,
    scanIntervalMs: env.SCAN_INTERVAL_MS,
    minProfitLamports: env.MIN_PROFIT_LAMPORTS,
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
  };
}

/**
 * Return a safe summary of the config for logging (no secrets).
 *
 * @param config - The crank configuration
 * @returns Human-readable config summary
 */
export function configSummary(config: CrankConfig): string {
  const rpcDomain = new URL(config.rpcUrl).hostname;
  return [
    `RPC:            ${rpcDomain}`,
    `Program ID:     ${config.programId.toBase58()}`,
    `Crank Wallet:   ${config.crankKeypair.publicKey.toBase58()}`,
    `Scan Interval:  ${config.scanIntervalMs}ms`,
    `Min Profit:     ${config.minProfitLamports} lamports`,
    `Log Level:      ${config.logLevel}`,
    `Database:       ${config.databaseUrl ? "configured" : "none"}`,
  ].join("\n");
}
