import { eq, and, lt, desc, inArray, or } from "drizzle-orm";
import { getDb } from "./index";
import {
  vaults,
  vaultAssets,
  vaultBeneficiaries,
  heartbeats,
  alertConfigs,
  processedWebhooks,
  type NewVault,
  type NewVaultAsset,
  type NewVaultBeneficiary,
  type NewHeartbeat,
  type Vault,
  type VaultAsset,
  type VaultBeneficiary,
  type Heartbeat,
  type AlertConfigRow,
} from "./schema";
import type { ActivityType } from "@deadswitch/sdk";

// ---------------------------------------------------------------------------
// Vault queries
// ---------------------------------------------------------------------------

/** Result shape for vault queries that include relations */
export interface VaultWithRelations extends Vault {
  assets: VaultAsset[];
  beneficiaries: VaultBeneficiary[];
  activityLog: Heartbeat[];
  alertConfig: AlertConfigRow | null;
}

/**
 * Fetch all vaults owned by a given public key, including their
 * assets and beneficiaries.
 *
 * @param ownerPubkey - Base58-encoded owner public key
 * @returns Array of vaults with nested assets and beneficiaries
 */
export async function getVaultsByOwner(
  ownerPubkey: string
): Promise<VaultWithRelations[]> {
  const db = getDb();

  const ownerVaults = await db
    .select()
    .from(vaults)
    .where(eq(vaults.ownerPubkey, ownerPubkey))
    .orderBy(desc(vaults.createdAt));

  if (ownerVaults.length === 0) return [];

  const vaultIds = ownerVaults.map((v) => v.id);

  const [assets, beneficiaries, logs, alerts] = await Promise.all([
    db
      .select()
      .from(vaultAssets)
      .where(inArray(vaultAssets.vaultId, vaultIds)),
    db
      .select()
      .from(vaultBeneficiaries)
      .where(inArray(vaultBeneficiaries.vaultId, vaultIds)),
    db
      .select()
      .from(heartbeats)
      .where(inArray(heartbeats.vaultId, vaultIds))
      .orderBy(desc(heartbeats.recordedAt)),
    db
      .select()
      .from(alertConfigs)
      .where(inArray(alertConfigs.vaultId, vaultIds)),
  ]);

  return ownerVaults.map((vault) => ({
    ...vault,
    assets: assets.filter((a) => a.vaultId === vault.id),
    beneficiaries: beneficiaries.filter((b) => b.vaultId === vault.id),
    activityLog: logs.filter((l) => l.vaultId === vault.id),
    alertConfig: alerts.find((a) => a.vaultId === vault.id) ?? null,
  }));
}

/**
 * Fetch a single vault by its onchain public key, with full relations.
 *
 * @param vaultPubkey - Base58-encoded vault PDA public key
 * @returns The vault with relations, or null if not found
 */
export async function getVaultByPubkey(
  vaultPubkey: string
): Promise<VaultWithRelations | null> {
  const db = getDb();

  const [vault] = await db
    .select()
    .from(vaults)
    .where(eq(vaults.vaultPubkey, vaultPubkey))
    .limit(1);

  if (!vault) return null;

  const [assets, beneficiaries, logs, alerts] = await Promise.all([
    db.select().from(vaultAssets).where(eq(vaultAssets.vaultId, vault.id)),
    db
      .select()
      .from(vaultBeneficiaries)
      .where(eq(vaultBeneficiaries.vaultId, vault.id)),
    db
      .select()
      .from(heartbeats)
      .where(eq(heartbeats.vaultId, vault.id))
      .orderBy(desc(heartbeats.recordedAt)),
    db
      .select()
      .from(alertConfigs)
      .where(eq(alertConfigs.vaultId, vault.id))
      .limit(1),
  ]);

  return {
    ...vault,
    assets,
    beneficiaries,
    activityLog: logs,
    alertConfig: alerts[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Vault upsert
// ---------------------------------------------------------------------------

/** Data required to create or update the vault cache */
export interface UpsertVaultData {
  vaultPubkey: string;
  ownerPubkey: string;
  vaultIdOnchain: bigint;
  name: string;
  note: string;
  status: Vault["status"];
  inactivityWindowSecs: number;
  gracePeriodSecs: number;
  crankFeeBps: number;
  lastActivity: Date;
  executedAt?: Date | null;
  cancelledAt?: Date | null;
  assets?: Array<Omit<NewVaultAsset, "id" | "vaultId">>;
  beneficiaries?: Array<Omit<NewVaultBeneficiary, "id" | "vaultId">>;
}

/**
 * Insert a new vault or update an existing one by its onchain public key.
 * Also replaces assets and beneficiaries if provided.
 *
 * @param data - Vault data to upsert
 * @returns The upserted vault row
 */
export async function upsertVault(data: UpsertVaultData): Promise<Vault> {
  const db = getDb();

  const vaultRow: NewVault = {
    vaultPubkey: data.vaultPubkey,
    ownerPubkey: data.ownerPubkey,
    vaultIdOnchain: data.vaultIdOnchain,
    name: data.name,
    note: data.note,
    status: data.status,
    inactivityWindowSecs: data.inactivityWindowSecs,
    gracePeriodSecs: data.gracePeriodSecs,
    crankFeeBps: data.crankFeeBps,
    lastActivity: data.lastActivity,
    updatedAt: new Date(),
    executedAt: data.executedAt ?? null,
    cancelledAt: data.cancelledAt ?? null,
  };

  const [upserted] = await db
    .insert(vaults)
    .values(vaultRow)
    .onConflictDoUpdate({
      target: vaults.vaultPubkey,
      set: {
        ownerPubkey: vaultRow.ownerPubkey,
        vaultIdOnchain: vaultRow.vaultIdOnchain,
        name: vaultRow.name,
        note: vaultRow.note,
        status: vaultRow.status,
        inactivityWindowSecs: vaultRow.inactivityWindowSecs,
        gracePeriodSecs: vaultRow.gracePeriodSecs,
        crankFeeBps: vaultRow.crankFeeBps,
        lastActivity: vaultRow.lastActivity,
        updatedAt: vaultRow.updatedAt,
        executedAt: vaultRow.executedAt,
        cancelledAt: vaultRow.cancelledAt,
      },
    })
    .returning();

  // Replace assets if provided
  if (data.assets) {
    await db.delete(vaultAssets).where(eq(vaultAssets.vaultId, upserted.id));
    if (data.assets.length > 0) {
      await db.insert(vaultAssets).values(
        data.assets.map((a) => ({
          ...a,
          vaultId: upserted.id,
        }))
      );
    }
  }

  // Replace beneficiaries if provided
  if (data.beneficiaries) {
    await db
      .delete(vaultBeneficiaries)
      .where(eq(vaultBeneficiaries.vaultId, upserted.id));
    if (data.beneficiaries.length > 0) {
      await db.insert(vaultBeneficiaries).values(
        data.beneficiaries.map((b) => ({
          ...b,
          vaultId: upserted.id,
        }))
      );
    }
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Heartbeat logging
// ---------------------------------------------------------------------------

/** Data for logging a heartbeat / activity event */
export interface LogHeartbeatData {
  vaultId: string;
  txSignature: string;
  sourceTx?: string | null;
  activityType: ActivityType;
  description?: string | null;
}

/**
 * Insert a heartbeat / activity record for a vault.
 *
 * @param data - Heartbeat data
 * @returns The inserted heartbeat row
 */
export async function logHeartbeat(data: LogHeartbeatData): Promise<Heartbeat> {
  const db = getDb();

  const [row] = await db
    .insert(heartbeats)
    .values({
      vaultId: data.vaultId,
      txSignature: data.txSignature,
      sourceTx: data.sourceTx ?? null,
      activityType: data.activityType,
      description: data.description ?? null,
    })
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

/**
 * Check whether a transaction signature has already been processed.
 *
 * @param txSignature - Solana transaction signature
 * @returns True if already processed
 */
export async function isWebhookProcessed(
  txSignature: string
): Promise<boolean> {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(processedWebhooks)
    .where(eq(processedWebhooks.txSignature, txSignature))
    .limit(1);

  return !!existing;
}

/**
 * Atomically mark a transaction signature as processed.
 * Uses INSERT ... ON CONFLICT DO NOTHING and checks whether a row
 * was actually inserted to avoid race conditions.
 *
 * @param txSignature - Solana transaction signature
 * @returns True if the row was newly inserted; false if it already existed
 */
export async function markWebhookProcessed(
  txSignature: string
): Promise<boolean> {
  const db = getDb();

  const result = await db
    .insert(processedWebhooks)
    .values({ txSignature })
    .onConflictDoNothing()
    .returning();

  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Alert config
// ---------------------------------------------------------------------------

/**
 * Get alert configuration for a vault.
 *
 * @param vaultId - Internal vault UUID
 * @returns Alert config row or null
 */
export async function getAlertConfig(
  vaultId: string
): Promise<AlertConfigRow | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(alertConfigs)
    .where(eq(alertConfigs.vaultId, vaultId))
    .limit(1);

  return row ?? null;
}

/** Data for upserting alert configuration */
export interface UpsertAlertConfigData {
  vaultId: string;
  email?: string | null;
  telegramId?: string | null;
  enabled?: boolean;
  lastAlertSentAt?: Date | null;
  lastAlertThreshold?: 50 | 75 | 90 | 100 | null;
}

/**
 * Create or update alert configuration for a vault.
 *
 * @param data - Alert config data
 * @returns The upserted alert config row
 */
export async function upsertAlertConfig(
  data: UpsertAlertConfigData
): Promise<AlertConfigRow> {
  const db = getDb();

  const [row] = await db
    .insert(alertConfigs)
    .values({
      vaultId: data.vaultId,
      email: data.email ?? null,
      telegramId: data.telegramId ?? null,
      enabled: data.enabled ?? true,
      lastAlertSentAt: data.lastAlertSentAt ?? null,
      lastAlertThreshold: data.lastAlertThreshold ?? null,
    })
    .onConflictDoUpdate({
      target: alertConfigs.vaultId,
      set: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.telegramId !== undefined
          ? { telegramId: data.telegramId }
          : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.lastAlertSentAt !== undefined
          ? { lastAlertSentAt: data.lastAlertSentAt }
          : {}),
        ...(data.lastAlertThreshold !== undefined
          ? { lastAlertThreshold: data.lastAlertThreshold }
          : {}),
      },
    })
    .returning();

  return row;
}

// ---------------------------------------------------------------------------
// Alert-related queries
// ---------------------------------------------------------------------------

/**
 * Fetch all active vaults that have alert configurations enabled.
 * Used by the alert cron/checker to determine which vaults need
 * notification checks.
 *
 * @returns Array of vaults with their alert configs
 */
export async function getActiveVaultsForAlerts(): Promise<
  Array<Vault & { alertConfig: AlertConfigRow }>
> {
  const db = getDb();

  const results = await db
    .select({
      vault: vaults,
      alertConfig: alertConfigs,
    })
    .from(vaults)
    .innerJoin(alertConfigs, eq(vaults.id, alertConfigs.vaultId))
    .where(
      and(
        or(eq(vaults.status, "active"), eq(vaults.status, "warning")),
        eq(alertConfigs.enabled, true)
      )
    );

  return results.map((r) => ({
    ...r.vault,
    alertConfig: r.alertConfig,
  }));
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Purge old processed webhook records to prevent unbounded table growth.
 *
 * @param olderThanDays - Delete records older than this many days (default: 30)
 * @returns Number of deleted rows
 */
export async function cleanOldWebhooks(
  olderThanDays: number = 30
): Promise<number> {
  const db = getDb();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const deleted = await db
    .delete(processedWebhooks)
    .where(lt(processedWebhooks.processedAt, cutoff))
    .returning();

  return deleted.length;
}
