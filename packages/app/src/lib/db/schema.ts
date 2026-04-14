import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Vault status enum values matching onchain VaultStatus.
 * Stored as varchar for readability and flexibility.
 */
const VAULT_STATUS_VALUES = [
  "active",
  "warning",
  "triggered",
  "executed",
  "cancelled",
] as const;

/**
 * Activity type enum values for heartbeat/event logging.
 */
const ACTIVITY_TYPE_VALUES = [
  "heartbeat",
  "manual",
  "creation",
  "update",
  "top_up",
  "execution",
  "cancellation",
] as const;

/**
 * Alert threshold levels (percentage of inactivity window elapsed).
 */
const ALERT_THRESHOLD_VALUES = [50, 75, 90, 100] as const;

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Cached vault metadata — mirrors onchain vault accounts with
 * additional display fields (status, timestamps, notes).
 */
export const vaults = pgTable(
  "vaults",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultPubkey: varchar("vault_pubkey", { length: 64 }).notNull().unique(),
    ownerPubkey: varchar("owner_pubkey", { length: 64 }).notNull(),
    vaultIdOnchain: bigint("vault_id_onchain", { mode: "bigint" }).notNull(),
    name: varchar("name", { length: 64 }).notNull().default(""),
    note: text("note").notNull().default(""),
    status: varchar("status", { length: 16 })
      .notNull()
      .default("active")
      .$type<(typeof VAULT_STATUS_VALUES)[number]>(),
    inactivityWindowSecs: integer("inactivity_window_secs").notNull(),
    gracePeriodSecs: integer("grace_period_secs").notNull(),
    crankFeeBps: integer("crank_fee_bps").notNull(),
    lastActivity: timestamp("last_activity", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_vaults_owner").on(table.ownerPubkey),
    index("idx_vaults_status").on(table.status),
  ]
);

/**
 * Assets held inside a vault (SPL tokens or wrapped SOL).
 */
export const vaultAssets = pgTable(
  "vault_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    mint: varchar("mint", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 16 }).notNull().default(""),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    decimals: integer("decimals").notNull().default(0),
  },
  (table) => [index("idx_vault_assets_vault").on(table.vaultId)]
);

/**
 * Beneficiaries assigned to a vault.
 */
export const vaultBeneficiaries = pgTable(
  "vault_beneficiaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    wallet: varchar("wallet", { length: 64 }).notNull(),
    name: varchar("name", { length: 32 }).notNull().default(""),
    shareBps: integer("share_bps").notNull(),
  },
  (table) => [index("idx_vault_beneficiaries_vault").on(table.vaultId)]
);

/**
 * Heartbeat / activity log entries for a vault.
 */
export const heartbeats = pgTable(
  "heartbeats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    txSignature: varchar("tx_signature", { length: 128 }).notNull().unique(),
    sourceTx: varchar("source_tx", { length: 128 }),
    activityType: varchar("activity_type", { length: 16 })
      .notNull()
      .$type<(typeof ACTIVITY_TYPE_VALUES)[number]>(),
    description: text("description"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_heartbeats_vault").on(table.vaultId),
    index("idx_heartbeats_source_tx").on(table.sourceTx),
  ]
);

/**
 * Alert configuration for a vault (email / Telegram notifications).
 */
export const alertConfigs = pgTable(
  "alert_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" })
      .unique(),
    email: varchar("email", { length: 255 }),
    telegramId: varchar("telegram_id", { length: 64 }),
    enabled: boolean("enabled").notNull().default(true),
    lastAlertSentAt: timestamp("last_alert_sent_at", { withTimezone: true }),
    lastAlertThreshold: integer("last_alert_threshold").$type<
      (typeof ALERT_THRESHOLD_VALUES)[number]
    >(),
  },
  (table) => [uniqueIndex("idx_alert_configs_vault").on(table.vaultId)]
);

/**
 * Helius webhook idempotency table — prevents reprocessing the same
 * transaction signature multiple times.
 */
export const processedWebhooks = pgTable("processed_webhooks", {
  txSignature: varchar("tx_signature", { length: 128 }).primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Vault = typeof vaults.$inferSelect;
export type NewVault = typeof vaults.$inferInsert;
export type VaultAsset = typeof vaultAssets.$inferSelect;
export type NewVaultAsset = typeof vaultAssets.$inferInsert;
export type VaultBeneficiary = typeof vaultBeneficiaries.$inferSelect;
export type NewVaultBeneficiary = typeof vaultBeneficiaries.$inferInsert;
export type Heartbeat = typeof heartbeats.$inferSelect;
export type NewHeartbeat = typeof heartbeats.$inferInsert;
export type AlertConfigRow = typeof alertConfigs.$inferSelect;
export type NewAlertConfig = typeof alertConfigs.$inferInsert;
