use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::state::{Vault, VaultStatus};

#[derive(Accounts)]
pub struct ExecuteRedistribution<'info> {
    /// The crank operator — anyone can call this (permissionless)
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The vault PDA to execute
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref(), &vault.vault_id.to_le_bytes()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// The vault owner (receives rent from closed ATAs)
    /// CHECK: Validated via vault.owner constraint
    #[account(mut, address = vault.owner @ DeadswitchError::Unauthorized)]
    pub owner: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Execute redistribution of vault assets to beneficiaries.
///
/// This is permissionless — anyone can call it when the timing conditions are met.
/// The crank operator receives the crank fee as incentive.
///
/// ## SOL redistribution:
/// 1. total_sol = vault lamports - rent_exempt_minimum
/// 2. crank_fee = total_sol * crank_fee_bps / 10000
/// 3. distributable = total_sol - crank_fee
/// 4. Each beneficiary (except last): amount = distributable * share_bps / 10000
/// 5. Last beneficiary gets remainder (absorbs rounding dust)
///
/// ## SPL redistribution (via remaining_accounts):
/// Same logic per token. Vault ATAs are closed after transfer.
///
/// ## remaining_accounts layout:
/// First: beneficiary wallet accounts for SOL distribution (num_beneficiaries entries)
///   [beneficiary_wallet_0, beneficiary_wallet_1, ..., beneficiary_wallet_n]
/// Then for each SPL token (in order of vault.asset_configs, skipping SOL):
///   [vault_ata, ben_ata_0, ben_ata_1, ..., ben_ata_n, crank_ata]
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteRedistribution<'info>>,
) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Vault must be active
    require!(
        vault.status == VaultStatus::Active,
        DeadswitchError::VaultNotModifiable
    );

    // Check timing: must be past inactivity_window + grace_period
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(
        vault.is_executable(now),
        DeadswitchError::VaultNotTriggered
    );

    let num_beneficiaries = vault.num_beneficiaries as usize;
    let crank_fee_bps = vault.crank_fee_bps as u64;
    let owner_key = vault.owner;
    let vault_id_bytes = vault.vault_id.to_le_bytes();

    // PDA signer seeds for CPI
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        owner_key.as_ref(),
        &vault_id_bytes,
        &[vault.bump],
    ]];

    // Collect beneficiary data before mutable borrow
    let beneficiaries: Vec<(Pubkey, u16)> = vault
        .active_beneficiaries()
        .iter()
        .map(|b| (b.wallet, b.share_bps))
        .collect();

    // --- SOL redistribution ---
    let vault_info = vault.to_account_info();
    let rent = Rent::get()?;
    let rent_exempt_min = rent.minimum_balance(vault_info.data_len());
    let total_sol = vault_info
        .lamports()
        .checked_sub(rent_exempt_min)
        .unwrap_or(0);

    if total_sol > 0 {
        // Calculate crank fee
        let crank_fee = total_sol
            .checked_mul(crank_fee_bps)
            .ok_or(DeadswitchError::ArithmeticOverflow)?
            .checked_div(TOTAL_SHARE_BPS as u64)
            .ok_or(DeadswitchError::ArithmeticOverflow)?;

        let distributable = total_sol
            .checked_sub(crank_fee)
            .ok_or(DeadswitchError::ArithmeticOverflow)?;

        // Distribute to beneficiaries
        let mut distributed: u64 = 0;
        for (i, (wallet, share_bps)) in beneficiaries.iter().enumerate() {
            let amount = if i == num_beneficiaries - 1 {
                // Last beneficiary gets remainder (absorbs rounding dust)
                distributable
                    .checked_sub(distributed)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
            } else {
                distributable
                    .checked_mul(*share_bps as u64)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
                    .checked_div(TOTAL_SHARE_BPS as u64)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
            };

            if amount > 0 {
                // Find the beneficiary account in remaining_accounts or just transfer via lamports
                // For SOL, we transfer directly via lamport manipulation
                // The beneficiary accounts must be passed in remaining_accounts at the start
                // Layout: first `num_beneficiaries` remaining_accounts are beneficiary wallet accounts
                let beneficiary_info = &ctx.remaining_accounts[i];
                require!(
                    beneficiary_info.key() == *wallet,
                    DeadswitchError::InvalidBeneficiary
                );

                **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
                **beneficiary_info.try_borrow_mut_lamports()? += amount;
            }

            distributed = distributed
                .checked_add(amount)
                .ok_or(DeadswitchError::ArithmeticOverflow)?;
        }

        // Transfer crank fee
        if crank_fee > 0 {
            **vault.to_account_info().try_borrow_mut_lamports()? -= crank_fee;
            **ctx.accounts.crank.to_account_info().try_borrow_mut_lamports()? += crank_fee;
        }
    }

    // --- SPL token redistribution ---
    // Remaining accounts after beneficiary wallets:
    // For each SPL token: [vault_ata, ben_ata_0, ben_ata_1, ..., ben_ata_n, crank_ata]
    let spl_start = num_beneficiaries;
    let remaining = &ctx.remaining_accounts;
    let mut ri = spl_start;

    let num_assets = vault.num_assets as usize;
    for asset_idx in 0..num_assets {
        let asset = &vault.asset_configs[asset_idx];
        // Skip native SOL (handled above) and zero-amount assets
        if asset.mint == Pubkey::default() || asset.amount == 0 {
            continue;
        }

        // vault_ata
        require!(ri < remaining.len(), DeadswitchError::NoAssets);
        let vault_ata_info = &remaining[ri];
        ri += 1;

        let vault_ata: Account<TokenAccount> =
            Account::try_from(vault_ata_info)?;
        let total_tokens = vault_ata.amount;

        if total_tokens == 0 {
            // Skip but still close the ATA
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: vault_ata_info.to_account_info(),
                    destination: ctx.accounts.owner.to_account_info(),
                    authority: vault.to_account_info(),
                },
                signer_seeds,
            ))?;
            // Skip beneficiary ATAs + crank ATA
            ri += num_beneficiaries + 1;
            continue;
        }

        // Calculate crank fee for this token
        let token_crank_fee = total_tokens
            .checked_mul(crank_fee_bps)
            .ok_or(DeadswitchError::ArithmeticOverflow)?
            .checked_div(TOTAL_SHARE_BPS as u64)
            .ok_or(DeadswitchError::ArithmeticOverflow)?;

        let distributable_tokens = total_tokens
            .checked_sub(token_crank_fee)
            .ok_or(DeadswitchError::ArithmeticOverflow)?;

        // Distribute to each beneficiary's ATA
        let mut distributed_tokens: u64 = 0;
        for (i, (_, share_bps)) in beneficiaries.iter().enumerate() {
            require!(ri < remaining.len(), DeadswitchError::NoAssets);
            let ben_ata_info = &remaining[ri];
            ri += 1;

            let amount = if i == num_beneficiaries - 1 {
                distributable_tokens
                    .checked_sub(distributed_tokens)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
            } else {
                distributable_tokens
                    .checked_mul(*share_bps as u64)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
                    .checked_div(TOTAL_SHARE_BPS as u64)
                    .ok_or(DeadswitchError::ArithmeticOverflow)?
            };

            if amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: vault_ata_info.to_account_info(),
                            to: ben_ata_info.to_account_info(),
                            authority: vault.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    amount,
                )?;
            }

            distributed_tokens = distributed_tokens
                .checked_add(amount)
                .ok_or(DeadswitchError::ArithmeticOverflow)?;
        }

        // Transfer crank fee tokens
        if token_crank_fee > 0 {
            require!(ri < remaining.len(), DeadswitchError::NoAssets);
            let crank_ata_info = &remaining[ri];
            ri += 1;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: vault_ata_info.to_account_info(),
                        to: crank_ata_info.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                token_crank_fee,
            )?;
        } else {
            // Still skip the crank ATA slot
            ri += 1;
        }

        // Close vault ATA (rent returned to owner)
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: vault_ata_info.to_account_info(),
                destination: ctx.accounts.owner.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    // --- Update vault status ---
    let vault = &mut ctx.accounts.vault;
    vault.status = VaultStatus::Executed;
    vault.updated_at = now;

    // Zero out all asset amounts
    for asset in vault.asset_configs.iter_mut() {
        asset.amount = 0;
    }

    emit!(VaultExecuted {
        vault: vault.key(),
        owner: owner_key,
        crank: ctx.accounts.crank.key(),
        timestamp: now,
        num_beneficiaries: num_beneficiaries as u8,
    });

    Ok(())
}

#[event]
pub struct VaultExecuted {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub crank: Pubkey,
    pub timestamp: i64,
    pub num_beneficiaries: u8,
}
