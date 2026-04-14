import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { ApiResponse, ApiError, AlertConfig } from "@deadswitch/sdk";
import {
  getVaultByPubkey,
  getAlertConfig,
  upsertAlertConfig,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  vaultPublicKey: z
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
  email: z
    .string()
    .email("Invalid email address")
    .max(255)
    .nullable()
    .optional(),
  enabled: z.boolean().optional().default(true),
});

// ---------------------------------------------------------------------------
// PUT handler
// ---------------------------------------------------------------------------

/**
 * Create or update alert configuration for a vault.
 *
 * Body:
 *   - `vaultPublicKey` — Base58-encoded vault PDA
 *   - `email` — Email address for alerts (or null to disable email)
 *   - `enabled` — Whether alerts are enabled (default: true)
 */
export async function PUT(request: NextRequest): Promise<Response> {
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

  const { vaultPublicKey, email, enabled } = parsed.data;

  // Look up the vault in DB
  let dbVault;
  try {
    dbVault = await getVaultByPubkey(vaultPublicKey);
  } catch (err) {
    console.error("[alerts] DB error looking up vault:", err);
    const error: ApiError = {
      error: "Failed to look up vault",
      code: "DB_ERROR",
    };
    return Response.json(error, { status: 500 });
  }

  if (!dbVault) {
    const error: ApiError = {
      error:
        "Vault not found in database. Please visit the dashboard first to cache vault data.",
      code: "NOT_FOUND",
    };
    return Response.json(error, { status: 404 });
  }

  // Upsert alert config
  try {
    const alertConfig = await upsertAlertConfig({
      vaultId: dbVault.id,
      email: email ?? null,
      enabled,
    });

    const responseData: AlertConfig = {
      email: alertConfig.email,
      telegramId: alertConfig.telegramId,
      enabled: alertConfig.enabled,
      lastAlertThreshold: alertConfig.lastAlertThreshold,
    };

    const response: ApiResponse<AlertConfig> = {
      data: responseData,
      meta: { version: "0.1.0", timestamp: Date.now() },
    };

    return Response.json(response, { status: 200 });
  } catch (err) {
    console.error("[alerts] Failed to upsert alert config:", err);
    const error: ApiError = {
      error: "Failed to update alert configuration",
      code: "DB_ERROR",
    };
    return Response.json(error, { status: 500 });
  }
}
