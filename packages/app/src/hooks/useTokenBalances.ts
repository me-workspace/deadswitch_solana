"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from "@solana/spl-token";

/** A single token balance entry */
export interface TokenBalance {
  mint: string;
  symbol: string;
  amount: bigint;
  decimals: number;
  uiAmount: number;
}

/** Devnet SPL token mints */
const DEVNET_TOKENS: Array<{ mint: PublicKey; symbol: string; decimals: number }> = [
  {
    mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    symbol: "USDC",
    decimals: 6,
  },
  {
    mint: new PublicKey("EJwZgeZrdC8TXTQbQBoL6bfuAnFUQcWQoKjE2RwW5Qo5"),
    symbol: "USDT",
    decimals: 6,
  },
];

/**
 * Hook to fetch the connected wallet's SOL and SPL token balances.
 * Refreshes when wallet changes or on manual refetch.
 *
 * @returns {{ balances: TokenBalance[], isLoading: boolean, refetch: () => void }}
 */
export function useTokenBalances() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBalances = useCallback(async () => {
    if (!connected || !publicKey) {
      setBalances([]);
      return;
    }

    setIsLoading(true);
    try {
      const results: TokenBalance[] = [];

      // Fetch SOL balance
      const solBalance = await connection.getBalance(publicKey);
      results.push({
        mint: PublicKey.default.toBase58(),
        symbol: "SOL",
        amount: BigInt(solBalance),
        decimals: 9,
        uiAmount: solBalance / LAMPORTS_PER_SOL,
      });

      // Fetch SPL token balances in parallel
      const tokenPromises = DEVNET_TOKENS.map(async (token) => {
        try {
          const ata = await getAssociatedTokenAddress(token.mint, publicKey);
          const account = await getAccount(connection, ata);
          const rawAmount = account.amount;
          const uiAmount = Number(rawAmount) / Math.pow(10, token.decimals);

          return {
            mint: token.mint.toBase58(),
            symbol: token.symbol,
            amount: rawAmount,
            decimals: token.decimals,
            uiAmount,
          };
        } catch (err) {
          // Token account doesn't exist — user has 0 of this token
          if (err instanceof TokenAccountNotFoundError || (err as Error)?.message?.includes("could not find")) {
            return {
              mint: token.mint.toBase58(),
              symbol: token.symbol,
              amount: BigInt(0),
              decimals: token.decimals,
              uiAmount: 0,
            };
          }
          // Re-throw unexpected errors
          console.warn(`Failed to fetch ${token.symbol} balance:`, err);
          return {
            mint: token.mint.toBase58(),
            symbol: token.symbol,
            amount: BigInt(0),
            decimals: token.decimals,
            uiAmount: 0,
          };
        }
      });

      const tokenResults = await Promise.all(tokenPromises);
      results.push(...tokenResults);

      setBalances(results);
    } catch (err) {
      console.error("Failed to fetch balances:", err);
      setBalances([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey, connected]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  return { balances, isLoading, refetch: fetchBalances };
}
