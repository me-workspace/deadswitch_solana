"use client";

import useSWR from "swr";

/** Activity log entry for a vault */
export interface ActivityEntry {
  id: string;
  txSignature: string;
  activityType: "heartbeat" | "manual" | "creation" | "update" | "top_up" | "execution" | "cancellation";
  description: string | null;
  recordedAt: string;
}

/** Asset in vault detail */
export interface VaultAsset {
  mint: string;
  symbol: string;
  amount: string;
  uiAmount: number;
  decimals: number;
  valueUsd: number;
}

/** Beneficiary in vault detail */
export interface VaultBeneficiary {
  wallet: string;
  shareBps: number;
  name: string;
  estimatedUsd: number;
}

/** Full vault detail from API */
export interface VaultDetail {
  pubkey: string;
  owner: string;
  vaultId: number;
  name: string;
  note: string;
  displayStatus: "active" | "warning" | "triggered" | "executed" | "cancelled";
  onchainStatus: number;
  inactivityWindowDays: number;
  gracePeriodDays: number;
  crankFeeBps: number;
  lastActivityTimestamp: number;
  createdAtTimestamp: number;
  updatedAtTimestamp: number;
  daysElapsed: number;
  daysRemaining: number;
  progressPercent: number;
  totalValueUsd: number;
  assets: VaultAsset[];
  beneficiaries: VaultBeneficiary[];
  activityLog: ActivityEntry[];
}

/**
 * Fetcher for SWR.
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
 * Hook to fetch a single vault's details from the API.
 * Auto-refreshes every 15 seconds.
 *
 * @param vaultId - Vault public key string, or null/undefined to skip
 * @returns {{ vault: VaultDetail | undefined, isLoading: boolean, error: Error | undefined, mutate: Function }}
 */
export function useVaultDetail(vaultId: string | null | undefined) {
  const key = vaultId ? `/api/vaults/${vaultId}` : null;

  const { data, error, isLoading, mutate } = useSWR<VaultDetail>(
    key,
    fetcher,
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
      dedupingInterval: 3_000,
    }
  );

  return {
    vault: data,
    isLoading,
    error,
    mutate,
  };
}
