"use client";

import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** Progress percentage (0-100+) */
  percent: number;
  /** Optional size variant */
  size?: "sm" | "md";
  /** Whether to show the percentage label */
  showLabel?: boolean;
  /** Optional aria-label override */
  ariaLabel?: string;
}

/**
 * Inactivity progress bar.
 * Color transitions: green (0-50%) -> yellow (50-75%) -> red (75%+).
 * Capped visually at 100% even if percent exceeds 100.
 */
export function ProgressBar({
  percent,
  size = "md",
  showLabel = false,
  ariaLabel,
}: ProgressBarProps) {
  const clampedPercent = Math.min(Math.max(percent, 0), 100);

  let barColor: string;
  if (percent >= 75) {
    barColor = "bg-red-500";
  } else if (percent >= 50) {
    barColor = "bg-yellow-500";
  } else {
    barColor = "bg-[#00ff88]";
  }

  const heightClass = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className="w-full">
      <div
        className={cn("w-full overflow-hidden rounded-full bg-white/10", heightClass)}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? `Inactivity progress: ${Math.round(percent)}%`}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", barColor)}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      {showLabel && (
        <p className="mt-1 text-xs text-gray-500">
          {Math.round(percent)}% through inactivity window
        </p>
      )}
    </div>
  );
}
