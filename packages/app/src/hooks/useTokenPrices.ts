"use client";

import useSWR from "swr";

/**
 * Fetcher for SWR.
 */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Price API error: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? json;
}

/** Default prices as fallback (SOL, USDC, USDT) */
const DEFAULT_PRICES: Record<string, number> = {
  SOL: 0,
  USDC: 1,
  USDT: 1,
};

/**
 * Hook to fetch token prices from the API.
 * Refreshes every 60 seconds.
 *
 * @returns {{ prices: Record<string, number>, isLoading: boolean }}
 */
export function useTokenPrices() {
  const { data, isLoading } = useSWR<Record<string, number>>(
    "/api/prices",
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
      fallbackData: DEFAULT_PRICES,
    }
  );

  return {
    prices: data ?? DEFAULT_PRICES,
    isLoading,
  };
}
