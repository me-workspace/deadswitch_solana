/// Timing bounds (in seconds)
pub const MIN_INACTIVITY_WINDOW: i64 = 2_592_000; // 30 days
pub const MAX_INACTIVITY_WINDOW: i64 = 31_536_000; // 365 days
pub const MIN_GRACE_PERIOD: i64 = 86_400; // 1 day
pub const MAX_GRACE_PERIOD: i64 = 2_592_000; // 30 days

/// Fee bounds (in basis points, 1 bps = 0.01%)
pub const MIN_CRANK_FEE_BPS: u16 = 1; // 0.01%
pub const MAX_CRANK_FEE_BPS: u16 = 500; // 5%
pub const DEFAULT_CRANK_FEE_BPS: u16 = 10; // 0.1%

/// Limits
pub const MAX_BENEFICIARIES: usize = 10;
pub const MAX_ASSETS: usize = 20;
pub const MAX_VAULT_NAME_LEN: usize = 64;
pub const MAX_NOTE_LEN: usize = 256;
pub const MAX_BENEFICIARY_NAME_LEN: usize = 32;

/// Shares — 10000 bps = 100%
pub const TOTAL_SHARE_BPS: u16 = 10_000;

/// Clock drift tolerance (seconds) — heartbeat timestamps can be up to 30s in the future
pub const CLOCK_DRIFT_TOLERANCE: i64 = 30;

/// PDA seeds
pub const VAULT_SEED: &[u8] = b"vault";

/// Test-mode overrides: lower timing bounds for integration tests
#[cfg(feature = "test-mode")]
pub const TEST_MIN_INACTIVITY_WINDOW: i64 = 2; // 2 seconds
#[cfg(feature = "test-mode")]
pub const TEST_MIN_GRACE_PERIOD: i64 = 1; // 1 second
