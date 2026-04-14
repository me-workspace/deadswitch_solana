import type { HeliusWebhookResponse } from "./types";

/**
 * Validate the webhook signature sent by Helius in the Authorization header.
 *
 * Helius sends the shared secret as a Bearer token:
 *   `Authorization: Bearer <HELIUS_WEBHOOK_SECRET>`
 *
 * @param authHeader - The raw Authorization header value
 * @param secret - The expected HELIUS_WEBHOOK_SECRET
 * @returns True if the header matches the expected secret
 */
export function validateWebhookSignature(
  authHeader: string | null,
  secret: string
): boolean {
  if (!authHeader) return false;

  // Helius sends: "Bearer <secret>" or just the raw secret
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (token.length === 0 || secret.length === 0) return false;

  // Constant-time comparison to prevent timing attacks
  if (token.length !== secret.length) return false;

  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Register an enhanced webhook with Helius to monitor a wallet's transactions.
 *
 * @param accountAddresses - Array of wallet/account addresses to monitor
 * @param webhookUrl - The URL Helius should POST events to
 * @returns The webhook registration response from Helius
 * @throws {Error} If the Helius API key is not configured or the request fails
 */
export async function registerWebhook(
  accountAddresses: string[],
  webhookUrl: string
): Promise<HeliusWebhookResponse> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY environment variable is not set");
  }

  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL: webhookUrl,
        transactionTypes: ["Any"],
        accountAddresses,
        webhookType: "enhanced",
        authHeader: process.env.HELIUS_WEBHOOK_SECRET ?? "",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Helius webhook registration failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as HeliusWebhookResponse;
  return data;
}

/**
 * Remove (unregister) a webhook from Helius by its webhook ID.
 *
 * @param webhookId - The Helius webhook ID to remove
 * @throws {Error} If the Helius API key is not configured or the request fails
 */
export async function removeWebhook(webhookId: string): Promise<void> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY environment variable is not set");
  }

  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks/${encodeURIComponent(webhookId)}?api-key=${encodeURIComponent(apiKey)}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Helius webhook removal failed (${response.status}): ${errorText}`
    );
  }
}
