use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, Transfer};

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::state::{AssetConfig, Vault, VaultStatus};

#[derive(Accounts)]
pub struct TopUpVault<'info> {
    /// The vault owner — only they can top up
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to top up
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
        has_one = owner @ DeadswitchError::Unauthorized,
    )]
    pub vault: Box<Account<'info, Vault>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Top up an existing vault with additional SOL and/or SPL tokens.
///
/// This also resets the inactivity timer (proof of life).
///
/// For SPL tokens, pass remaining accounts as triples: [mint, owner_ata, vault_ata]
/// where vault_ata uses `init_if_needed` logic.
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, TopUpVault<'info>>,
    sol_amount: u64,
    spl_deposits: Vec<SplDeposit>,
) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Vault must be active
    require!(
        vault.status == VaultStatus::Active,
        DeadswitchError::VaultNotModifiable
    );

    // Must deposit at least something
    let has_sol = sol_amount > 0;
    let has_spl = !spl_deposits.is_empty();
    require!(
        has_sol || has_spl,
        DeadswitchError::InsufficientDeposit
    );

    // --- SOL deposit ---
    if sol_amount > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            sol_amount,
        )?;
    }

    // --- SPL token deposits via remaining accounts ---
    // remaining_accounts: [mint, owner_ata, vault_ata] triples
    let remaining = &ctx.remaining_accounts;
    let mut remaining_idx = 0;

    for deposit in spl_deposits.iter() {
        require!(
            remaining_idx + 2 < remaining.len(),
            DeadswitchError::NoAssets
        );

        let mint_info = &remaining[remaining_idx];
        let owner_ata_info = &remaining[remaining_idx + 1];
        let vault_ata_info = &remaining[remaining_idx + 2];

        // Validate that the mint account key matches the declared deposit mint
        require!(
            mint_info.key() == deposit.mint,
            DeadswitchError::InvalidBeneficiary // mint mismatch
        );

        require!(deposit.amount > 0, DeadswitchError::InsufficientDeposit);

        // Transfer SPL tokens from owner ATA to vault ATA
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: owner_ata_info.to_account_info(),
                    to: vault_ata_info.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            deposit.amount,
        )?;

        remaining_idx += 3;
    }

    // --- Update vault state ---
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    // Update SOL asset config
    if sol_amount > 0 {
        // Find existing SOL entry (mint == Pubkey::default()) or add new
        let mut found = false;
        for i in 0..vault.num_assets as usize {
            if vault.asset_configs[i].mint == Pubkey::default() {
                vault.asset_configs[i].amount = vault.asset_configs[i]
                    .amount
                    .checked_add(sol_amount)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?;
                found = true;
                break;
            }
        }
        if !found {
            let idx = vault.num_assets as usize;
            require!(idx < MAX_ASSETS, DeadswitchError::TooManyAssets);
            vault.asset_configs[idx] = AssetConfig {
                mint: Pubkey::default(),
                amount: sol_amount,
            };
            vault.num_assets += 1;
        }
    }

    // Update SPL asset configs
    for deposit in spl_deposits.iter() {
        let mut found = false;
        for i in 0..vault.num_assets as usize {
            if vault.asset_configs[i].mint == deposit.mint {
                vault.asset_configs[i].amount = vault.asset_configs[i]
                    .amount
                    .checked_add(deposit.amount)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?;
                found = true;
                break;
            }
        }
        if !found {
            let idx = vault.num_assets as usize;
            require!(idx < MAX_ASSETS, DeadswitchError::TooManyAssets);
            vault.asset_configs[idx] = AssetConfig {
                mint: deposit.mint,
                amount: deposit.amount,
            };
            vault.num_assets += 1;
        }
    }

    // Reset inactivity timer (proof of life)
    vault.last_activity = clock.unix_timestamp;
    vault.updated_at = clock.unix_timestamp;

    emit!(VaultToppedUp {
        vault: vault.key(),
        owner: ctx.accounts.owner.key(),
        sol_added: sol_amount,
        spl_count: spl_deposits.len() as u8,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SplDeposit {
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VaultToppedUp {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub sol_added: u64,
    pub spl_count: u8,
    pub timestamp: i64,
}
