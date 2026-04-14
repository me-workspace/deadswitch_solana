import { PublicKey } from "@solana/web3.js";
import { BN, type Program, type Idl } from "@coral-xyz/anchor";
import { log } from "./logger";

/** Deserialized vault data returned by the scanner */
export interface TriggeredVault {
  /** Vault account public key (PDA) */
  pubkey: PublicKey;
  /** Owner of the vault */
  owner: PublicKey;
  /** Vault ID (u64) */
  vaultId: BN;
  /** Number of active beneficiaries */
  numBeneficiaries: number;
  /** Number of active asset configs */
  numAssets: number;
  /** Crank fee in basis points */
  crankFeeBps: number;
  /** Raw deserialized vault account data */
  data: VaultAccountData;
}

/** Raw vault account fields as deserialized by Anchor */
export interface VaultAccountData {
  owner: PublicKey;
  vaultId: BN;
  bump: number;
  heartbeatAuthority: PublicKey;
  inactivityWindow: BN;
  gracePeriod: BN;
  crankFeeBps: number;
  status: { active: Record<string, never> } | { executed: Record<string, never> } | { cancelled: Record<string, never> };
  lastActivity: BN;
  createdAt: BN;
  updatedAt: BN;
  name: number[];
  note: number[];
  numBeneficiaries: number;
  numAssets: number;
  beneficiaries: Array<{
    wallet: PublicKey;
    shareBps: number;
    name: number[];
  }>;
  assetConfigs: Array<{
    mint: PublicKey;
    amount: BN;
  }>;
}

/** Maximum retry attempts for RPC calls */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1_000;

/**
 * Check whether the vault status is "active" from the Anchor enum representation.
 *
 * @param status - The Anchor-deserialized status enum variant
 * @returns True if the vault is in Active state
 */
function isActiveStatus(
  status: VaultAccountData["status"]
): boolean {
  return "active" in status;
}

/**
 * Determine whether a vault is eligible for execution based on timing.
 *
 * A vault is triggered when: `currentTime >= lastActivity + inactivityWindow + gracePeriod`
 *
 * @param lastActivity - Unix timestamp of last heartbeat / activity
 * @param inactivityWindow - Required inactivity duration in seconds
 * @param gracePeriod - Additional grace period in seconds
 * @param currentTime - Current unix timestamp in seconds
 * @returns True if the vault can be executed
 */
function isExecutable(
  lastActivity: BN,
  inactivityWindow: BN,
  gracePeriod: BN,
  currentTime: number
): boolean {
  const triggerTime = lastActivity.add(inactivityWindow).add(gracePeriod);
  return new BN(currentTime).gte(triggerTime);
}

/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms - Duration to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async operation with exponential backoff retry.
 *
 * @param operation - The async function to retry
 * @param label - Label for log messages
 * @returns The result of the operation
 * @throws The last error after all retries are exhausted
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log.warn(
          `${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delayMs}ms: ${lastError.message}`
        );
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Scan all program-owned vault accounts and return those eligible for execution.
 *
 * Uses `getProgramAccounts` with a memcmp filter on the status byte to only
 * fetch Active vaults, then checks timing to identify triggered ones.
 *
 * @param program - The Anchor program instance for Deadswitch
 * @param programId - The Deadswitch program public key
 * @returns Array of triggered vaults ready for redistribution
 */
export async function scanTriggeredVaults(
  program: Program<Idl>,
  _programId: PublicKey
): Promise<TriggeredVault[]> {
  const currentTime = Math.floor(Date.now() / 1_000);

  log.debug("Fetching all vault accounts from program...");

  const allVaults = await withRetry(async () => {
    // Fetch all accounts of type "vault" via the Anchor program
    // The Anchor coder handles deserialization
    const accounts = await (program.account as Record<string, {
      all: () => Promise<Array<{ publicKey: PublicKey; account: VaultAccountData }>>;
    }>)["vault"].all();
    return accounts;
  }, "getProgramAccounts");

  log.info(`Fetched ${allVaults.length} total vault accounts`);

  const triggered: TriggeredVault[] = [];
  let activeCount = 0;

  for (const { publicKey, account } of allVaults) {
    // Skip non-active vaults
    if (!isActiveStatus(account.status)) {
      continue;
    }

    activeCount++;

    // Check if timing conditions are met for execution
    if (
      isExecutable(
        account.lastActivity,
        account.inactivityWindow,
        account.gracePeriod,
        currentTime
      )
    ) {
      triggered.push({
        pubkey: publicKey,
        owner: account.owner,
        vaultId: account.vaultId,
        numBeneficiaries: account.numBeneficiaries,
        numAssets: account.numAssets,
        crankFeeBps: account.crankFeeBps,
        data: account,
      });
    }
  }

  log.info(
    `Scan complete: ${activeCount} active vaults, ${triggered.length} triggered`
  );

  return triggered;
}
