"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle, XCircle, Loader2, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Toast status variants */
export type ToastStatus = "pending" | "confirmed" | "error";

interface TransactionToastProps {
  /** Current status */
  status: ToastStatus;
  /** Message to display */
  message: string;
  /** Optional transaction signature (for explorer link) */
  txSignature?: string;
  /** Callback when toast is dismissed */
  onDismiss: () => void;
  /** Auto-dismiss after N milliseconds (0 = no auto-dismiss) */
  autoDismissMs?: number;
}

/**
 * Build Solana Explorer URL for a transaction.
 */
function getExplorerUrl(txSignature: string): string {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${txSignature}${suffix}`;
}

const STATUS_CONFIG: Record<
  ToastStatus,
  {
    icon: typeof CheckCircle;
    containerClass: string;
    iconClass: string;
    animate?: boolean;
  }
> = {
  pending: {
    icon: Loader2,
    containerClass: "border-yellow-500/20 bg-yellow-500/5",
    iconClass: "text-yellow-400",
    animate: true,
  },
  confirmed: {
    icon: CheckCircle,
    containerClass: "border-[#00ff88]/20 bg-[#00ff88]/5",
    iconClass: "text-[#00ff88]",
  },
  error: {
    icon: XCircle,
    containerClass: "border-red-500/20 bg-red-500/5",
    iconClass: "text-red-400",
  },
};

/**
 * Toast notification for transaction status.
 * Shows pending spinner, success checkmark, or error X.
 * Includes link to Solana Explorer when tx signature is available.
 */
export function TransactionToast({
  status,
  message,
  txSignature,
  onDismiss,
  autoDismissMs = 8000,
}: TransactionToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Animate in
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (autoDismissMs > 0 && status !== "pending") {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onDismiss, 300);
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [status, autoDismissMs, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  }, [onDismiss]);

  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 w-full max-w-sm rounded-xl border p-4 shadow-2xl transition-all duration-300",
        config.containerClass,
        isVisible
          ? "translate-y-0 opacity-100 animate-slide-in-right"
          : "translate-y-4 opacity-0"
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "h-5 w-5 shrink-0",
            config.iconClass,
            config.animate && "animate-spin"
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{message}</p>
          {txSignature && (
            <a
              href={getExplorerUrl(txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-[#00ff88]"
              aria-label="View transaction on Solana Explorer"
            >
              <span className="font-mono">
                {txSignature.slice(0, 8)}...{txSignature.slice(-4)}
              </span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Simplified hook for managing transaction toast state */
export interface ToastState {
  isVisible: boolean;
  status: ToastStatus;
  message: string;
  txSignature?: string;
}

export function useTransactionToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (status: ToastStatus, message: string, txSignature?: string) => {
      setToast({ isVisible: true, status, message, txSignature });
    },
    []
  );

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  return { toast, showToast, dismissToast };
}
