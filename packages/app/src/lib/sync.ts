/**
 * Sync vault state to the database after an onchain operation.
 * Non-blocking — failures are logged but do not affect the user.
 *
 * @param params - Sync parameters describing the operation
 */
export async function syncVaultToDb(params: {
  vaultPubkey: string;
  activityType: "heartbeat" | "manual" | "update" | "top_up" | "cancellation";
  txSignature: string;
  description?: string;
}): Promise<void> {
  try {
    await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultPublicKey: params.vaultPubkey,
        txSignature: params.txSignature,
      }),
    });
  } catch (err) {
    console.error("[sync] Failed to sync vault operation:", err);
  }
}
