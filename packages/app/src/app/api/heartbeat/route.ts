import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import { getVaultByPubkey, logHeartbeat } from "@/lib/db/queries";
import { getConnection } from "@/lib/solana/program";

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
  txSignature: z
    .string()
    .min(64)
    .max(128)
    .regex(/^[A-Za-z0-9]+$/, "Transaction signature must be alphanumeric"),
});

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Record a heartbeat for a vault.
 *
 * The frontend calls this after a user manually confirms activity
 * (e.g., signs a heartbeat transaction). This endpoint verifies the
 * transaction exists onchain and logs it in the database.
 *
 * Body:
 *   - `vaultPublicKey` — Base58-encoded vault PDA
 *   - `txSignature` — The Solana transaction signature to verify
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

  const { vaultPublicKey, txSignature } = parsed.data;

  // Verify the transaction exists onchain
  try {
    const connection = getConnection();
    const txResult = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txResult) {
      const error: ApiError = {
        error:
          "Transaction not found onchain. It may not be confirmed yet — please try again.",
        code: "TX_NOT_FOUND",
      };
      return Response.json(error, { status: 404 });
    }

    if (txResult.meta?.err) {
      const error: ApiError = {
        error: "Transaction failed onchain",
        code: "TX_FAILED",
      };
      return Response.json(error, { status: 400 });
    }
  } catch (err) {
    console.error("[heartbeat] Failed to verify tx onchain:", err);
    // Continue anyway — we don't want to block the user if RPC is flaky
  }

  // Look up the vault in DB
  let dbVault;
  try {
    dbVault = await getVaultByPubkey(vaultPublicKey);
  } catch (err) {
    console.error("[heartbeat] DB error looking up vault:", err);
  }

  if (!dbVault) {
    // Vault not in DB yet — this is okay for first-time heartbeats
    // The vault will be cached when the user visits the dashboard
    const response: ApiResponse<{ recorded: boolean; message: string }> = {
      data: {
        recorded: false,
        message:
          "Heartbeat acknowledged but vault not yet cached in database. " +
          "It will be indexed on next vault list fetch.",
      },
      meta: { version: "0.1.0", timestamp: Date.now() },
    };
    return Response.json(response, { status: 200 });
  }

  // Log the heartbeat
  try {
    await logHeartbeat({
      vaultId: dbVault.id,
      txSignature,
      activityType: "manual",
      description: "Manual heartbeat confirmed by vault owner",
    });
  } catch (err) {
    console.error("[heartbeat] Failed to log heartbeat:", err);
    // Non-fatal: the onchain state is the source of truth
  }

  const response: ApiResponse<{ recorded: boolean }> = {
    data: { recorded: true },
    meta: { version: "0.1.0", timestamp: Date.now() },
  };

  return Response.json(response, { status: 200 });
}
