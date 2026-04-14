/**
 * HTML email templates for vault inactivity alerts.
 *
 * Each template corresponds to a threshold percentage:
 * - 50% — Early warning
 * - 75% — Moderate warning
 * - 90% — Urgent warning
 * - 100% — Grace period (final warning before execution)
 */

/** Shared parameters for all alert email templates */
export interface AlertEmailParams {
  /** Human-readable vault name */
  vaultName: string;
  /** Percentage of inactivity window elapsed (50, 75, 90, or 100) */
  percentElapsed: number;
  /** Number of days remaining before execution */
  daysRemaining: number;
  /** URL to reset/heartbeat the vault */
  resetUrl: string;
}

/**
 * Base HTML layout wrapper for all alert emails.
 */
function baseLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .header { padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .body { padding: 24px; color: #27272a; line-height: 1.6; }
    .body p { margin: 0 0 16px; }
    .status-box { padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center; }
    .status-box .metric { font-size: 36px; font-weight: 700; margin: 8px 0; }
    .status-box .label { font-size: 14px; color: #71717a; }
    .cta-button { display: inline-block; padding: 14px 32px; border-radius: 8px; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; margin: 16px 0; }
    .footer { padding: 24px; text-align: center; font-size: 12px; color: #a1a1aa; border-top: 1px solid #e4e4e7; }
    .footer a { color: #a1a1aa; }
  </style>
</head>
<body>
  <div style="padding: 24px;">
    <div class="container">
      ${content}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS in email templates.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Generate the 50% inactivity warning email.
 * Tone: informational, calm.
 */
export function render50PercentAlert(params: AlertEmailParams): string {
  const { vaultName, daysRemaining, resetUrl } = params;

  return baseLayout(
    `Deadswitch — Inactivity Notice`,
    `
    <div class="header" style="background: #eff6ff;">
      <h1 style="color: #1d4ed8;">Inactivity Notice</h1>
    </div>
    <div class="body">
      <p>Your vault <strong>${escapeHtml(vaultName)}</strong> has reached <strong>50%</strong> of its inactivity window.</p>
      <div class="status-box" style="background: #eff6ff; border: 1px solid #bfdbfe;">
        <div class="label">Days remaining</div>
        <div class="metric" style="color: #1d4ed8;">${daysRemaining}</div>
        <div class="label">before grace period begins</div>
      </div>
      <p>If you are still active, simply sign a transaction or click the button below to reset the timer.</p>
      <div style="text-align: center;">
        <a href="${escapeHtml(resetUrl)}" class="cta-button" style="background: #2563eb;">Reset Timer</a>
      </div>
      <p style="font-size: 14px; color: #71717a;">No action is needed if you want the vault to continue its countdown.</p>
    </div>
    <div class="footer">
      <p>Deadswitch — Onchain Inheritance Protocol on Solana</p>
      <p>You received this because you enabled alerts for this vault.</p>
    </div>
    `
  );
}

/**
 * Generate the 75% inactivity warning email.
 * Tone: moderate urgency.
 */
export function render75PercentAlert(params: AlertEmailParams): string {
  const { vaultName, daysRemaining, resetUrl } = params;

  return baseLayout(
    `Deadswitch — Inactivity Warning`,
    `
    <div class="header" style="background: #fef9c3;">
      <h1 style="color: #a16207;">Inactivity Warning</h1>
    </div>
    <div class="body">
      <p>Your vault <strong>${escapeHtml(vaultName)}</strong> has reached <strong>75%</strong> of its inactivity window.</p>
      <div class="status-box" style="background: #fef9c3; border: 1px solid #fde68a;">
        <div class="label">Days remaining</div>
        <div class="metric" style="color: #a16207;">${daysRemaining}</div>
        <div class="label">before grace period begins</div>
      </div>
      <p>Your vault is getting closer to triggering the grace period. If you are still active, please reset the timer now.</p>
      <div style="text-align: center;">
        <a href="${escapeHtml(resetUrl)}" class="cta-button" style="background: #ca8a04;">Reset Timer</a>
      </div>
    </div>
    <div class="footer">
      <p>Deadswitch — Onchain Inheritance Protocol on Solana</p>
      <p>You received this because you enabled alerts for this vault.</p>
    </div>
    `
  );
}

/**
 * Generate the 90% inactivity warning email.
 * Tone: urgent.
 */
export function render90PercentAlert(params: AlertEmailParams): string {
  const { vaultName, daysRemaining, resetUrl } = params;

  return baseLayout(
    `Deadswitch — URGENT: Vault Almost Triggered`,
    `
    <div class="header" style="background: #fee2e2;">
      <h1 style="color: #dc2626;">Urgent: Vault Almost Triggered</h1>
    </div>
    <div class="body">
      <p>Your vault <strong>${escapeHtml(vaultName)}</strong> has reached <strong>90%</strong> of its inactivity window.</p>
      <div class="status-box" style="background: #fee2e2; border: 1px solid #fecaca;">
        <div class="label">Only</div>
        <div class="metric" style="color: #dc2626;">${daysRemaining}</div>
        <div class="label">days remaining before grace period</div>
      </div>
      <p><strong>Action required:</strong> If you do not reset the timer, the grace period will begin soon, after which your vault assets will be distributed to your beneficiaries.</p>
      <div style="text-align: center;">
        <a href="${escapeHtml(resetUrl)}" class="cta-button" style="background: #dc2626;">Reset Timer Now</a>
      </div>
    </div>
    <div class="footer">
      <p>Deadswitch — Onchain Inheritance Protocol on Solana</p>
      <p>You received this because you enabled alerts for this vault.</p>
    </div>
    `
  );
}

/**
 * Generate the 100% (grace period) alert email.
 * Tone: critical / final warning.
 */
export function render100PercentAlert(params: AlertEmailParams): string {
  const { vaultName, daysRemaining, resetUrl } = params;

  return baseLayout(
    `Deadswitch — CRITICAL: Grace Period Active`,
    `
    <div class="header" style="background: #450a0a;">
      <h1 style="color: #ffffff;">Grace Period Active</h1>
    </div>
    <div class="body">
      <p>Your vault <strong>${escapeHtml(vaultName)}</strong> has entered its <strong>grace period</strong>. The inactivity window has fully elapsed.</p>
      <div class="status-box" style="background: #450a0a; border: 1px solid #991b1b;">
        <div class="label" style="color: #fca5a5;">Grace period ends in</div>
        <div class="metric" style="color: #ffffff;">${daysRemaining} days</div>
        <div class="label" style="color: #fca5a5;">Then assets will be distributed</div>
      </div>
      <p style="color: #dc2626; font-weight: 600;">This is your final warning. Once the grace period ends, anyone can trigger the redistribution of your vault assets to the designated beneficiaries.</p>
      <div style="text-align: center;">
        <a href="${escapeHtml(resetUrl)}" class="cta-button" style="background: #dc2626;">Reset Timer Immediately</a>
      </div>
    </div>
    <div class="footer">
      <p>Deadswitch — Onchain Inheritance Protocol on Solana</p>
      <p>You received this because you enabled alerts for this vault.</p>
    </div>
    `
  );
}

/**
 * Select the appropriate template based on the threshold percentage.
 *
 * @param threshold - The alert threshold (50, 75, 90, or 100)
 * @param params - Template parameters
 * @returns Rendered HTML string
 */
export function renderAlertEmail(
  threshold: 50 | 75 | 90 | 100,
  params: AlertEmailParams
): string {
  switch (threshold) {
    case 50:
      return render50PercentAlert(params);
    case 75:
      return render75PercentAlert(params);
    case 90:
      return render90PercentAlert(params);
    case 100:
      return render100PercentAlert(params);
  }
}

/**
 * Get the email subject line for a given threshold.
 *
 * @param threshold - The alert threshold
 * @param vaultName - Vault name for the subject
 * @returns Subject line string
 */
export function getAlertSubject(
  threshold: 50 | 75 | 90 | 100,
  vaultName: string
): string {
  const safe = vaultName.slice(0, 50);
  switch (threshold) {
    case 50:
      return `Deadswitch: Inactivity notice for "${safe}"`;
    case 75:
      return `Deadswitch: Warning — "${safe}" at 75% inactivity`;
    case 90:
      return `URGENT: "${safe}" is almost triggered`;
    case 100:
      return `CRITICAL: Grace period active for "${safe}"`;
  }
}
