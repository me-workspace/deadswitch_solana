"use client";

import useSWR from "swr";
import { useWallet } from "@solana/wallet-adapter-react";

/** Vault summary returned from the API */
export interface VaultSummary {
  pubkey: string;
  owner: string;
  vaultId: number;
  name: string;
  note: string;
  displayStatus: "active" | "warning" | "triggered" | "executed" | "cancelled";
  onchainStatus: number;
  beneficiaryCount: number;
  inactivityWindowDays: number;
  gracePeriodDays: number;
  crankFeeBps: number;
  lastActivityTimestamp: number;
  createdAtTimestamp: number;
  daysElapsed: number;
  daysRemaining: number;
  progressPercent: number;
  totalValueUsd: number;
  assets: Array<{
    mint: string;
    symbol: string;
    amount: string;
    uiAmount: number;
    valueUsd: number;
  }>;
  beneficiaries: Array<{
    wallet: string;
    shareBps: number;
    name: string;
  }>;
}

/**
 * Fetcher for SWR. Returns parsed JSON or throws on HTTP error.
 */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body || res.statusText}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

/**
 * Hook to fetch the connected wallet's vaults from the API.
 * Auto-refreshes every 30 seconds. Returns empty array if wallet disconnected.
 *
 * @returns {{ vaults: VaultSummary[], isLoading: boolean, error: Error | undefined, mutate: Function }}
 */
export function useVaults() {
  const { publicKey, connected } = useWallet();

  const key = connected && publicKey
    ? `/api/vaults?owner=${publicKey.toBase58()}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<VaultSummary[]>(
    key,
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    }
  );

  return {
    vaults: data ?? [],
    isLoading: connected ? isLoading : false,
    error,
    mutate,
  };
}
