import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { type Program, type Idl } from "@coral-xyz/anchor";
import type { TriggeredVault, VaultAccountData } from "./scanner";
import { log } from "./logger";

/** Native SOL mint placeholder (PublicKey.default = all zeros) */
const NATIVE_SOL_MINT = PublicKey.default;

/** Result of an execution attempt */
export interface ExecutionResult {
  /** The vault PDA that was targeted */
  vaultPubkey: PublicKey;
  /** Whether the execution succeeded */
  success: boolean;
  /** Transaction signature (if submitted) */
  txSignature: string | undefined;
  /** Error message (if failed) */
  error: string | undefined;
  /** Whether execution was skipped due to profit threshold */
  skipped: boolean;
}

/** Maximum retry attempts for transaction submission */
const MAX_TX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1_500;

/** Base compute units per beneficiary for budget estimation */
const CU_PER_BENEFICIARY = 50_000;

/** Base compute units for the instruction itself */
const CU_BASE = 100_000;

/**
 * Sleep for a given number of milliseconds.
 *
 * @param ms - Duration to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Estimate the crank fee reward in lamports for executing a vault.
 *
 * Only considers the SOL portion of the vault (native SOL asset config).
 * SPL token crank fees are not converted to lamports for this estimate.
 *
 * @param vaultData - The deserialized vault account data
 * @returns Estimated crank fee in lamports (SOL portion only)
 */
function estimateCrankFeeLamports(vaultData: VaultAccountData): bigint {
  let totalSolLamports = BigInt(0);

  const numAssets = vaultData.numAssets;
  for (let i = 0; i < numAssets; i++) {
    const asset = vaultData.assetConfigs[i];
    // Native SOL is represented by PublicKey.default (all zeros)
    if (asset.mint.equals(NATIVE_SOL_MINT)) {
      totalSolLamports += BigInt(asset.amount.toString());
    }
  }

  // crankFeeBps is in basis points (1 bps = 0.01%)
  const feeLamports =
    (totalSolLamports * BigInt(vaultData.crankFeeBps)) / BigInt(10_000);

  return feeLamports;
}

/**
 * Build the list of remaining accounts required for the executeRedistribution instruction.
 *
 * For each active beneficiary:
 *   - Include the beneficiary wallet (writable, for SOL transfers)
 *
 * For each active SPL token asset:
 *   - Include the vault PDA's ATA (writable, source)
 *   - Include each beneficiary's ATA (writable, destination)
 *
 * @param vaultPubkey - The vault PDA address
 * @param vaultData - The deserialized vault account data
 * @returns Array of account metas for remaining accounts
 */
function buildRemainingAccounts(
  vaultPubkey: PublicKey,
  vaultData: VaultAccountData
): Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> {
  const remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }> = [];

  const beneficiaries = vaultData.beneficiaries.slice(
    0,
    vaultData.numBeneficiaries
  );
  const assets = vaultData.assetConfigs.slice(0, vaultData.numAssets);

  // Add all beneficiary wallets (writable for SOL transfers)
  for (const beneficiary of beneficiaries) {
    remainingAccounts.push({
      pubkey: beneficiary.wallet,
      isSigner: false,
      isWritable: true,
    });
  }

  // For each SPL token asset, add vault ATA + beneficiary ATAs
  for (const asset of assets) {
    if (asset.mint.equals(NATIVE_SOL_MINT)) {
      // Native SOL does not need ATAs
      continue;
    }

    // Vault PDA's ATA for this token mint (source)
    const vaultAta = getAssociatedTokenAddressSync(
      asset.mint,
      vaultPubkey,
      true // allowOwnerOffCurve = true for PDA
    );
    remainingAccounts.push({
      pubkey: vaultAta,
      isSigner: false,
      isWritable: true,
    });

    // Each beneficiary's ATA for this token mint (destination)
    for (const beneficiary of beneficiaries) {
      const beneficiaryAta = getAssociatedTokenAddressSync(
        asset.mint,
        beneficiary.wallet,
        false
      );
      remainingAccounts.push({
        pubkey: beneficiaryAta,
        isSigner: false,
        isWritable: true,
      });
    }
  }

  return remainingAccounts;
}

/**
 * Execute the redistribution for a single triggered vault.
 *
 * Builds the instruction with all required remaining accounts,
 * sends the transaction, and confirms it. Skips vaults where
 * the estimated crank fee falls below the minimum profit threshold.
 *
 * @param connection - Solana RPC connection
 * @param program - Anchor program instance for Deadswitch
 * @param crankKeypair - The crank bot's signing keypair
 * @param vault - The triggered vault to execute
 * @param minProfitLamports - Minimum SOL profit to proceed with execution
 * @returns Execution result with success/failure details
 */
export async function executeRedistribution(
  connection: Connection,
  program: Program<Idl>,
  crankKeypair: Keypair,
  vault: TriggeredVault,
  minProfitLamports: number
): Promise<ExecutionResult> {
  const vaultPubkey = vault.pubkey;
  const vaultLabel = vaultPubkey.toBase58().slice(0, 8) + "...";

  // Estimate profit before spending compute on transaction building
  const estimatedFee = estimateCrankFeeLamports(vault.data);
  if (estimatedFee < BigInt(minProfitLamports)) {
    log.info(
      `Skipping vault ${vaultLabel}: estimated fee ${estimatedFee} lamports < min ${minProfitLamports} lamports`
    );
    return {
      vaultPubkey,
      success: false,
      txSignature: undefined,
      error: `Below profit threshold (${estimatedFee} < ${minProfitLamports} lamports)`,
      skipped: true,
    };
  }

  log.info(
    `Executing redistribution for vault ${vaultLabel} (estimated fee: ${estimatedFee} lamports)`
  );

  // Build remaining accounts for beneficiaries and token ATAs
  const remainingAccounts = buildRemainingAccounts(vaultPubkey, vault.data);

  log.debug(
    `Vault ${vaultLabel}: ${vault.numBeneficiaries} beneficiaries, ${vault.numAssets} assets, ${remainingAccounts.length} remaining accounts`
  );

  // Calculate compute units needed
  const computeUnits = Math.min(
    CU_BASE + vault.numBeneficiaries * CU_PER_BENEFICIARY,
    1_400_000 // Solana max CU
  );

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_TX_RETRIES; attempt++) {
    try {
      // Build the instruction via Anchor
      const ix = await (program.methods as Record<string, (...args: unknown[]) => {
        accounts: (accounts: Record<string, PublicKey>) => {
          remainingAccounts: (accounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>) => {
            instruction: () => Promise<TransactionInstruction>;
          };
        };
      }>)["executeRedistribution"]()
        .accounts({
          crank: crankKeypair.publicKey,
          vault: vaultPubkey,
          owner: vault.owner,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      // Build the transaction with compute budget
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnits,
      });

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");

      const messageV0 = new TransactionMessage({
        payerKey: crankKeypair.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [computeBudgetIx, ix],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([crankKeypair]);

      // Send and confirm
      const txSignature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 2,
      });

      log.info(`Vault ${vaultLabel}: tx sent ${txSignature}, confirming...`);

      const confirmation = await connection.confirmTransaction(
        {
          signature: txSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction confirmed but failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      log.info(
        `Vault ${vaultLabel}: redistribution executed successfully (tx: ${txSignature})`
      );

      return {
        vaultPubkey,
        success: true,
        txSignature,
        error: undefined,
        skipped: false,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check for non-retryable errors
      const errorMsg = lastError.message.toLowerCase();
      const isNonRetryable =
        errorMsg.includes("insufficient funds") ||
        errorMsg.includes("account not found") ||
        errorMsg.includes("custom program error") ||
        errorMsg.includes("already been processed");

      if (isNonRetryable || attempt >= MAX_TX_RETRIES) {
        log.error(
          `Vault ${vaultLabel}: execution failed permanently: ${lastError.message}`
        );
        break;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      log.warn(
        `Vault ${vaultLabel}: attempt ${attempt}/${MAX_TX_RETRIES} failed, retrying in ${delayMs}ms: ${lastError.message}`
      );
      await sleep(delayMs);
    }
  }

  return {
    vaultPubkey,
    success: false,
    txSignature: undefined,
    error: lastError?.message ?? "Unknown error",
    skipped: false,
  };
}
