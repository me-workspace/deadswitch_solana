import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import BN from "bn.js";
import { Deadswitch } from "../packages/program/target/types/deadswitch";

/** PDA seeds */
const VAULT_SEED = Buffer.from("vault");

/**
 * Derive the vault PDA. Must match Rust seeds exactly.
 * Seeds: ["vault", owner, vault_id.to_le_bytes()]
 */
export function deriveVaultPDA(
  owner: PublicKey,
  vaultId: number,
  programId: PublicKey
): [PublicKey, number] {
  const vaultIdBuffer = new BN(vaultId).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), vaultIdBuffer],
    programId
  );
}

/** Airdrop SOL to a wallet and confirm */
export async function airdrop(
  connection: anchor.web3.Connection,
  to: PublicKey,
  amount: number = 10 * LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await connection.requestAirdrop(to, amount);
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({
    signature: sig,
    ...latestBlockhash,
  });
}

/** Create a funded keypair */
export async function createFundedKeypair(
  connection: anchor.web3.Connection,
  lamports: number = 10 * LAMPORTS_PER_SOL
): Promise<Keypair> {
  const kp = Keypair.generate();
  await airdrop(connection, kp.publicKey, lamports);
  return kp;
}

/** Days to seconds */
export function daysToSeconds(days: number): number {
  return days * 86_400;
}

/** Default valid beneficiary input for tests */
export function makeBeneficiary(
  wallet: PublicKey,
  shareBps: number,
  name: string = "Beneficiary"
): { wallet: PublicKey; shareBps: number; name: string } {
  return { wallet, shareBps, name };
}

/** Default valid vault creation params */
export function defaultCreateVaultParams(
  beneficiaryWallet: PublicKey
): {
  vaultId: BN;
  name: string;
  note: string;
  inactivityWindow: BN;
  gracePeriod: BN;
  crankFeeBps: number;
  beneficiaries: { wallet: PublicKey; shareBps: number; name: string }[];
  solDepositLamports: BN;
} {
  return {
    vaultId: new BN(0),
    name: "Test Vault",
    note: "Test note",
    inactivityWindow: new BN(daysToSeconds(90)),
    gracePeriod: new BN(daysToSeconds(7)),
    crankFeeBps: 10,
    beneficiaries: [makeBeneficiary(beneficiaryWallet, 10_000, "Alice")],
    solDepositLamports: new BN(LAMPORTS_PER_SOL),
  };
}

/** Get the program instance */
export function getProgram(): Program<Deadswitch> {
  return anchor.workspace.Deadswitch as Program<Deadswitch>;
}

/** Get SOL balance for an account */
export async function getBalance(
  connection: anchor.web3.Connection,
  pubkey: PublicKey
): Promise<number> {
  return connection.getBalance(pubkey);
}

/** Create an SPL token mint for testing */
export async function createTestMint(
  connection: anchor.web3.Connection,
  payer: Keypair,
  decimals: number = 6
): Promise<PublicKey> {
  return createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    decimals
  );
}

/** Mint SPL tokens to a wallet */
export async function mintTestTokens(
  connection: anchor.web3.Connection,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: number
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    destination
  );
  await mintTo(connection, payer, mint, ata.address, payer, amount);
  return ata.address;
}

/** Common program IDs */
export { SystemProgram, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
