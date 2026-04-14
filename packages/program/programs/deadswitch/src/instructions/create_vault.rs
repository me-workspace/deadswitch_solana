use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::state::{AssetConfig, Beneficiary, Vault, VaultStatus};

/// Input beneficiary data passed by the client
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BeneficiaryInput {
    pub wallet: Pubkey,
    pub share_bps: u16,
    pub name: String,
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct CreateVault<'info> {
    /// The vault owner who pays for creation and deposits assets
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA — initialized here
    #[account(
        init,
        payer = owner,
        space = Vault::SIZE,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault_id.to_le_bytes()],
        bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// The backend keypair authorized to submit heartbeats on behalf of the owner
    /// CHECK: This is just stored as a pubkey — no validation needed beyond being a valid key
    pub heartbeat_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Create a new inheritance vault with beneficiaries and optional SOL deposit.
///
/// SPL token deposits are handled via `top_up_vault` after creation.
pub fn handler(
    ctx: Context<CreateVault>,
    vault_id: u64,
    name: String,
    note: String,
    inactivity_window: i64,
    grace_period: i64,
    crank_fee_bps: u16,
    beneficiaries: Vec<BeneficiaryInput>,
    sol_deposit_lamports: u64,
) -> Result<()> {
    // --- Validation ---

    // Name length
    require!(
        name.len() <= MAX_VAULT_NAME_LEN,
        DeadswitchError::VaultNameTooLong
    );

    // Note length
    require!(note.len() <= MAX_NOTE_LEN, DeadswitchError::NoteTooLong);

    // Inactivity window bounds
    let min_window = get_min_inactivity_window();
    require!(
        inactivity_window >= min_window && inactivity_window <= MAX_INACTIVITY_WINDOW,
        DeadswitchError::InvalidInactivityWindow
    );

    // Grace period bounds
    let min_grace = get_min_grace_period();
    require!(
        grace_period >= min_grace && grace_period <= MAX_GRACE_PERIOD,
        DeadswitchError::InvalidGracePeriod
    );

    // Crank fee bounds
    require!(
        crank_fee_bps >= MIN_CRANK_FEE_BPS && crank_fee_bps <= MAX_CRANK_FEE_BPS,
        DeadswitchError::InvalidCrankFee
    );

    // Beneficiary count
    require!(!beneficiaries.is_empty(), DeadswitchError::NoBeneficiaries);
    require!(
        beneficiaries.len() <= MAX_BENEFICIARIES,
        DeadswitchError::TooManyBeneficiaries
    );

    // Validate each beneficiary
    let owner_key = ctx.accounts.owner.key();
    let mut total_bps: u16 = 0;

    for (i, b) in beneficiaries.iter().enumerate() {
        // No self-beneficiary
        require!(b.wallet != owner_key, DeadswitchError::SelfBeneficiary);

        // No zero address
        require!(
            b.wallet != Pubkey::default(),
            DeadswitchError::InvalidBeneficiary
        );

        // No zero share
        require!(b.share_bps > 0, DeadswitchError::ZeroShare);

        // Name length
        require!(
            b.name.len() <= MAX_BENEFICIARY_NAME_LEN,
            DeadswitchError::BeneficiaryNameTooLong
        );

        // Check duplicates (O(n^2) but fine for max 10)
        for j in (i + 1)..beneficiaries.len() {
            require!(
                b.wallet != beneficiaries[j].wallet,
                DeadswitchError::DuplicateBeneficiary
            );
        }

        total_bps = total_bps
            .checked_add(b.share_bps)
            .ok_or(DeadswitchError::ArithmeticOverflow)?;
    }

    // Shares must sum to exactly 100%
    require!(
        total_bps == TOTAL_SHARE_BPS,
        DeadswitchError::SharesNotOneHundredPercent
    );

    // Must deposit something
    require!(
        sol_deposit_lamports > 0,
        DeadswitchError::InsufficientDeposit
    );

    // --- SOL deposit: transfer from owner to vault PDA ---
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        sol_deposit_lamports,
    )?;

    // --- Initialize vault state ---
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    vault.owner = owner_key;
    vault.vault_id = vault_id;
    vault.bump = ctx.bumps.vault;
    vault.heartbeat_authority = ctx.accounts.heartbeat_authority.key();
    vault.inactivity_window = inactivity_window;
    vault.grace_period = grace_period;
    vault.crank_fee_bps = crank_fee_bps;
    vault.status = VaultStatus::Active;
    vault.last_activity = clock.unix_timestamp;
    vault.created_at = clock.unix_timestamp;
    vault.updated_at = clock.unix_timestamp;

    // Copy name into fixed-size array
    let name_bytes = name.as_bytes();
    vault.name[..name_bytes.len()].copy_from_slice(name_bytes);

    // Copy note into fixed-size array
    let note_bytes = note.as_bytes();
    vault.note[..note_bytes.len()].copy_from_slice(note_bytes);

    // Copy beneficiaries into fixed-size array
    vault.num_beneficiaries = beneficiaries.len() as u8;
    for (i, b) in beneficiaries.iter().enumerate() {
        let mut name_arr = [0u8; MAX_BENEFICIARY_NAME_LEN];
        let b_name_bytes = b.name.as_bytes();
        name_arr[..b_name_bytes.len()].copy_from_slice(b_name_bytes);

        vault.beneficiaries[i] = Beneficiary {
            wallet: b.wallet,
            share_bps: b.share_bps,
            name: name_arr,
        };
    }

    // Record SOL as the first asset (mint = Pubkey::default() for native SOL)
    vault.num_assets = 1;
    vault.asset_configs[0] = AssetConfig {
        mint: Pubkey::default(),
        amount: sol_deposit_lamports,
    };

    // Emit event
    emit!(VaultCreated {
        vault: vault.key(),
        owner: owner_key,
        vault_id,
        num_beneficiaries: vault.num_beneficiaries,
        sol_deposited: sol_deposit_lamports,
        inactivity_window,
        grace_period,
    });

    Ok(())
}

// --- Events ---

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub vault_id: u64,
    pub num_beneficiaries: u8,
    pub sol_deposited: u64,
    pub inactivity_window: i64,
    pub grace_period: i64,
}

// --- Helper: test-mode timing bounds ---

fn get_min_inactivity_window() -> i64 {
    #[cfg(feature = "test-mode")]
    {
        TEST_MIN_INACTIVITY_WINDOW
    }
    #[cfg(not(feature = "test-mode"))]
    {
        MIN_INACTIVITY_WINDOW
    }
}

fn get_min_grace_period() -> i64 {
    #[cfg(feature = "test-mode")]
    {
        TEST_MIN_GRACE_PERIOD
    }
    #[cfg(not(feature = "test-mode"))]
    {
        MIN_GRACE_PERIOD
    }
}
