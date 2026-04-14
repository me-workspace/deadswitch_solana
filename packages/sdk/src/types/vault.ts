import { PublicKey } from "@solana/web3.js";

/** Vault status — mirrors onchain VaultStatus enum */
export enum VaultStatus {
  Active = 0,
  Executed = 1,
  Cancelled = 2,
}

/** Computed display status for frontend (includes Warning/Triggered derived from timing) */
export type VaultDisplayStatus =
  | "active"
  | "warning"
  | "triggered"
  | "executed"
  | "cancelled";

/** Beneficiary stored onchain */
export interface Beneficiary {
  wallet: PublicKey;
  shareBps: number;
  name: string;
}

/** Asset config stored onchain */
export interface AssetConfig {
  mint: PublicKey;
  amount: bigint;
}

/** Full vault data from onchain account */
export interface VaultAccount {
  owner: PublicKey;
  vaultId: bigint;
  bump: number;
  heartbeatAuthority: PublicKey;
  inactivityWindow: bigint;
  gracePeriod: bigint;
  crankFeeBps: number;
  status: VaultStatus;
  lastActivity: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  name: string;
  note: string;
  numBeneficiaries: number;
  numAssets: number;
  beneficiaries: Beneficiary[];
  assetConfigs: AssetConfig[];
}

/** Vault data enriched with computed fields for frontend display */
export interface VaultDisplay {
  pubkey: string;
  owner: string;
  vaultId: number;
  name: string;
  note: string;
  displayStatus: VaultDisplayStatus;
  onchainStatus: VaultStatus;
  beneficiaries: Beneficiary[];
  assets: AssetConfig[];
  inactivityWindowDays: number;
  gracePeriodDays: number;
  crankFeeBps: number;
  lastActivityTimestamp: number;
  createdAtTimestamp: number;
  daysElapsed: number;
  daysRemaining: number;
  progressPercent: number;
  totalValueUsd: number;
}

/**
 * Compute the display status from onchain status + timing
 */
export function computeDisplayStatus(
  onchainStatus: VaultStatus,
  lastActivity: number,
  inactivityWindow: number,
  gracePeriod: number,
  now: number
): VaultDisplayStatus {
  if (onchainStatus === VaultStatus.Executed) return "executed";
  if (onchainStatus === VaultStatus.Cancelled) return "cancelled";

  const elapsed = now - lastActivity;
  const triggerTime = inactivityWindow + gracePeriod;

  if (elapsed >= triggerTime) return "triggered";
  if (elapsed >= inactivityWindow * 0.75) return "warning";
  return "active";
}
