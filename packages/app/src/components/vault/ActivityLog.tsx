"use client";

import {
  Heart,
  Hand,
  Plus,
  Settings,
  ArrowUpCircle,
  PlayCircle,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { formatDate, cn } from "@/lib/utils";

/** Activity types matching API response */
export type ActivityType =
  | "heartbeat"
  | "manual"
  | "creation"
  | "update"
  | "top_up"
  | "execution"
  | "cancellation";

/** Single activity entry */
export interface ActivityEntry {
  id: string;
  txSignature: string;
  activityType: ActivityType;
  description: string | null;
  recordedAt: string;
}

interface ActivityLogProps {
  /** List of activity entries, sorted newest first */
  entries: ActivityEntry[];
  /** Whether entries are loading */
  isLoading: boolean;
}

const ACTIVITY_CONFIG: Record<
  ActivityType,
  {
    icon: typeof Heart;
    label: string;
    colorClass: string;
  }
> = {
  heartbeat: {
    icon: Heart,
    label: "Heartbeat",
    colorClass: "text-[#00ff88]",
  },
  manual: {
    icon: Hand,
    label: "Manual Heartbeat",
    colorClass: "text-[#00ff88]",
  },
  creation: {
    icon: Plus,
    label: "Vault Created",
    colorClass: "text-blue-400",
  },
  update: {
    icon: Settings,
    label: "Vault Updated",
    colorClass: "text-yellow-400",
  },
  top_up: {
    icon: ArrowUpCircle,
    label: "Assets Deposited",
    colorClass: "text-purple-400",
  },
  execution: {
    icon: PlayCircle,
    label: "Vault Executed",
    colorClass: "text-red-400",
  },
  cancellation: {
    icon: XCircle,
    label: "Vault Cancelled",
    colorClass: "text-gray-400",
  },
};

/**
 * Build Solana Explorer URL for a transaction signature.
 * Uses devnet by default (matches app config).
 */
function getExplorerUrl(txSignature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const base = "https://explorer.solana.com/tx";
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `${base}/${txSignature}${suffix}`;
}

/**
 * Timeline of vault activity events.
 * Shows heartbeats, updates, deposits, and other lifecycle events.
 */
export function ActivityLog({ entries, isLoading }: ActivityLogProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex gap-3 animate-pulse"
          >
            <div className="h-8 w-8 rounded-full bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 rounded bg-white/10" />
              <div className="h-3 w-48 rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Heart className="h-10 w-10 text-gray-600 mb-3" aria-hidden="true" />
        <p className="text-sm text-gray-400">No activity recorded yet</p>
        <p className="mt-1 text-xs text-gray-600">
          Activity will appear here as heartbeats and actions are recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0" role="list" aria-label="Vault activity log">
      {entries.map((entry, index) => {
        const config = ACTIVITY_CONFIG[entry.activityType] ?? ACTIVITY_CONFIG.heartbeat;
        const Icon = config.icon;
        const isLast = index === entries.length - 1;

        return (
          <div
            key={entry.id}
            className="relative flex gap-3 pb-6"
            role="listitem"
          >
            {/* Timeline connector line */}
            {!isLast && (
              <div
                className="absolute left-4 top-8 bottom-0 w-px bg-white/10"
                aria-hidden="true"
              />
            )}

            {/* Icon */}
            <div
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5",
                config.colorClass
              )}
              aria-hidden="true"
            >
              <Icon className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">
                    {config.label}
                  </p>
                  {entry.description && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      {entry.description}
                    </p>
                  )}
                </div>
                <time
                  dateTime={entry.recordedAt}
                  className="shrink-0 text-xs text-gray-500"
                >
                  {formatDate(new Date(entry.recordedAt))}
                </time>
              </div>

              {/* Transaction link */}
              <a
                href={getExplorerUrl(entry.txSignature)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-gray-600 transition-colors hover:text-[#00ff88] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#00ff88] rounded"
                aria-label={`View transaction ${entry.txSignature.slice(0, 8)} on Solana Explorer`}
              >
                <span className="font-mono">
                  {entry.txSignature.slice(0, 8)}...{entry.txSignature.slice(-4)}
                </span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
