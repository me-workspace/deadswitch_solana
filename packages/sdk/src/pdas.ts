import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { VAULT_SEED } from "./constants";

/**
 * Derive the vault PDA address.
 *
 * Seeds: ["vault", owner, vault_id.to_le_bytes()]
 *
 * This is THE single source of truth for PDA derivation.
 * Must match Rust: seeds = [VAULT_SEED, owner.key().as_ref(), &vault_id.to_le_bytes()]
 */
export function deriveVaultPDA(
  owner: PublicKey,
  vaultId: number | BN,
  programId: PublicKey
): [PublicKey, number] {
  const vaultIdBN = typeof vaultId === "number" ? new BN(vaultId) : vaultId;
  const vaultIdBuffer = vaultIdBN.toArrayLike(Buffer, "le", 8);

  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, owner.toBuffer(), vaultIdBuffer],
    programId
  );
}
