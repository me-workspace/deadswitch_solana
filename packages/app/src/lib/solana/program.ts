import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";
// IDL imported via relative path since @deadswitch/sdk doesn't export subpaths
import idlJson from "../../../../sdk/src/idl/deadswitch.json";

/** Wallet interface compatible with AnchorProvider (ESM doesn't export Wallet) */
interface AnchorWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

/** Program ID for the Deadswitch on-chain program */
export const PROGRAM_ID = new PublicKey(
  "14S2ouXUde99HRRrSmMUcqMCUpMkd2NngjMmnz21mXKh"
);

/**
 * Cached server-side Solana connection instance.
 * Reused within the same serverless invocation.
 */
let _connection: Connection | null = null;

/**
 * Get a server-side Solana RPC connection.
 * Reads `NEXT_PUBLIC_SOLANA_RPC_URL` for a custom RPC endpoint,
 * falling back to the public devnet/mainnet cluster URL.
 *
 * @returns A Solana Connection instance
 */
export function getConnection(): Connection {
  if (_connection) return _connection;

  const network =
    (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") ??
    "devnet";
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(network);

  _connection = new Connection(rpcUrl, {
    commitment: "confirmed",
  });

  return _connection;
}

/**
 * Parse the heartbeat authority private key from the environment.
 * The key is expected as a JSON array of bytes (Uint8Array format).
 *
 * @returns A Keypair for the heartbeat authority
 * @throws {Error} If the private key env var is not set or invalid
 */
export function getHeartbeatAuthority(): Keypair {
  const raw = process.env.HEARTBEAT_AUTHORITY_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "HEARTBEAT_AUTHORITY_PRIVATE_KEY environment variable is not set"
    );
  }

  try {
    const parsed = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    throw new Error(
      "HEARTBEAT_AUTHORITY_PRIVATE_KEY must be a JSON array of bytes, e.g. [1,2,3,...,64]"
    );
  }
}

/**
 * Create an Anchor Program instance for the Deadswitch program.
 * This uses a read-only provider (no wallet signing) suitable
 * for fetching account data from API routes.
 *
 * @returns Anchor Program instance with the Deadswitch IDL
 */
export function getReadonlyProgram(): Program<Idl> {
  const connection = getConnection();

  // Read-only provider — uses a dummy keypair.
  const dummyKeypair = Keypair.generate();
  const dummyWallet: AnchorWallet = {
    publicKey: dummyKeypair.publicKey,
    signTransaction: async () => {
      throw new Error("Read-only provider cannot sign");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only provider cannot sign");
    },
  };

  const provider = new AnchorProvider(connection, dummyWallet as any, {
    commitment: "confirmed",
  });

  return new Program(idlJson as Idl, provider);
}

/**
 * Create an Anchor Program instance with the heartbeat authority
 * as the signer. Used for submitting record_heartbeat transactions
 * from the backend (webhook handler).
 *
 * @returns Program instance with signing capability
 */
export function getSigningProgram(): {
  program: Program<Idl>;
  authority: Keypair;
} {
  const connection = getConnection();
  const authority = getHeartbeatAuthority();

  const wallet: AnchorWallet = {
    publicKey: authority.publicKey,
    signTransaction: async (tx) => {
      if ("partialSign" in tx) {
        (tx as Transaction).partialSign(authority);
      }
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => {
        if ("partialSign" in tx) {
          (tx as Transaction).partialSign(authority);
        }
      });
      return txs;
    },
  };

  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });

  const program = new Program(idlJson as Idl, provider);

  return { program, authority };
}
