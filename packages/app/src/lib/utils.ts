/**
 * Utility functions for Deadswitch frontend.
 * @module lib/utils
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Truncate a Solana address for display.
 * @param address - Full base58 address string
 * @param chars - Number of characters to show on each end (default 4)
 * @returns Truncated string like "7xKp...3nFq"
 */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format a number as USD currency string.
 * @param amount - Dollar amount
 * @returns Formatted string like "$1,234.56"
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format lamports to SOL with symbol.
 * @param lamports - Amount in lamports (1 SOL = 1e9 lamports)
 * @returns Formatted string like "1.234 SOL"
 */
export function formatSol(lamports: number | bigint): string {
  const sol = Number(lamports) / 1e9;
  const formatted = sol.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 9,
  });
  return `${formatted} SOL`;
}

/**
 * Format a unix timestamp or Date as relative or absolute date string.
 * @param timestamp - Unix timestamp in seconds, or Date object
 * @returns Relative string like "2 days ago" for recent, or "Jan 15, 2026" for older dates
 */
export function formatDate(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp * 1000);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 0) {
    // Future dates
    const absDiff = Math.abs(diffSeconds);
    if (absDiff < 60) return "in a few seconds";
    if (absDiff < 3600) {
      const mins = Math.floor(absDiff / 60);
      return `in ${mins} minute${mins === 1 ? "" : "s"}`;
    }
    if (absDiff < 86400) {
      const hours = Math.floor(absDiff / 3600);
      return `in ${hours} hour${hours === 1 ? "" : "s"}`;
    }
    const days = Math.floor(absDiff / 86400);
    if (days <= 30) return `in ${days} day${days === 1 ? "" : "s"}`;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (diffSeconds < 60) return "just now";
  if (diffSeconds < 3600) {
    const mins = Math.floor(diffSeconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diffSeconds < 2592000) {
    const days = Math.floor(diffSeconds / 86400);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a duration in seconds to human-readable string.
 * @param seconds - Duration in seconds
 * @returns Formatted string like "90 days, 7 hours"
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0 seconds";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);

  return parts.join(", ");
}

/**
 * Merge Tailwind CSS class names, filtering out falsy values.
 * Simple implementation without clsx/tailwind-merge dependency.
 * @param classes - Class name strings (falsy values are filtered)
 * @returns Merged class string
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Validate a Solana base58 public key string.
 * Uses the actual PublicKey constructor for accurate validation.
 * @param address - String to validate
 * @returns True if valid Solana public key
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a decimal string amount to the smallest unit (lamports/raw amount).
 * Avoids floating-point precision loss by using string manipulation.
 * @param amount - Decimal string (e.g. "1.5")
 * @param decimals - Number of decimal places (e.g. 9 for SOL, 6 for USDC)
 * @returns String representation of the amount in smallest units
 */
export function decimalToSmallestUnit(amount: string, decimals: number): string {
  if (!amount || amount === "0") return "0";
  const [whole = "0", frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  const raw = whole + paddedFrac;
  // Remove leading zeros but keep at least "0"
  return raw.replace(/^0+/, "") || "0";
}

/**
 * Parse an Anchor program error code to a human-readable message.
 * @param error - Error object from Anchor
 * @returns Human-readable error message
 */
export function parseAnchorError(error: unknown): string {
  if (!error) return "An unknown error occurred";

  const err = error as Record<string, unknown>;

  // Anchor error with code
  if (typeof err.code === "number") {
    const errorMessages: Record<number, string> = {
      6000: "Inactivity window must be between 30 and 365 days",
      6001: "Grace period must be between 1 and 30 days",
      6002: "Crank fee must be between 0.01% and 5%",
      6003: "Beneficiary shares must total exactly 100%",
      6004: "Too many beneficiaries (max 10)",
      6005: "At least one beneficiary is required",
      6006: "Too many assets (max 20)",
      6007: "At least one asset is required",
      6008: "Vault name is too long (max 64 characters)",
      6009: "Note is too long (max 256 characters)",
      6010: "Beneficiary name is too long (max 32 characters)",
      6011: "Cannot use your own address as a beneficiary",
      6012: "Duplicate beneficiary address",
      6013: "Invalid beneficiary address",
      6014: "Vault is not in a modifiable state",
      6015: "Vault is not eligible for execution",
      6016: "Heartbeat timestamp is in the future",
      6017: "Heartbeat timestamp is not newer than last activity",
      6018: "Unauthorized - only the vault owner can perform this action",
      6019: "Unauthorized - invalid heartbeat authority",
      6020: "Insufficient deposit amount",
      6021: "Arithmetic overflow",
      6022: "Beneficiary share is zero",
    };
    return errorMessages[err.code] || `Program error: ${err.code}`;
  }

  // Transaction error
  if (typeof err.message === "string") {
    if (err.message.includes("User rejected")) return "Transaction was rejected by the wallet";
    if (err.message.includes("insufficient")) return "Insufficient balance for this transaction";
    if (err.message.includes("blockhash")) return "Transaction expired. Please try again.";
    return err.message;
  }

  return "An unexpected error occurred. Please try again.";
}
