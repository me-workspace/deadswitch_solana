import { PublicKey } from "@solana/web3.js";

/** PDA seeds */
export const VAULT_SEED = Buffer.from("vault");

/** Timing bounds (seconds) */
export const MIN_INACTIVITY_WINDOW = 2_592_000; // 30 days
export const MAX_INACTIVITY_WINDOW = 31_536_000; // 365 days
export const MIN_GRACE_PERIOD = 86_400; // 1 day
export const MAX_GRACE_PERIOD = 2_592_000; // 30 days

/** Fee bounds (basis points, 1 bps = 0.01%) */
export const MIN_CRANK_FEE_BPS = 1; // 0.01%
export const MAX_CRANK_FEE_BPS = 500; // 5%
export const DEFAULT_CRANK_FEE_BPS = 10; // 0.1%

/** Limits */
export const MAX_BENEFICIARIES = 10;
export const MAX_ASSETS = 20;
export const MAX_VAULT_NAME_LEN = 64;
export const MAX_NOTE_LEN = 256;
export const MAX_BENEFICIARY_NAME_LEN = 32;

/** 100% in basis points */
export const TOTAL_SHARE_BPS = 10_000;

/** Default timing for UI presets */
export const TIMING_PRESETS = [
  { days: 30, label: "30 days", description: "For daily active traders" },
  { days: 60, label: "60 days", description: "For weekly active users" },
  {
    days: 90,
    label: "90 days",
    description: "Recommended for most users",
    recommended: true,
  },
  { days: 120, label: "120 days", description: "For monthly active users" },
  { days: 180, label: "180 days", description: "For long-term holders" },
  { days: 365, label: "365 days", description: "Maximum caution" },
] as const;

export const GRACE_PRESETS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days", recommended: true },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

/** Well-known token mints on devnet and mainnet */
export const TOKEN_MINTS = {
  devnet: {
    USDC: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    USDT: new PublicKey("EJwZgeZrdC8TXTQbQBoL6bfuAnFUQcWQoKjE2RwW5Qo5"),
  },
  mainnet: {
    USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
  },
} as const;

/** Native SOL mint placeholder (Pubkey::default()) */
export const NATIVE_SOL_MINT = PublicKey.default;

/** Days to seconds helper */
export function daysToSeconds(days: number): number {
  return days * 86_400;
}

/** Seconds to days helper */
export function secondsToDays(seconds: number): number {
  return Math.floor(seconds / 86_400);
}
