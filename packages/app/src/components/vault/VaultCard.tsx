"use client";

import Link from "next/link";
import { Users, Clock, ArrowRight } from "lucide-react";
import { StatusBadge, type VaultDisplayStatus } from "./StatusBadge";
import { ProgressBar } from "./ProgressBar";
import { formatUsd, formatDate, truncateAddress } from "@/lib/utils";

interface VaultCardProps {
  /** Vault public key (used for navigation) */
  pubkey: string;
  /** Vault display name */
  name: string;
  /** Computed display status */
  displayStatus: VaultDisplayStatus;
  /** Progress through inactivity window (0-100+) */
  progressPercent: number;
  /** Total vault value in USD */
  totalValueUsd: number;
  /** Days remaining before trigger */
  daysRemaining: number;
  /** Number of beneficiaries */
  beneficiaryCount: number;
  /** Last activity unix timestamp */
  lastActivityTimestamp: number;
}

/**
 * Dashboard card for a single vault.
 * Shows key info at a glance: status, progress, value, beneficiaries.
 * Clickable to navigate to vault detail page.
 */
export function VaultCard({
  pubkey,
  name,
  displayStatus,
  progressPercent,
  totalValueUsd,
  daysRemaining,
  beneficiaryCount,
  lastActivityTimestamp,
}: VaultCardProps) {
  return (
    <Link
      href={`/vault/${pubkey}`}
      className="group block rounded-xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-white/20 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
      aria-label={`View vault: ${name}`}
    >
      {/* Header row: name + status */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-white truncate">{name}</h3>
        <StatusBadge status={displayStatus} size="sm" />
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <ProgressBar percent={progressPercent} size="sm" />
      </div>

      {/* Stats grid */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-gray-500">Total Value</p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {formatUsd(totalValueUsd)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Days Remaining</p>
          <p className="mt-0.5 text-sm font-semibold text-white">
            {daysRemaining > 0 ? `${daysRemaining} days` : "Overdue"}
          </p>
        </div>
      </div>

      {/* Footer: meta info */}
      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden="true" />
            {beneficiaryCount} beneficiar{beneficiaryCount === 1 ? "y" : "ies"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatDate(lastActivityTimestamp)}
          </span>
        </div>
        <ArrowRight
          className="h-4 w-4 text-gray-600 transition-colors group-hover:text-[#00ff88]"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
