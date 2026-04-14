use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, AssociatedToken};
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::DeadswitchError;
use crate::state::{Vault, VaultStatus};

#[derive(Accounts)]
pub struct CancelVault<'info> {
    /// The vault owner — only they can cancel
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to cancel
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

/// Cancel an active vault and return all assets to the owner.
///
/// - Transfers all SOL (above rent-exempt minimum) back to the owner
/// - Transfers all SPL tokens from vault ATAs back to owner ATAs
/// - Closes vault ATAs (rent returned to owner)
/// - Sets vault status to Cancelled (vault PDA remains for historical record)
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, CancelVault<'info>>,
) -> Result<()> {
    let vault = &ctx.accounts.vault;

    // Vault must be active
    require!(
        vault.status == VaultStatus::Active,
        DeadswitchError::VaultNotModifiable
    );

    let owner = &ctx.accounts.owner;
    let vault_key = vault.key();
    let vault_id_bytes = vault.vault_id.to_le_bytes();

    // PDA signer seeds for CPI
    let signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_SEED,
        owner.key.as_ref(),
        &vault_id_bytes,
        &[vault.bump],
    ]];

    // --- Transfer SOL back to owner ---
    // Calculate how much SOL is in the vault above rent-exempt minimum
    let vault_info = vault.to_account_info();
    let rent = Rent::get()?;
    let rent_exempt_min = rent.minimum_balance(vault_info.data_len());
    let vault_lamports = vault_info.lamports();
    let returnable_sol = vault_lamports
        .checked_sub(rent_exempt_min)
        .unwrap_or(0);

    if returnable_sol > 0 {
        // Transfer SOL from vault PDA to owner using lamport manipulation
        // (PDA-owned accounts can directly modify lamports)
        **vault.to_account_info().try_borrow_mut_lamports()? -= returnable_sol;
        **owner.to_account_info().try_borrow_mut_lamports()? += returnable_sol;
    }

    // --- Transfer SPL tokens back to owner (via remaining accounts) ---
    // remaining_accounts come in triples: [vault_ata, owner_ata, mint, vault_ata, owner_ata, mint, ...]
    // Each triple corresponds to a non-SOL asset in vault.asset_configs
    let remaining = &ctx.remaining_accounts;
    let mut ri = 0;

    // Collect SPL asset mints for validation
    let spl_mints: Vec<Pubkey> = (0..vault.num_assets as usize)
        .filter(|&idx| vault.asset_configs[idx].mint != Pubkey::default())
        .map(|idx| vault.asset_configs[idx].mint)
        .collect();

    for expected_mint in spl_mints.iter() {
        require!(
            ri + 2 < remaining.len(),
            DeadswitchError::InsufficientRemainingAccounts
        );

        let vault_ata_info = &remaining[ri];
        let owner_ata_info = &remaining[ri + 1];
        let mint_info = &remaining[ri + 2];

        // Validate mint account key matches the expected asset mint
        require!(
            mint_info.key() == *expected_mint,
            DeadswitchError::MintMismatch
        );

        // Deserialize vault ATA and validate
        let vault_ata: Account<TokenAccount> =
            Account::try_from(vault_ata_info)?;

        // Validate vault ATA ownership and mint
        require!(
            vault_ata.owner == vault_key,
            DeadswitchError::InvalidTokenAccountOwner
        );
        require!(
            vault_ata.mint == *expected_mint,
            DeadswitchError::MintMismatch
        );

        // Validate owner ATA is canonical for owner + mint
        let expected_owner_ata = associated_token::get_associated_token_address(
            &owner.key(),
            expected_mint,
        );
        require!(
            owner_ata_info.key() == expected_owner_ata,
            DeadswitchError::InvalidAssociatedTokenAccount
        );

        if vault_ata.amount > 0 {
            // Transfer all tokens to owner ATA
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: vault_ata_info.to_account_info(),
                        to: owner_ata_info.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                vault_ata.amount,
            )?;
        }

        // Close the vault ATA (rent goes to owner)
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: vault_ata_info.to_account_info(),
                destination: owner.to_account_info(),
                authority: vault.to_account_info(),
            },
            signer_seeds,
        ))?;

        ri += 3;
    }

    // --- Update vault status ---
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    vault.status = VaultStatus::Cancelled;
    vault.updated_at = clock.unix_timestamp;

    // Zero out asset amounts
    for asset in vault.asset_configs.iter_mut() {
        asset.amount = 0;
    }

    emit!(VaultCancelled {
        vault: vault_key,
        owner: owner.key(),
        timestamp: clock.unix_timestamp,
        sol_returned: returnable_sol,
    });

    Ok(())
}

#[event]
pub struct VaultCancelled {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
    pub sol_returned: u64,
}
