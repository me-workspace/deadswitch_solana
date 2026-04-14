import { type NextRequest } from "next/server";
import type { ApiResponse, ApiError } from "@deadswitch/sdk";
import {
  getActiveVaultsForAlerts,
  upsertAlertConfig,
  cleanOldWebhooks,
} from "@/lib/db/queries";
import { sendAlertEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Alert threshold levels ordered from lowest to highest */
const THRESHOLDS = [50, 75, 90, 100] as const;
type AlertThreshold = (typeof THRESHOLDS)[number];

/** Result summary for a single vault alert check */
interface VaultAlertResult {
  vaultPubkey: string;
  vaultName: string;
  percentElapsed: number;
  thresholdCrossed: AlertThreshold | null;
  alertSent: boolean;
  skipped: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the highest threshold that has been crossed by the given
 * elapsed percentage.
 *
 * @param percentElapsed - Percentage of inactivity window elapsed (0-100+)
 * @returns The highest crossed threshold, or null if below 50%
 */
function getThresholdCrossed(percentElapsed: number): AlertThreshold | null {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (percentElapsed >= THRESHOLDS[i]) {
      return THRESHOLDS[i];
    }
  }
  return null;
}

/**
 * Compute the number of days remaining before vault execution.
 * For active vaults (< 100%), this is until inactivity window ends.
 * For grace-period vaults (>= 100%), this is until grace period ends.
 *
 * @param elapsedSecs - Seconds since last activity
 * @param inactivityWindowSecs - Total inactivity window in seconds
 * @param gracePeriodSecs - Grace period in seconds
 * @returns Approximate days remaining (floored, minimum 0)
 */
function computeDaysRemaining(
  elapsedSecs: number,
  inactivityWindowSecs: number,
  gracePeriodSecs: number
): number {
  const totalWindowSecs = inactivityWindowSecs + gracePeriodSecs;
  const remainingSecs = Math.max(0, totalWindowSecs - elapsedSecs);
  return Math.floor(remainingSecs / 86_400);
}

// ---------------------------------------------------------------------------
// GET handler (Vercel Cron)
// ---------------------------------------------------------------------------

/**
 * Hourly cron job that checks all active vaults and sends inactivity
 * alert emails when thresholds are crossed.
 *
 * Protected by the `CRON_SECRET` environment variable -- Vercel sends
 * this as an `Authorization: Bearer <secret>` header on cron invocations.
 *
 * Logic per vault:
 * 1. Compute `elapsed_percent = (now - last_activity) / inactivity_window * 100`
 * 2. Determine the highest threshold crossed (50%, 75%, 90%, 100%)
 * 3. If threshold > last_alert_threshold, send email and update config
 * 4. During grace period (100%), send daily alerts
 * 5. Clean processed_webhooks older than 7 days
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cron-alerts] CRON_SECRET not configured");
    const error: ApiError = {
      error: "Cron job not configured",
      code: "MISCONFIGURED",
    };
    return Response.json(error, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader?.trim() ?? "";

  if (token !== cronSecret) {
    const error: ApiError = {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
    };
    return Response.json(error, { status: 401 });
  }

  const results: VaultAlertResult[] = [];
  let cleanedWebhooks = 0;

  // Fetch all active vaults with alert configs
  let vaultsWithAlerts;
  try {
    vaultsWithAlerts = await getActiveVaultsForAlerts();
  } catch (err) {
    console.error("[cron-alerts] Failed to fetch active vaults:", err);
    const error: ApiError = {
      error: "Failed to fetch vaults",
      code: "DB_ERROR",
    };
    return Response.json(error, { status: 500 });
  }

  const now = new Date();
  const nowMs = now.getTime();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://deadswitch.xyz";

  // Process each vault
  for (const vault of vaultsWithAlerts) {
    const { alertConfig } = vault;
    const result: VaultAlertResult = {
      vaultPubkey: vault.vaultPubkey,
      vaultName: vault.name,
      percentElapsed: 0,
      thresholdCrossed: null,
      alertSent: false,
      skipped: false,
    };

    // Skip if no email configured
    if (!alertConfig.email) {
      result.skipped = true;
      result.reason = "No email configured";
      results.push(result);
      continue;
    }

    // Compute elapsed percentage
    const lastActivityMs = vault.lastActivity.getTime();
    const elapsedSecs = Math.max(0, (nowMs - lastActivityMs) / 1000);
    const inactivityWindowSecs = vault.inactivityWindowSecs;
    const percentElapsed =
      inactivityWindowSecs > 0
        ? (elapsedSecs / inactivityWindowSecs) * 100
        : 0;

    result.percentElapsed = Math.round(percentElapsed * 100) / 100;

    // Determine threshold crossed
    const thresholdCrossed = getThresholdCrossed(percentElapsed);
    result.thresholdCrossed = thresholdCrossed;

    if (!thresholdCrossed) {
      result.skipped = true;
      result.reason = "Below 50% threshold";
      results.push(result);
      continue;
    }

    const lastAlertThreshold = alertConfig.lastAlertThreshold ?? 0;

    // Check if we should send an alert
    let shouldSend = false;

    if (thresholdCrossed > lastAlertThreshold) {
      // New threshold crossed -- always send
      shouldSend = true;
    } else if (thresholdCrossed === 100 && lastAlertThreshold === 100) {
      // During grace period, send daily alerts
      const lastAlertSentAt = alertConfig.lastAlertSentAt;
      if (lastAlertSentAt) {
        const hoursSinceLastAlert =
          (nowMs - lastAlertSentAt.getTime()) / (1000 * 60 * 60);
        shouldSend = hoursSinceLastAlert >= 24;
      } else {
        shouldSend = true;
      }
    }

    if (!shouldSend) {
      result.skipped = true;
      result.reason = `Already alerted at ${lastAlertThreshold}% threshold`;
      results.push(result);
      continue;
    }

    // Compute days remaining for the email
    const daysRemaining = computeDaysRemaining(
      elapsedSecs,
      inactivityWindowSecs,
      vault.gracePeriodSecs
    );

    const resetUrl = `${appUrl}/vault/${vault.vaultPubkey}`;

    // Send the alert email
    const emailSent = await sendAlertEmail(
      alertConfig.email,
      vault.name,
      thresholdCrossed,
      daysRemaining,
      resetUrl
    );

    result.alertSent = emailSent;

    if (emailSent) {
      // Update the alert config with the new threshold
      try {
        await upsertAlertConfig({
          vaultId: vault.id,
          lastAlertThreshold: thresholdCrossed,
          lastAlertSentAt: now,
        });
      } catch (err) {
        console.error(
          `[cron-alerts] Failed to update alert config for vault ${vault.vaultPubkey}:`,
          err
        );
      }
    }

    results.push(result);
  }

  // Clean old processed webhooks (older than 7 days)
  try {
    cleanedWebhooks = await cleanOldWebhooks(7);
    if (cleanedWebhooks > 0) {
      console.info(
        `[cron-alerts] Cleaned ${cleanedWebhooks} old webhook records`
      );
    }
  } catch (err) {
    console.error("[cron-alerts] Failed to clean old webhooks:", err);
  }

  const alertsSent = results.filter((r) => r.alertSent).length;
  const alertsSkipped = results.filter((r) => r.skipped).length;

  console.info(
    `[cron-alerts] Processed ${vaultsWithAlerts.length} vaults: ` +
      `${alertsSent} alerts sent, ${alertsSkipped} skipped, ` +
      `${cleanedWebhooks} webhooks cleaned`
  );

  const response: ApiResponse<{
    processed: number;
    alertsSent: number;
    alertsSkipped: number;
    cleanedWebhooks: number;
    details: VaultAlertResult[];
  }> = {
    data: {
      processed: vaultsWithAlerts.length,
      alertsSent,
      alertsSkipped,
      cleanedWebhooks,
      details: results,
    },
    meta: { version: "0.1.0", timestamp: Date.now() },
  };

  return Response.json(response, { status: 200 });
}
