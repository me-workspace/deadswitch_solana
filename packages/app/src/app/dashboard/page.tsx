"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Plus, Shield, RefreshCw, AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useVaults } from "@/hooks/useVaults";
import { VaultCard } from "@/components/vault/VaultCard";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

/**
 * Dashboard page showing the connected wallet's vaults.
 * Handles three states: wallet not connected, no vaults, and vault grid.
 */
export default function DashboardPage() {
  const { connected, publicKey } = useWallet();
  const { vaults, isLoading, error, mutate } = useVaults();

  // State: wallet not connected
  if (!connected || !publicKey) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-32">
        <Shield className="h-16 w-16 text-gray-600" aria-hidden="true" />
        <div className="text-center">
          <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
          <p className="mt-2 text-gray-400">
            Connect your Solana wallet to view and manage your vaults.
          </p>
        </div>
        <WalletMultiButton
          style={{
            backgroundColor: "#00ff88",
            color: "#000",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            height: "3rem",
            padding: "0 1.5rem",
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Your Vaults</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage your inheritance vaults
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-400 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
            aria-label="Refresh vaults"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Vault
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm text-red-400">
              Failed to load vaults. Please try again.
            </p>
            <p className="mt-0.5 text-xs text-red-400/60">{error.message}</p>
          </div>
          <button
            type="button"
            onClick={() => mutate()}
            className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && vaults.length === 0 && !error && (
        <div className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-xl border border-white/10 bg-white/[0.02] p-5"
              aria-hidden="true"
            >
              {/* Skeleton header */}
              <div className="flex items-center justify-between mb-4">
                <div className="h-5 w-28 rounded bg-white/10" />
                <div className="h-5 w-16 rounded-full bg-white/10" />
              </div>
              {/* Skeleton progress bar */}
              <div className="h-2 w-full rounded-full bg-white/5 mb-4">
                <div className="h-2 w-2/3 rounded-full bg-white/10" />
              </div>
              {/* Skeleton stats row */}
              <div className="flex items-center justify-between mb-3">
                <div className="h-4 w-20 rounded bg-white/5" />
                <div className="h-4 w-16 rounded bg-white/5" />
              </div>
              {/* Skeleton footer */}
              <div className="flex items-center justify-between pt-3 border-t border-white/5">
                <div className="h-3 w-24 rounded bg-white/5" />
                <div className="h-3 w-12 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && vaults.length === 0 && (
        <div className="mt-16 flex flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-white/10 py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
            <Shield className="h-8 w-8 text-gray-500" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">No vaults yet</h3>
            <p className="mt-2 max-w-sm text-sm text-gray-400">
              You haven&apos;t created any inheritance vaults yet. Create your
              first vault to protect your crypto assets for your loved ones.
            </p>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create Your First Vault
          </Link>
        </div>
      )}

      {/* Vault grid */}
      {vaults.length > 0 && (
        <div className="mt-8 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {vaults.map((vault) => (
            <VaultCard
              key={vault.pubkey}
              pubkey={vault.pubkey}
              name={vault.name}
              displayStatus={vault.displayStatus}
              progressPercent={vault.progressPercent}
              totalValueUsd={vault.totalValueUsd}
              daysRemaining={vault.daysRemaining}
              beneficiaryCount={vault.beneficiaryCount}
              lastActivityTimestamp={vault.lastActivityTimestamp}
            />
          ))}
        </div>
      )}
    </div>
  );
}
