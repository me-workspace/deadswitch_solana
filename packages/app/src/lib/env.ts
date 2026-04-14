/**
 * Startup environment variable validation.
 *
 * Call this early in app initialization to surface missing
 * configuration before requests start failing.
 */

const REQUIRED_SERVER_VARS = [
  "DATABASE_URL",
  "HEARTBEAT_AUTHORITY_PRIVATE_KEY",
] as const;

const OPTIONAL_SERVER_VARS = [
  "HELIUS_API_KEY",
  "HELIUS_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "CRON_SECRET",
] as const;

/**
 * Log warnings/errors for missing environment variables.
 * Required vars log as errors; optional vars log as warnings.
 */
export function validateEnv(): void {
  const missing = REQUIRED_SERVER_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`[env] Missing required env vars: ${missing.join(", ")}`);
  }
  const missingOptional = OPTIONAL_SERVER_VARS.filter((v) => !process.env[v]);
  if (missingOptional.length > 0) {
    console.warn(
      `[env] Missing optional env vars: ${missingOptional.join(", ")}`
    );
  }
}
