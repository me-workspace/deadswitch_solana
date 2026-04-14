import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";
import { getReadonlyProgram, getSigningProgram, PROGRAM_ID } from "./program";
import { deriveVaultPDA, NATIVE_SOL_MINT } from "@deadswitch/sdk";

// ---------------------------------------------------------------------------
// Types for instruction builders
// ---------------------------------------------------------------------------

/** Beneficiary input for vault creation / update */
export interface BeneficiaryInput {
  wallet: PublicKey;
  shareBps: number;
  name: string;
}

/** SPL token deposit for top-up */
export interface SplDepositInput {
  mint: PublicKey;
  amount: BN;
}

/** Parameters for creating a new vault */
export interface CreateVaultParams {
  /** Vault owner public key (the signer) */
  owner: PublicKey;
  /** Unique vault ID for this owner */
  vaultId: BN;
  /** Human-readable vault name (max 64 chars) */
  name: string;
  /** Optional note (max 256 chars) */
  note: string;
  /** Inactivity window in seconds */
  inactivityWindow: BN;
  /** Grace period in seconds */
  gracePeriod: BN;
  /** Crank fee in basis points */
  crankFeeBps: number;
  /** List of beneficiaries */
  beneficiaries: BeneficiaryInput[];
  /** Initial SOL deposit in lamports */
  solDepositLamports: BN;
  /** Heartbeat authority public key */
  heartbeatAuthority: PublicKey;
}

/** Parameters for updating a vault */
export interface UpdateVaultParams {
  name?: string;
  note?: string;
  inactivityWindow?: BN;
  gracePeriod?: BN;
  crankFeeBps?: number;
  beneficiaries?: BeneficiaryInput[];
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/**
 * Build a transaction to create a new vault.
 * The returned transaction is unsigned — the frontend must sign it
 * with the owner's wallet.
 *
 * @param params - Vault creation parameters
 * @returns An unsigned Transaction ready for the owner to sign
 */
export async function buildCreateVaultTx(
  params: CreateVaultParams
): Promise<Transaction> {
  const program = getReadonlyProgram();

  const [vaultPda] = deriveVaultPDA(
    params.owner,
    params.vaultId,
    PROGRAM_ID
  );

  const ix = await program.methods
    .createVault(
      params.vaultId,
      params.name,
      params.note,
      params.inactivityWindow,
      params.gracePeriod,
      params.crankFeeBps,
      params.beneficiaries.map((b) => ({
        wallet: b.wallet,
        shareBps: b.shareBps,
        name: b.name,
      })),
      params.solDepositLamports
    )
    .accounts({
      owner: params.owner,
      vault: vaultPda,
      heartbeatAuthority: params.heartbeatAuthority,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = params.owner;

  return tx;
}

/**
 * Build a transaction to record a heartbeat on a vault.
 * This is typically called by the backend with the heartbeat authority
 * keypair, but can also be signed by the vault owner directly.
 *
 * @param vaultPubkey - The vault PDA public key
 * @param authority - The heartbeat authority public key
 * @returns An unsigned Transaction
 */
export async function buildRecordHeartbeatTx(
  vaultPubkey: PublicKey,
  authority: PublicKey
): Promise<Transaction> {
  const program = getReadonlyProgram();

  const ix = await program.methods
    .recordHeartbeat()
    .accounts({
      authority,
      vault: vaultPubkey,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = authority;

  return tx;
}

/**
 * Build a transaction to update vault settings.
 * Only the vault owner can sign this transaction.
 *
 * @param vaultPubkey - The vault PDA public key
 * @param owner - The vault owner public key (signer)
 * @param updates - Fields to update (all optional)
 * @returns An unsigned Transaction
 */
export async function buildUpdateVaultTx(
  vaultPubkey: PublicKey,
  owner: PublicKey,
  updates: UpdateVaultParams
): Promise<Transaction> {
  const program = getReadonlyProgram();

  const ix = await program.methods
    .updateVault(
      updates.name ?? null,
      updates.note ?? null,
      updates.inactivityWindow ?? null,
      updates.gracePeriod ?? null,
      updates.crankFeeBps ?? null,
      updates.beneficiaries
        ? updates.beneficiaries.map((b) => ({
            wallet: b.wallet,
            shareBps: b.shareBps,
            name: b.name,
          }))
        : null
    )
    .accounts({
      owner,
      vault: vaultPubkey,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = owner;

  return tx;
}

/**
 * Build a transaction to top up a vault with SOL and/or SPL tokens.
 * Includes remaining accounts for the token ATAs.
 *
 * @param vaultPubkey - The vault PDA public key
 * @param owner - The vault owner public key (signer)
 * @param solAmount - SOL amount to deposit in lamports
 * @param splDeposits - Array of SPL token deposits
 * @returns An unsigned Transaction
 */
export async function buildTopUpVaultTx(
  vaultPubkey: PublicKey,
  owner: PublicKey,
  solAmount: BN,
  splDeposits: SplDepositInput[] = []
): Promise<Transaction> {
  const program = getReadonlyProgram();

  // Build remaining accounts for each SPL deposit:
  // For each token: [ownerATA, vaultATA, mint]
  const remainingAccounts: Array<{
    pubkey: PublicKey;
    isWritable: boolean;
    isSigner: boolean;
  }> = [];

  for (const deposit of splDeposits) {
    const ownerAta = getAssociatedTokenAddressSync(deposit.mint, owner);
    const vaultAta = getAssociatedTokenAddressSync(
      deposit.mint,
      vaultPubkey,
      true // allowOwnerOffCurve for PDA
    );

    remainingAccounts.push(
      { pubkey: ownerAta, isWritable: true, isSigner: false },
      { pubkey: vaultAta, isWritable: true, isSigner: false },
      { pubkey: deposit.mint, isWritable: false, isSigner: false }
    );
  }

  const builder = program.methods
    .topUpVault(
      solAmount,
      splDeposits.map((d) => ({
        mint: d.mint,
        amount: d.amount,
      }))
    )
    .accounts({
      owner,
      vault: vaultPubkey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    });

  if (remainingAccounts.length > 0) {
    builder.remainingAccounts(remainingAccounts);
  }

  const ix = await builder.instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = owner;

  return tx;
}

/**
 * Build a transaction to cancel a vault and return all assets
 * to the owner. Only the vault owner can sign this.
 *
 * @param vaultPubkey - The vault PDA public key
 * @param owner - The vault owner public key (signer)
 * @param assetMints - Array of SPL token mints held by the vault
 *   (needed to build remaining accounts for ATA cleanup)
 * @returns An unsigned Transaction
 */
export async function buildCancelVaultTx(
  vaultPubkey: PublicKey,
  owner: PublicKey,
  assetMints: PublicKey[] = []
): Promise<Transaction> {
  const program = getReadonlyProgram();

  // Build remaining accounts for each SPL asset:
  // For each token: [vaultATA, ownerATA, mint]
  const remainingAccounts: Array<{
    pubkey: PublicKey;
    isWritable: boolean;
    isSigner: boolean;
  }> = [];

  for (const mint of assetMints) {
    // Skip native SOL — handled by the program directly
    if (mint.equals(NATIVE_SOL_MINT)) continue;

    const vaultAta = getAssociatedTokenAddressSync(
      mint,
      vaultPubkey,
      true // PDA
    );
    const ownerAta = getAssociatedTokenAddressSync(mint, owner);

    remainingAccounts.push(
      { pubkey: vaultAta, isWritable: true, isSigner: false },
      { pubkey: ownerAta, isWritable: true, isSigner: false },
      { pubkey: mint, isWritable: false, isSigner: false }
    );
  }

  const builder = program.methods.cancelVault().accounts({
    owner,
    vault: vaultPubkey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  });

  if (remainingAccounts.length > 0) {
    builder.remainingAccounts(remainingAccounts);
  }

  const ix = await builder.instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = owner;

  return tx;
}

/**
 * Submit a record_heartbeat transaction signed by the backend
 * heartbeat authority keypair. Used by the webhook handler.
 *
 * @param vaultPubkey - The vault PDA public key
 * @returns The transaction signature
 */
export async function submitHeartbeatFromBackend(
  vaultPubkey: PublicKey
): Promise<string> {
  const { program, authority } = getSigningProgram();

  const txSignature = await program.methods
    .recordHeartbeat()
    .accounts({
      authority: authority.publicKey,
      vault: vaultPubkey,
    })
    .signers([authority])
    .rpc({ commitment: "confirmed" });

  return txSignature;
}
