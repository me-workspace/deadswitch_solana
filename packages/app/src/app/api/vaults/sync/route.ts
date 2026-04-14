import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import { upsertVault, logHeartbeat } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Zod refinement: validate a base58 Solana public key string.
 *
 * @param val - The string to validate
 * @returns True if `val` is a valid Solana base58 address
 */
function isBase58Pubkey(val: string): boolean {
  try {
    new PublicKey(val);
    return true;
  } catch {
    return false;
  }
}

const beneficiarySchema = z.object({
  wallet: z
    .string()
    .min(32)
    .max(44)
    .refine(isBase58Pubkey, { message: "Invalid beneficiary wallet (base58)" }),
  name: z.string().min(1).max(32),
  shareBps: z.number().int().min(1).max(9999),
});

const assetSchema = z.object({
  mint: z
    .string()
    .min(32)
    .max(44)
    .refine(isBase58Pubkey, { message: "Invalid asset mint (base58)" }),
  symbol: z.string().min(1).max(16),
  amount: z.string().regex(/^\d+$/, "Amount must be a non-negative integer string"),
  decimals: z.number().int().min(0).max(18),
});

const bodySchema = z.object({
  vaultPubkey: z
    .string()
    .min(32)
    .max(44)
    .refine(isBase58Pubkey, { message: "Invalid vault public key (base58)" }),
  ownerPubkey: z
    .string()
    .min(32)
    .max(44)
    .refine(isBase58Pubkey, { message: "Invalid owner public key (base58)" }),
  vaultIdOnchain: z.number().int().positive(),
  name: z.string().min(1).max(64),
  note: z.string().max(256).default(""),
  inactivityWindowSecs: z.number().int().min(1),
  gracePeriodSecs: z.number().int().min(1),
  crankFeeBps: z.number().int().min(1).max(500),
  beneficiaries: z
    .array(beneficiarySchema)
    .min(1)
    .max(10)
    .refine(
      (bens) => bens.reduce((sum, b) => sum + b.shareBps, 0) === 10_000,
      { message: "Beneficiary shares must total exactly 10000 bps (100%)" }
    ),
  assets: z.array(assetSchema).min(1).max(20),
});

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Sync a newly-created vault from the frontend into the database cache.
 *
 * Called immediately after the vault creation transaction is confirmed
 * onchain. Stores vault metadata, beneficiaries, and assets so the
 * dashboard, alerts, and activity logs work without polling the chain.
 *
 * Body: see `bodySchema` above.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Parse body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    const error: ApiError = {
      error: "Invalid JSON body",
      code: "PARSE_ERROR",
    };
    return Response.json(error, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const error: ApiError = {
      error: "Invalid request body",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
    return Response.json(error, { status: 400 });
  }

  const data = parsed.data;

  // Upsert the vault into the database
  let vault;
  try {
    vault = await upsertVault({
      vaultPubkey: data.vaultPubkey,
      ownerPubkey: data.ownerPubkey,
      vaultIdOnchain: BigInt(data.vaultIdOnchain),
      name: data.name,
      note: data.note,
      status: "active",
      inactivityWindowSecs: data.inactivityWindowSecs,
      gracePeriodSecs: data.gracePeriodSecs,
      crankFeeBps: data.crankFeeBps,
      lastActivity: new Date(),
      assets: data.assets.map((a) => ({
        mint: a.mint,
        symbol: a.symbol,
        amount: BigInt(a.amount),
        decimals: a.decimals,
      })),
      beneficiaries: data.beneficiaries.map((b) => ({
        wallet: b.wallet,
        name: b.name,
        shareBps: b.shareBps,
      })),
    });
  } catch (err) {
    console.error("[vault-sync] Failed to upsert vault:", err);
    const error: ApiError = {
      error: "Failed to save vault to database",
      code: "DB_ERROR",
    };
    return Response.json(error, { status: 500 });
  }

  // Log a "creation" heartbeat entry (non-blocking)
  try {
    await logHeartbeat({
      vaultId: vault.id,
      txSignature: `creation-${data.vaultPubkey}-${Date.now()}`,
      activityType: "creation",
      description: `Vault "${data.name}" created by ${data.ownerPubkey}`,
    });
  } catch (err) {
    console.error("[vault-sync] Failed to log creation heartbeat:", err);
    // Non-fatal — vault is already saved
  }

  const response: ApiResponse<{ vaultId: string; vaultPubkey: string }> = {
    data: {
      vaultId: vault.id,
      vaultPubkey: vault.vaultPubkey,
    },
    meta: { version: "0.1.0", timestamp: Date.now() },
  };

  return Response.json(response, { status: 201 });
}
