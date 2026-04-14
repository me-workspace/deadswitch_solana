import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import { validateWebhookSignature } from "@/lib/helius/webhook";
import type { HeliusWebhookPayload } from "@/lib/helius/types";
import {
  isWebhookProcessed,
  markWebhookProcessed,
  getVaultsByOwner,
  logHeartbeat,
} from "@/lib/db/queries";
import { submitHeartbeatFromBackend } from "@/lib/solana/instructions";
import { PROGRAM_ID } from "@/lib/solana/program";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// In-memory rate limiter (per IP, resets every 60s)
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

/**
 * Check whether a client IP has exceeded the rate limit.
 *
 * @param ip - Client IP address
 * @returns True if the request should be rejected
 */
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }

  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a success JSON response (always 200 for webhooks).
 */
function ok(message: string): Response {
  const body: ApiResponse<{ message: string }> = {
    data: { message },
    meta: { version: "0.1.0", timestamp: Date.now() },
  };
  return Response.json(body, { status: 200 });
}

/**
 * Extract unique account addresses involved in the webhook transactions
 * that could be vault owners (fee payers / signers).
 */
function extractOwnerCandidates(
  payload: HeliusWebhookPayload
): Set<string> {
  const candidates = new Set<string>();

  for (const tx of payload) {
    // The fee payer is usually the signer / owner
    if (tx.feePayer) {
      candidates.add(tx.feePayer);
    }

    // Also check account data for anyone interacting with the program
    for (const instruction of tx.instructions) {
      if (instruction.programId === PROGRAM_ID.toBase58()) {
        // First account in Deadswitch instructions is typically the owner/authority
        if (instruction.accounts.length > 0) {
          candidates.add(instruction.accounts[0]);
        }
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Helius webhook endpoint.
 *
 * Receives enhanced transaction events from Helius, validates the
 * authorization header, checks idempotency, and submits heartbeat
 * transactions for any active vaults owned by the transacting wallet.
 *
 * Always returns 200 to prevent Helius from retrying.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Rate limiting
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (isRateLimited(clientIp)) {
    // Still return 200 so Helius doesn't retry, but log it
    console.warn(`[webhook] Rate limited: ${clientIp}`);
    return ok("rate_limited");
  }

  // Validate webhook secret
  const webhookSecret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook] HELIUS_WEBHOOK_SECRET not configured");
    return ok("misconfigured");
  }

  const authHeader = request.headers.get("authorization");
  if (!validateWebhookSignature(authHeader, webhookSecret)) {
    console.warn("[webhook] Invalid webhook signature");
    return ok("unauthorized");
  }

  // Parse payload
  let payload: HeliusWebhookPayload;
  try {
    payload = (await request.json()) as HeliusWebhookPayload;
  } catch {
    console.error("[webhook] Failed to parse webhook body");
    return ok("invalid_body");
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return ok("empty_payload");
  }

  // Process each transaction
  for (const tx of payload) {
    try {
      // Idempotency check
      if (!tx.signature) continue;

      const alreadyProcessed = await isWebhookProcessed(tx.signature).catch(
        () => false
      );
      if (alreadyProcessed) {
        console.info(
          `[webhook] Skipping already-processed tx: ${tx.signature}`
        );
        continue;
      }

      // Mark as processed early to prevent race conditions
      await markWebhookProcessed(tx.signature).catch((err) => {
        console.error("[webhook] Failed to mark processed:", err);
      });

      // Find vault owners from the transaction
      const ownerCandidates = extractOwnerCandidates([tx]);

      for (const ownerPubkey of ownerCandidates) {
        // Validate it's a valid pubkey
        try {
          new PublicKey(ownerPubkey);
        } catch {
          continue;
        }

        // Look up active vaults for this owner
        let ownerVaults;
        try {
          ownerVaults = await getVaultsByOwner(ownerPubkey);
        } catch (err) {
          console.error(
            `[webhook] DB error fetching vaults for ${ownerPubkey}:`,
            err
          );
          continue;
        }

        const activeVaults = ownerVaults.filter(
          (v) => v.status === "active" || v.status === "warning"
        );

        // Submit heartbeat for each active vault
        for (const vault of activeVaults) {
          try {
            const vaultPubkey = new PublicKey(vault.vaultPubkey);
            const heartbeatSig =
              await submitHeartbeatFromBackend(vaultPubkey);

            // Log the heartbeat in DB
            await logHeartbeat({
              vaultId: vault.id,
              txSignature: heartbeatSig,
              sourceTx: tx.signature,
              activityType: "heartbeat",
              description: `Auto-heartbeat from wallet activity (source: ${tx.type})`,
            }).catch((err) => {
              console.error("[webhook] Failed to log heartbeat:", err);
            });

            console.info(
              `[webhook] Heartbeat recorded for vault ${vault.vaultPubkey} ` +
                `(source tx: ${tx.signature})`
            );
          } catch (err) {
            console.error(
              `[webhook] Failed to submit heartbeat for vault ${vault.vaultPubkey}:`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error(`[webhook] Error processing tx ${tx.signature}:`, err);
    }
  }

  return ok("processed");
}
