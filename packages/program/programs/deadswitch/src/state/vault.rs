use anchor_lang::prelude::*;

use crate::constants::*;

/// Vault status encoded as u8 for fixed-size account layout
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum VaultStatus {
    Active = 0,
    Executed = 1,
    Cancelled = 2,
}

impl Default for VaultStatus {
    fn default() -> Self {
        VaultStatus::Active
    }
}

/// A single beneficiary entry stored in the vault account.
/// Fixed-size: 32 (wallet) + 2 (share_bps) + 32 (name) = 66 bytes
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct Beneficiary {
    /// Beneficiary wallet address
    pub wallet: Pubkey,
    /// Share in basis points (1-9999, total must be 10000)
    pub share_bps: u16,
    /// Human-readable name (UTF-8, padded with zeros)
    pub name: [u8; MAX_BENEFICIARY_NAME_LEN],
}

impl Beneficiary {
    pub const SIZE: usize = 32 + 2 + MAX_BENEFICIARY_NAME_LEN; // 66

    /// Check if this slot is empty (default/unused)
    pub fn is_empty(&self) -> bool {
        self.wallet == Pubkey::default()
    }

    /// Get the name as a trimmed UTF-8 string
    pub fn name_str(&self) -> &str {
        let end = self.name.iter().position(|&b| b == 0).unwrap_or(self.name.len());
        std::str::from_utf8(&self.name[..end]).unwrap_or("")
    }
}

/// An asset configuration entry stored in the vault account.
/// Fixed-size: 32 (mint) + 8 (amount) = 40 bytes
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct AssetConfig {
    /// Token mint address (Pubkey::default() for native SOL)
    pub mint: Pubkey,
    /// Amount in smallest unit (lamports for SOL, raw amount for SPL)
    pub amount: u64,
}

impl AssetConfig {
    pub const SIZE: usize = 32 + 8; // 40

    /// Check if this slot is empty (default/unused)
    pub fn is_empty(&self) -> bool {
        self.mint == Pubkey::default() && self.amount == 0
    }
}

/// The main vault account — holds all configuration and state onchain.
///
/// Uses fixed-size arrays with num_* counters to avoid dynamic sizing.
/// PDA seeds: ["vault", owner, vault_id.to_le_bytes()]
#[account]
pub struct Vault {
    /// The wallet that owns this vault
    pub owner: Pubkey,
    /// Sequential vault ID for this owner (allows multiple vaults per owner)
    pub vault_id: u64,
    /// PDA bump seed
    pub bump: u8,
    /// Authority allowed to record heartbeats on behalf of the owner (backend keypair)
    pub heartbeat_authority: Pubkey,
    /// Seconds of wallet inactivity before the vault enters triggered state
    pub inactivity_window: i64,
    /// Additional seconds after inactivity window before execution is allowed
    pub grace_period: i64,
    /// Fee paid to the crank operator in basis points (deducted from vault assets)
    pub crank_fee_bps: u16,
    /// Current vault status
    pub status: VaultStatus,
    /// Unix timestamp of the last recorded activity (heartbeat or action)
    pub last_activity: i64,
    /// Unix timestamp when the vault was created
    pub created_at: i64,
    /// Unix timestamp when the vault was last updated
    pub updated_at: i64,
    /// Human-readable vault name (UTF-8, padded with zeros)
    pub name: [u8; MAX_VAULT_NAME_LEN],
    /// Optional note/message to beneficiaries (UTF-8, padded with zeros)
    pub note: [u8; MAX_NOTE_LEN],
    /// Number of active beneficiaries (valid entries in beneficiaries array)
    pub num_beneficiaries: u8,
    /// Number of active assets (valid entries in asset_configs array)
    pub num_assets: u8,
    /// Fixed-size array of beneficiary entries
    pub beneficiaries: [Beneficiary; MAX_BENEFICIARIES],
    /// Fixed-size array of asset config entries
    pub asset_configs: [AssetConfig; MAX_ASSETS],
}

impl Vault {
    /// Total account size including discriminator.
    ///
    /// Layout:
    ///   8   discriminator
    ///   32  owner
    ///   8   vault_id
    ///   1   bump
    ///   32  heartbeat_authority
    ///   8   inactivity_window
    ///   8   grace_period
    ///   2   crank_fee_bps
    ///   1   status
    ///   8   last_activity
    ///   8   created_at
    ///   8   updated_at
    ///   64  name
    ///   256 note
    ///   1   num_beneficiaries
    ///   1   num_assets
    ///   660 beneficiaries (10 × 66)
    ///   800 asset_configs (20 × 40)
    ///   ─────
    ///   1906 total
    pub const SIZE: usize = 8  // discriminator
        + 32  // owner
        + 8   // vault_id
        + 1   // bump
        + 32  // heartbeat_authority
        + 8   // inactivity_window
        + 8   // grace_period
        + 2   // crank_fee_bps
        + 1   // status
        + 8   // last_activity
        + 8   // created_at
        + 8   // updated_at
        + MAX_VAULT_NAME_LEN   // name (64)
        + MAX_NOTE_LEN         // note (256)
        + 1   // num_beneficiaries
        + 1   // num_assets
        + (Beneficiary::SIZE * MAX_BENEFICIARIES) // 660
        + (AssetConfig::SIZE * MAX_ASSETS);       // 800

    /// Check if the vault can be modified (not executed or cancelled)
    pub fn is_modifiable(&self) -> bool {
        self.status == VaultStatus::Active
    }

    /// Get the name as a trimmed UTF-8 string
    pub fn name_str(&self) -> &str {
        let end = self.name.iter().position(|&b| b == 0).unwrap_or(self.name.len());
        std::str::from_utf8(&self.name[..end]).unwrap_or("")
    }

    /// Get active beneficiaries (non-empty slots)
    pub fn active_beneficiaries(&self) -> &[Beneficiary] {
        &self.beneficiaries[..self.num_beneficiaries as usize]
    }

    /// Get active asset configs (non-empty slots)
    pub fn active_assets(&self) -> &[AssetConfig] {
        &self.asset_configs[..self.num_assets as usize]
    }

    /// Check if the vault has been triggered (inactivity window elapsed)
    pub fn is_triggered(&self, current_time: i64) -> bool {
        current_time > self.last_activity
            .checked_add(self.inactivity_window)
            .unwrap_or(i64::MAX)
    }

    /// Check if the vault is eligible for execution (window + grace elapsed)
    pub fn is_executable(&self, current_time: i64) -> bool {
        let total_wait = self.inactivity_window
            .checked_add(self.grace_period)
            .unwrap_or(i64::MAX);
        current_time > self.last_activity
            .checked_add(total_wait)
            .unwrap_or(i64::MAX)
    }
}
