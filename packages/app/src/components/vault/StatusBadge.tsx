"use client";

import { Shield, AlertTriangle, Zap, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Vault display status types */
export type VaultDisplayStatus = "active" | "warning" | "triggered" | "executed" | "cancelled";

interface StatusBadgeProps {
  /** Current display status of the vault */
  status: VaultDisplayStatus;
  /** Optional size variant */
  size?: "sm" | "md" | "lg";
}

const STATUS_CONFIG: Record<
  VaultDisplayStatus,
  {
    label: string;
    icon: typeof Shield;
    className: string;
    ariaLabel: string;
  }
> = {
  active: {
    label: "Active",
    icon: Shield,
    className: "bg-[#00ff88]/10 text-[#00ff88] ring-[#00ff88]/20",
    ariaLabel: "Vault is active and monitoring",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className: "bg-yellow-500/10 text-yellow-400 ring-yellow-500/20",
    ariaLabel: "Vault approaching inactivity threshold",
  },
  triggered: {
    label: "Triggered",
    icon: Zap,
    className: "bg-red-500/10 text-red-400 ring-red-500/20",
    ariaLabel: "Vault has been triggered for redistribution",
  },
  executed: {
    label: "Executed",
    icon: CheckCircle,
    className: "bg-gray-500/10 text-gray-400 ring-gray-500/20",
    ariaLabel: "Vault has been executed and assets redistributed",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-gray-500/10 text-gray-400 ring-gray-500/20",
    ariaLabel: "Vault has been cancelled",
  },
};

const SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-xs gap-1",
  md: "px-2.5 py-1 text-sm gap-1.5",
  lg: "px-3 py-1.5 text-base gap-2",
};

const ICON_SIZES = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

/**
 * Color-coded status badge for vault display status.
 * Uses both color and icon+text to communicate status (a11y).
 */
export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1 ring-inset",
        config.className,
        SIZE_CLASSES[size]
      )}
      role="status"
      aria-label={config.ariaLabel}
    >
      <Icon className={ICON_SIZES[size]} aria-hidden="true" />
      {config.label}
    </span>
  );
}
