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
import { getVaultsByOwner } from "@/lib/db/queries";
import { getReadonlyProgram, PROGRAM_ID } from "@/lib/solana/program";
import { getTokenPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const querySchema = z.object({
  owner: z
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
      { message: "Invalid Solana public key (base58)" }
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
 * Decode a fixed-size byte array (from onchain) to a trimmed UTF-8 string.
 */
function decodeFixedString(bytes: number[]): string {
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.slice(0, end) : bytes;
  return new TextDecoder().decode(Uint8Array.from(slice));
}

/**
 * Build a VaultDisplay from onchain account data.
 */
function buildVaultDisplay(
  pubkey: string,
  account: Record<string, unknown>,
  priceMap: Map<string, number>,
  dbStatus?: VaultDisplayStatus
): VaultDisplay {
  const owner = (account.owner as PublicKey).toBase58();
  const vaultId = Number(account.vaultId as bigint);
  const name =
    typeof account.name === "string"
      ? account.name
      : decodeFixedString(account.name as number[]);
  const note =
    typeof account.note === "string"
      ? account.note
      : decodeFixedString(account.note as number[]);
  const onchainStatus = parseOnchainStatus(
    account.status as Record<string, unknown>
  );
  const inactivityWindow = Number(account.inactivityWindow as bigint);
  const gracePeriod = Number(account.gracePeriod as bigint);
  const crankFeeBps = Number(account.crankFeeBps);
  const lastActivity = Number(account.lastActivity as bigint);
  const createdAt = Number(account.createdAt as bigint);

  const now = Math.floor(Date.now() / 1000);
  const displayStatus =
    dbStatus ??
    computeDisplayStatus(
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

  // Parse beneficiaries
  const numBeneficiaries = Number(account.numBeneficiaries ?? 0);
  const rawBeneficiaries = (account.beneficiaries ?? []) as Array<{
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

  // Parse assets
  const numAssets = Number(account.numAssets ?? 0);
  const rawAssets = (account.assetConfigs ?? []) as Array<{
    mint: PublicKey;
    amount: bigint;
  }>;
  const assets = rawAssets.slice(0, numAssets).map((a) => ({
    mint: a.mint,
    amount: BigInt(a.amount.toString()),
  }));

  // Calculate total USD value
  let totalValueUsd = 0;
  for (const asset of assets) {
    const mintStr = asset.mint.toBase58();
    const price = priceMap.get(mintStr) ?? 0;
    // Assume 9 decimals for SOL, 6 for stablecoins — rough estimate
    const decimals = mintStr.includes("1111111111111") ? 9 : 6;
    totalValueUsd += Number(asset.amount) / 10 ** decimals * price;
  }

  return {
    pubkey,
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
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * List all vaults for a given owner.
 *
 * Fetches onchain vault accounts via getProgramAccounts, then merges
 * with DB cache for activity logs and alert status.
 *
 * Query parameters:
 *   - `owner` — Base58-encoded owner public key (required)
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Parse & validate query params
  const searchParams = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    owner: searchParams.get("owner"),
  });

  if (!parsed.success) {
    const error: ApiError = {
      error: "Invalid request parameters",
      code: "VALIDATION_ERROR",
      details: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
    return Response.json(error, { status: 400, headers: CORS_HEADERS });
  }

  const ownerPubkey = new PublicKey(parsed.data.owner);

  // Fetch token prices for USD value calculation
  const prices = await getTokenPrices();
  const priceMap = new Map(prices.map((p) => [p.mint, p.priceUsd]));

  // Fetch onchain vault accounts
  let onchainVaults: VaultDisplay[] = [];
  try {
    const program = getReadonlyProgram();

    // Access account namespace via bracket notation since IDL is generic Idl.
    // The cast is necessary because AccountNamespace<Idl> doesn't expose
    // dynamic account names at the type level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultAccount = (program.account as Record<string, any>)["vault"];
    const accounts = await vaultAccount.all([
      {
        memcmp: {
          offset: 8, // After discriminator
          bytes: ownerPubkey.toBase58(),
        },
      },
    ]);

    onchainVaults = accounts.map(
      (acc: { publicKey: PublicKey; account: Record<string, unknown> }) =>
        buildVaultDisplay(
          acc.publicKey.toBase58(),
          acc.account,
          priceMap
        )
    );
  } catch (err) {
    console.error("[vaults] Failed to fetch onchain accounts:", err);
    // Graceful degradation: continue with DB data only
  }

  // Merge with DB cache
  let dbVaults: Awaited<ReturnType<typeof getVaultsByOwner>> = [];
  try {
    dbVaults = await getVaultsByOwner(parsed.data.owner);
  } catch (err) {
    console.error("[vaults] Failed to fetch DB vaults:", err);
    dbVaults = [];
  }

  // Create a map of DB vaults by pubkey for merging
  const dbMap = new Map(dbVaults.map((v) => [v.vaultPubkey, v]));

  // Enrich onchain vaults with DB data
  const enrichedVaults = onchainVaults.map((vault) => {
    const dbVault = dbMap.get(vault.pubkey);
    return {
      ...vault,
      activityLog: dbVault?.activityLog ?? [],
      alertConfig: dbVault?.alertConfig ?? null,
    };
  });

  // Include any DB-only vaults that aren't in onchain results
  // (e.g., if the onchain fetch failed but DB has cached data)
  if (onchainVaults.length === 0 && dbVaults.length > 0) {
    for (const dbVault of dbVaults) {
      enrichedVaults.push({
        pubkey: dbVault.vaultPubkey,
        owner: dbVault.ownerPubkey,
        vaultId: Number(dbVault.vaultIdOnchain),
        name: dbVault.name,
        note: dbVault.note,
        displayStatus: dbVault.status as VaultDisplayStatus,
        onchainStatus: VaultStatus.Active,
        beneficiaries: dbVault.beneficiaries.map((b) => ({
          wallet: new PublicKey(b.wallet),
          shareBps: b.shareBps,
          name: b.name,
        })),
        assets: dbVault.assets.map((a) => ({
          mint: new PublicKey(a.mint),
          amount: a.amount,
        })),
        inactivityWindowDays: secondsToDays(dbVault.inactivityWindowSecs),
        gracePeriodDays: secondsToDays(dbVault.gracePeriodSecs),
        crankFeeBps: dbVault.crankFeeBps,
        lastActivityTimestamp: Math.floor(
          dbVault.lastActivity.getTime() / 1000
        ),
        createdAtTimestamp: Math.floor(dbVault.createdAt.getTime() / 1000),
        daysElapsed: 0,
        daysRemaining: secondsToDays(dbVault.inactivityWindowSecs),
        progressPercent: 0,
        totalValueUsd: 0,
        activityLog: dbVault.activityLog,
        alertConfig: dbVault.alertConfig,
      });
    }
  }

  const response: ApiResponse<typeof enrichedVaults> = {
    data: enrichedVaults,
    meta: {
      version: "0.1.0",
      timestamp: Date.now(),
    },
  };

  return Response.json(response, { status: 200, headers: CORS_HEADERS });
}

/**
 * Handle CORS preflight requests.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
