import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * Verify that a wallet signed a specific message.
 *
 * @param walletPubkey - Base58-encoded Solana public key
 * @param message - The plaintext message that was signed
 * @param signatureBase64 - The base64-encoded signature
 * @returns True if the signature is valid for this pubkey and message
 */
export function verifyWalletSignature(
  walletPubkey: string,
  message: string,
  signatureBase64: string
): boolean {
  try {
    const pubkey = new PublicKey(walletPubkey);
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Buffer.from(signatureBase64, "base64");
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes());
  } catch {
    return false;
  }
}

/**
 * Extract and validate auth header: "Wallet <pubkey>:<signature>:<message>"
 *
 * @param authHeader - The raw Authorization header value
 * @returns Parsed pubkey and verification result, or null if header is invalid
 */
export function extractWalletAuth(authHeader: string | null): {
  pubkey: string;
  verified: boolean;
} | null {
  if (!authHeader?.startsWith("Wallet ")) return null;
  const parts = authHeader.slice(7).split(":");
  if (parts.length !== 3) return null;
  const [pubkey, signature, message] = parts;
  return {
    pubkey,
    verified: verifyWalletSignature(pubkey, message, signature),
  };
}
