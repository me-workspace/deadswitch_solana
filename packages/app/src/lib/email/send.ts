import { Resend } from "resend";
import {
  renderAlertEmail,
  getAlertSubject,
  type AlertEmailParams,
} from "./templates";

/** Cached Resend client instance */
let _resend: Resend | null = null;

/**
 * Get or create a Resend client instance.
 *
 * @returns Resend client
 * @throws {Error} If RESEND_API_KEY is not configured
 */
function getResendClient(): Resend {
  if (_resend) return _resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY environment variable is not set");
  }

  _resend = new Resend(apiKey);
  return _resend;
}

/**
 * Send an inactivity alert email to a vault owner.
 *
 * Uses Resend for delivery. Falls back to console logging
 * if the email service is unavailable (graceful degradation
 * for development/testing).
 *
 * @param to - Recipient email address
 * @param vaultName - Human-readable vault name
 * @param percentElapsed - Inactivity percentage (50, 75, 90, or 100)
 * @param daysRemaining - Days until vault execution
 * @param resetUrl - URL to reset the vault timer
 * @returns True if the email was sent successfully
 */
export async function sendAlertEmail(
  to: string,
  vaultName: string,
  percentElapsed: 50 | 75 | 90 | 100,
  daysRemaining: number,
  resetUrl: string
): Promise<boolean> {
  const params: AlertEmailParams = {
    vaultName,
    percentElapsed,
    daysRemaining,
    resetUrl,
  };

  const subject = getAlertSubject(percentElapsed, vaultName);
  const html = renderAlertEmail(percentElapsed, params);

  const fromEmail =
    process.env.ALERT_FROM_EMAIL ?? "alerts@deadswitch.app";

  try {
    const resend = getResendClient();

    const { error } = await resend.emails.send({
      from: `Deadswitch Alerts <${fromEmail}>`,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error("[email] Resend API returned error:", error);
      return false;
    }

    console.info(
      `[email] Alert sent: ${percentElapsed}% to ${to} for vault "${vaultName}"`
    );
    return true;
  } catch (err) {
    // Graceful degradation: log the alert content so it is not lost
    console.error("[email] Failed to send alert email:", err);
    console.info(
      `[email] Fallback log — Alert ${percentElapsed}% for vault "${vaultName}" ` +
        `to ${to}: ${daysRemaining} days remaining. Reset: ${resetUrl}`
    );
    return false;
  }
}
