"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, type Idl } from "@coral-xyz/anchor";
import idl from "@/lib/solana/idl/deadswitch.json";

/** Deadswitch program ID */
const PROGRAM_ID = new PublicKey("14S2ouXUde99HRRrSmMUcqMCUpMkd2NngjMmnz21mXKh");

/**
 * Hook to create an Anchor Program instance for the Deadswitch program.
 * Returns null for program if wallet is not connected.
 *
 * @returns {{ program: Program | null, connection: Connection, programId: PublicKey }}
 */
export function useDeadswitchProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null;
    }

    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      },
      { commitment: "confirmed" }
    );

    return new Program(idl as Idl, provider);
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  return { program, connection, programId: PROGRAM_ID };
}
