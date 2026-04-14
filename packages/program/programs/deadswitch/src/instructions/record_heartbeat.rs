use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::state::{Vault, VaultStatus};

#[derive(Accounts)]
pub struct RecordHeartbeat<'info> {
    /// The heartbeat authority (backend keypair) OR the vault owner
    pub authority: Signer<'info>,

    /// The vault to record a heartbeat for
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,
}

/// Record a heartbeat (proof-of-life) for a vault.
///
/// Can be called by:
/// 1. The vault owner directly (manual heartbeat)
/// 2. The heartbeat authority (backend submitting on behalf of owner after Helius webhook)
///
/// The heartbeat timestamp is always taken from the Solana Clock sysvar for consistency.
pub fn handler(ctx: Context<RecordHeartbeat>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let authority = ctx.accounts.authority.key();

    // Vault must be active (not executed or cancelled)
    require!(
        vault.status == VaultStatus::Active,
        DeadswitchError::VaultNotModifiable
    );

    // Authority must be either the owner or the heartbeat_authority
    require!(
        authority == vault.owner || authority == vault.heartbeat_authority,
        DeadswitchError::UnauthorizedHeartbeat
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Clock::get() returns the current slot's timestamp from the Solana runtime.
    // It cannot be spoofed by the caller — only the validator sets it.
    // We still verify monotonicity: new heartbeat must not be older than last_activity.
    // This guards against edge cases like validator clock rollback.
    require!(
        now >= vault.last_activity,
        DeadswitchError::StaleHeartbeat
    );

    // Update last_activity
    vault.last_activity = now;
    vault.updated_at = now;

    emit!(HeartbeatRecorded {
        vault: vault.key(),
        owner: vault.owner,
        authority,
        timestamp: now,
    });

    Ok(())
}

#[event]
pub struct HeartbeatRecorded {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}
