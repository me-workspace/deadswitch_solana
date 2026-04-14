use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::instructions::create_vault::BeneficiaryInput;
use crate::state::{Beneficiary, Vault, VaultStatus};

#[derive(Accounts)]
pub struct UpdateVault<'info> {
    /// The vault owner — only they can update
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to update
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        has_one = owner @ DeadswitchError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,
}

/// Update vault configuration: name, note, beneficiaries, timing, crank fee.
///
/// All fields are optional — pass None to keep current value.
/// Updating resets the inactivity timer (owner signature = proof of life).
pub fn handler(
    ctx: Context<UpdateVault>,
    name: Option<String>,
    note: Option<String>,
    inactivity_window: Option<i64>,
    grace_period: Option<i64>,
    crank_fee_bps: Option<u16>,
    beneficiaries: Option<Vec<BeneficiaryInput>>,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    let owner_key = ctx.accounts.owner.key();

    // Vault must be active
    require!(
        vault.status == VaultStatus::Active,
        DeadswitchError::VaultNotModifiable
    );

    // --- Update name ---
    if let Some(new_name) = &name {
        require!(
            new_name.len() <= MAX_VAULT_NAME_LEN,
            DeadswitchError::VaultNameTooLong
        );
        vault.name = [0u8; MAX_VAULT_NAME_LEN];
        let bytes = new_name.as_bytes();
        vault.name[..bytes.len()].copy_from_slice(bytes);
    }

    // --- Update note ---
    if let Some(new_note) = &note {
        require!(
            new_note.len() <= MAX_NOTE_LEN,
            DeadswitchError::NoteTooLong
        );
        vault.note = [0u8; MAX_NOTE_LEN];
        let bytes = new_note.as_bytes();
        vault.note[..bytes.len()].copy_from_slice(bytes);
    }

    // --- Update inactivity window ---
    if let Some(window) = inactivity_window {
        let min_window = get_min_inactivity_window();
        require!(
            window >= min_window && window <= MAX_INACTIVITY_WINDOW,
            DeadswitchError::InvalidInactivityWindow
        );
        vault.inactivity_window = window;
    }

    // --- Update grace period ---
    if let Some(grace) = grace_period {
        let min_grace = get_min_grace_period();
        require!(
            grace >= min_grace && grace <= MAX_GRACE_PERIOD,
            DeadswitchError::InvalidGracePeriod
        );
        vault.grace_period = grace;
    }

    // --- Update crank fee ---
    if let Some(fee) = crank_fee_bps {
        require!(
            fee >= MIN_CRANK_FEE_BPS && fee <= MAX_CRANK_FEE_BPS,
            DeadswitchError::InvalidCrankFee
        );
        vault.crank_fee_bps = fee;
    }

    // --- Update beneficiaries ---
    if let Some(new_beneficiaries) = &beneficiaries {
        require!(
            !new_beneficiaries.is_empty(),
            DeadswitchError::NoBeneficiaries
        );
        require!(
            new_beneficiaries.len() <= MAX_BENEFICIARIES,
            DeadswitchError::TooManyBeneficiaries
        );

        let mut total_bps: u16 = 0;
        for (i, b) in new_beneficiaries.iter().enumerate() {
            require!(b.wallet != owner_key, DeadswitchError::SelfBeneficiary);
            require!(
                b.wallet != Pubkey::default(),
                DeadswitchError::InvalidBeneficiary
            );
            require!(b.share_bps > 0, DeadswitchError::ZeroShare);
            require!(
                b.name.len() <= MAX_BENEFICIARY_NAME_LEN,
                DeadswitchError::BeneficiaryNameTooLong
            );

            for j in (i + 1)..new_beneficiaries.len() {
                require!(
                    b.wallet != new_beneficiaries[j].wallet,
                    DeadswitchError::DuplicateBeneficiary
                );
            }

            total_bps = total_bps
                .checked_add(b.share_bps)
                .ok_or(DeadswitchError::ArithmeticOverflow)?;
        }

        require!(
            total_bps == TOTAL_SHARE_BPS,
            DeadswitchError::SharesNotOneHundredPercent
        );

        // Clear old beneficiaries and write new ones
        vault.beneficiaries = [Beneficiary::default(); MAX_BENEFICIARIES];
        vault.num_beneficiaries = new_beneficiaries.len() as u8;

        for (i, b) in new_beneficiaries.iter().enumerate() {
            let mut name_arr = [0u8; MAX_BENEFICIARY_NAME_LEN];
            let b_name_bytes = b.name.as_bytes();
            name_arr[..b_name_bytes.len()].copy_from_slice(b_name_bytes);

            vault.beneficiaries[i] = Beneficiary {
                wallet: b.wallet,
                share_bps: b.share_bps,
                name: name_arr,
            };
        }
    }

    // --- Reset inactivity timer (proof of life) ---
    let clock = Clock::get()?;
    vault.last_activity = clock.unix_timestamp;
    vault.updated_at = clock.unix_timestamp;

    emit!(VaultUpdated {
        vault: vault.key(),
        owner: owner_key,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct VaultUpdated {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

fn get_min_inactivity_window() -> i64 {
    #[cfg(feature = "test-mode")]
    {
        crate::constants::TEST_MIN_INACTIVITY_WINDOW
    }
    #[cfg(not(feature = "test-mode"))]
    {
        MIN_INACTIVITY_WINDOW
    }
}

fn get_min_grace_period() -> i64 {
    #[cfg(feature = "test-mode")]
    {
        crate::constants::TEST_MIN_GRACE_PERIOD
    }
    #[cfg(not(feature = "test-mode"))]
    {
        MIN_GRACE_PERIOD
    }
}
