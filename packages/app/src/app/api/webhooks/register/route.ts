import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import { registerWebhook } from "@/lib/helius/webhook";
import { getVaultsByOwner } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  ownerWallet: z
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
// POST handler
// ---------------------------------------------------------------------------

/**
 * Register a Helius enhanced webhook to monitor a wallet's transactions.
 *
 * Called after vault creation to enable automatic heartbeats when the
 * owner wallet transacts onchain. Webhook failure is non-blocking --
 * the vault still works with manual heartbeats.
 *
 * Body:
 *   - `ownerWallet` -- Base58-encoded wallet address to monitor
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

  const { ownerWallet } = parsed.data;

  // Verify that the owner has at least one active vault in the DB
  try {
    const ownerVaults = await getVaultsByOwner(ownerWallet);
    const activeVaults = ownerVaults.filter(
      (v) => v.status === "active" || v.status === "warning"
    );
    if (activeVaults.length === 0) {
      const error: ApiError = {
        error: "No active vaults found for this wallet. Create a vault first.",
        code: "UNAUTHORIZED",
      };
      return Response.json(error, { status: 403 });
    }
  } catch (err) {
    console.error("[webhook-register] Failed to verify owner vaults:", err);
    const error: ApiError = {
      error: "Failed to verify wallet ownership",
      code: "DB_ERROR",
    };
    return Response.json(error, { status: 500 });
  }

  // Always use the app's own webhook URL — never accept user-provided URLs
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://deadswitch.xyz";
  const targetUrl = `${appUrl}/api/webhooks/helius`;

  // Register the webhook with Helius
  try {
    const result = await registerWebhook([ownerWallet], targetUrl);

    console.info(
      `[webhook-register] Registered webhook ${result.webhookID} for wallet ${ownerWallet}`
    );

    const response: ApiResponse<{ webhookId: string; wallet: string }> = {
      data: {
        webhookId: result.webhookID,
        wallet: ownerWallet,
      },
      meta: { version: "0.1.0", timestamp: Date.now() },
    };

    return Response.json(response, { status: 201 });
  } catch (err) {
    console.error("[webhook-register] Failed to register webhook:", err);

    const error: ApiError = {
      error: "Failed to register webhook. Please try again later.",
      code: "WEBHOOK_ERROR",
    };

    return Response.json(error, { status: 502 });
  }
}
