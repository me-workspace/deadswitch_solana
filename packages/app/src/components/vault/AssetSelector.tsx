"use client";

import { AlertCircle } from "lucide-react";
import { cn, formatUsd } from "@/lib/utils";
import type { TokenBalance } from "@/hooks/useTokenBalances";

/** Asset deposit entry */
export interface AssetDeposit {
  mint: string;
  symbol: string;
  amount: string;
  decimals: number;
}

interface AssetSelectorProps {
  /** Available token balances from wallet */
  balances: TokenBalance[];
  /** Current deposit amounts */
  deposits: AssetDeposit[];
  /** Callback when deposits change */
  onChange: (deposits: AssetDeposit[]) => void;
  /** Token prices for USD conversion */
  prices: Record<string, number>;
  /** Whether balances are loading */
  isLoading: boolean;
}

/** Minimum SOL to reserve for transaction fees */
const MIN_SOL_RESERVE = 0.05;

/**
 * Token deposit amount inputs with balance display.
 * Shows wallet balances and lets user input amounts to deposit.
 * Validates against available balances and minimum reserves.
 */
export function AssetSelector({
  balances,
  deposits,
  onChange,
  prices,
  isLoading,
}: AssetSelectorProps) {
  const updateDeposit = (index: number, amount: string) => {
    const updated = deposits.map((d, i) => (i === index ? { ...d, amount } : d));
    onChange(updated);
  };

  const setMaxAmount = (index: number) => {
    const deposit = deposits[index];
    const balance = balances.find((b) => b.mint === deposit.mint);
    if (!balance) return;

    let maxAmount = balance.uiAmount;

    // Reserve SOL for gas fees
    if (deposit.symbol === "SOL") {
      maxAmount = Math.max(0, maxAmount - MIN_SOL_RESERVE);
    }

    updateDeposit(index, maxAmount.toString());
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-white/10 bg-white/[0.02]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white">Deposit Assets</h3>
        <p className="text-xs text-gray-500">
          Choose how much of each token to deposit into the vault
        </p>
      </div>

      <div className="space-y-3">
        {deposits.map((deposit, index) => {
          const balance = balances.find((b) => b.mint === deposit.mint);
          const walletBalance = balance?.uiAmount ?? 0;
          const inputAmount = parseFloat(deposit.amount) || 0;
          const price = prices[deposit.symbol] ?? 0;
          const usdValue = inputAmount * price;

          const maxDepositable =
            deposit.symbol === "SOL"
              ? Math.max(0, walletBalance - MIN_SOL_RESERVE)
              : walletBalance;

          const isOverBalance = inputAmount > walletBalance;
          const isSolWarning =
            deposit.symbol === "SOL" &&
            inputAmount > 0 &&
            walletBalance - inputAmount < MIN_SOL_RESERVE;

          return (
            <div
              key={deposit.mint}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white">
                    {deposit.symbol.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {deposit.symbol}
                    </p>
                    <p className="text-xs text-gray-500">
                      Balance: {walletBalance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMaxAmount(index)}
                  className="rounded px-2 py-0.5 text-xs text-[#00ff88] hover:bg-[#00ff88]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
                  aria-label={`Set maximum ${deposit.symbol} amount`}
                >
                  MAX
                </button>
              </div>

              <div className="relative">
                <input
                  type="number"
                  value={deposit.amount}
                  onChange={(e) => updateDeposit(index, e.target.value)}
                  placeholder="0.00"
                  min={0}
                  step="any"
                  className={cn(
                    "w-full rounded-lg border bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1",
                    isOverBalance
                      ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50"
                      : "border-white/10 focus:border-[#00ff88]/50 focus:ring-[#00ff88]/50"
                  )}
                  aria-label={`${deposit.symbol} deposit amount`}
                  aria-invalid={isOverBalance}
                />
                {inputAmount > 0 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                    {formatUsd(usdValue)}
                  </span>
                )}
              </div>

              {isOverBalance && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  Amount exceeds wallet balance
                </p>
              )}
              {isSolWarning && !isOverBalance && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-yellow-400">
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  Reserve at least {MIN_SOL_RESERVE} SOL for transaction fees
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Total value */}
      {deposits.some((d) => parseFloat(d.amount) > 0) && (
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
          <span className="text-gray-400">Total Deposit Value</span>
          <span className="font-semibold text-white">
            {formatUsd(
              deposits.reduce((sum, d) => {
                const amt = parseFloat(d.amount) || 0;
                const price = prices[d.symbol] ?? 0;
                return sum + amt * price;
              }, 0)
            )}
          </span>
        </div>
      )}
    </div>
  );
}
