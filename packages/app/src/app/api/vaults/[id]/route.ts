import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import {
  VaultStatus,
  computeDisplayStatus,
  type VaultDisplay,
  type VaultDisplayStatus,
} from "@deadswitch/sdk";
import { secondsToDays } from "@deadswitch/sdk";
import { getVaultByPubkey } from "@/lib/db/queries";
import { getReadonlyProgram } from "@/lib/solana/program";
import { getTokenPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const paramSchema = z.object({
  id: z
    .string()
    .min(32)
    .max(44)
    .refine(
      (val) => {
        try {
          new PublicKey(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Invalid vault public key (base58)" }
    ),
});

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || "https://deadswitch.xyz";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map an onchain vault status enum variant to a VaultStatus number.
 */
function parseOnchainStatus(status: Record<string, unknown>): VaultStatus {
  if ("executed" in status) return VaultStatus.Executed;
  if ("cancelled" in status) return VaultStatus.Cancelled;
  return VaultStatus.Active;
}

/**
 * Decode a fixed-size byte array to a trimmed UTF-8 string.
 */
function decodeFixedString(bytes: number[]): string {
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.slice(0, end) : bytes;
  return new TextDecoder().decode(Uint8Array.from(slice));
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/** Extended vault detail response including activity and alert info */
interface VaultDetailResponse extends VaultDisplay {
  activityLog: Array<{
    id: string;
    txSignature: string;
    activityType: string;
    description: string | null;
    recordedAt: string;
  }>;
  alertConfig: {
    email: string | null;
    enabled: boolean;
    lastAlertThreshold: number | null;
  } | null;
}

/**
 * Fetch a single vault by its onchain public key.
 *
 * Combines onchain account data with DB metadata (activity log,
 * alert configuration) for a complete vault detail view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  // Validate param
  const parsed = paramSchema.safeParse({ id });
  if (!parsed.success) {
    const error: ApiError = {
      error: "Invalid vault public key",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
    return Response.json(error, { status: 400, headers: CORS_HEADERS });
  }

  const vaultPubkey = new PublicKey(parsed.data.id);

  // Fetch token prices
  const prices = await getTokenPrices();
  const priceMap = new Map(prices.map((p) => [p.mint, p.priceUsd]));

  // Try to fetch from onchain first
  let onchainData: Record<string, unknown> | null = null;
  try {
    const program = getReadonlyProgram();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account = await (program.account as Record<string, any>)["vault"].fetch(vaultPubkey);
    onchainData = account as unknown as Record<string, unknown>;
  } catch (err) {
    console.warn(
      `[vault/${parsed.data.id}] Failed to fetch onchain:`,
      err
    );
  }

  // Fetch DB data
  let dbVault;
  try {
    dbVault = await getVaultByPubkey(parsed.data.id);
  } catch (err) {
    console.warn(`[vault/${parsed.data.id}] Failed to fetch from DB:`, err);
    dbVault = null;
  }

  // If neither source has data, return 404
  if (!onchainData && !dbVault) {
    const error: ApiError = {
      error: "Vault not found",
      code: "NOT_FOUND",
    };
    return Response.json(error, { status: 404, headers: CORS_HEADERS });
  }

  let vaultDisplay: VaultDetailResponse;

  if (onchainData) {
    // Build display from onchain data
    const owner = (onchainData.owner as PublicKey).toBase58();
    const vaultId = Number(onchainData.vaultId as bigint);
    const name =
      typeof onchainData.name === "string"
        ? onchainData.name
        : decodeFixedString(onchainData.name as number[]);
    const note =
      typeof onchainData.note === "string"
        ? onchainData.note
        : decodeFixedString(onchainData.note as number[]);
    const onchainStatus = parseOnchainStatus(
      onchainData.status as Record<string, unknown>
    );
    const inactivityWindow = Number(onchainData.inactivityWindow as bigint);
    const gracePeriod = Number(onchainData.gracePeriod as bigint);
    const crankFeeBps = Number(onchainData.crankFeeBps);
    const lastActivity = Number(onchainData.lastActivity as bigint);
    const createdAt = Number(onchainData.createdAt as bigint);

    const now = Math.floor(Date.now() / 1000);
    const displayStatus = computeDisplayStatus(
      onchainStatus,
      lastActivity,
      inactivityWindow,
      gracePeriod,
      now
    );

    const elapsed = now - lastActivity;
    const daysElapsed = Math.floor(elapsed / 86400);
    const totalWindowDays = secondsToDays(inactivityWindow + gracePeriod);
    const daysRemaining = Math.max(0, totalWindowDays - daysElapsed);
    const progressPercent = Math.min(
      100,
      Math.round((elapsed / (inactivityWindow + gracePeriod)) * 100)
    );

    // Beneficiaries
    const numBeneficiaries = Number(onchainData.numBeneficiaries ?? 0);
    const rawBeneficiaries = (onchainData.beneficiaries ?? []) as Array<{
      wallet: PublicKey;
      shareBps: number;
      name: string | number[];
    }>;
    const beneficiaries = rawBeneficiaries
      .slice(0, numBeneficiaries)
      .map((b) => ({
        wallet: b.wallet,
        shareBps: Number(b.shareBps),
        name:
          typeof b.name === "string" ? b.name : decodeFixedString(b.name),
      }));

    // Assets
    const numAssets = Number(onchainData.numAssets ?? 0);
    const rawAssets = (onchainData.assetConfigs ?? []) as Array<{
      mint: PublicKey;
      amount: bigint;
    }>;
    const assets = rawAssets.slice(0, numAssets).map((a) => ({
      mint: a.mint,
      amount: BigInt(a.amount.toString()),
    }));

    // Total USD value
    let totalValueUsd = 0;
    for (const asset of assets) {
      const mintStr = asset.mint.toBase58();
      const price = priceMap.get(mintStr) ?? 0;
      const decimals = mintStr.includes("1111111111111") ? 9 : 6;
      totalValueUsd += (Number(asset.amount) / 10 ** decimals) * price;
    }

    vaultDisplay = {
      pubkey: parsed.data.id,
      owner,
      vaultId,
      name,
      note,
      displayStatus,
      onchainStatus,
      beneficiaries,
      assets,
      inactivityWindowDays: secondsToDays(inactivityWindow),
      gracePeriodDays: secondsToDays(gracePeriod),
      crankFeeBps,
      lastActivityTimestamp: lastActivity,
      createdAtTimestamp: createdAt,
      daysElapsed,
      daysRemaining,
      progressPercent,
      totalValueUsd,
      activityLog:
        dbVault?.activityLog.map((log) => ({
          id: log.id,
          txSignature: log.txSignature,
          activityType: log.activityType,
          description: log.description,
          recordedAt: log.recordedAt.toISOString(),
        })) ?? [],
      alertConfig: dbVault?.alertConfig
        ? {
            email: dbVault.alertConfig.email,
            enabled: dbVault.alertConfig.enabled,
            lastAlertThreshold: dbVault.alertConfig.lastAlertThreshold,
          }
        : null,
    };
  } else {
    // Build from DB data only (fallback when onchain is unavailable)
    const db = dbVault!;
    vaultDisplay = {
      pubkey: db.vaultPubkey,
      owner: db.ownerPubkey,
      vaultId: Number(db.vaultIdOnchain),
      name: db.name,
      note: db.note,
      displayStatus: db.status as VaultDisplayStatus,
      onchainStatus: VaultStatus.Active,
      beneficiaries: db.beneficiaries.map((b) => ({
        wallet: new PublicKey(b.wallet),
        shareBps: b.shareBps,
        name: b.name,
      })),
      assets: db.assets.map((a) => ({
        mint: new PublicKey(a.mint),
        amount: a.amount,
      })),
      inactivityWindowDays: secondsToDays(db.inactivityWindowSecs),
      gracePeriodDays: secondsToDays(db.gracePeriodSecs),
      crankFeeBps: db.crankFeeBps,
      lastActivityTimestamp: Math.floor(db.lastActivity.getTime() / 1000),
      createdAtTimestamp: Math.floor(db.createdAt.getTime() / 1000),
      daysElapsed: 0,
      daysRemaining: secondsToDays(db.inactivityWindowSecs),
      progressPercent: 0,
      totalValueUsd: 0,
      activityLog: db.activityLog.map((log) => ({
        id: log.id,
        txSignature: log.txSignature,
        activityType: log.activityType,
        description: log.description,
        recordedAt: log.recordedAt.toISOString(),
      })),
      alertConfig: db.alertConfig
        ? {
            email: db.alertConfig.email,
            enabled: db.alertConfig.enabled,
            lastAlertThreshold: db.alertConfig.lastAlertThreshold,
          }
        : null,
    };
  }

  const response: ApiResponse<VaultDetailResponse> = {
    data: vaultDisplay,
    meta: {
      version: "0.1.0",
      timestamp: Date.now(),
    },
  };

  return Response.json(response, { status: 200, headers: CORS_HEADERS });
}

/**
 * Handle CORS preflight.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
