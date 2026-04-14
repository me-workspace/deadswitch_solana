use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("14S2ouXUde99HRRrSmMUcqMCUpMkd2NngjMmnz21mXKh");

#[program]
pub mod deadswitch {
    use super::*;

    /// Create a new inheritance vault with beneficiaries and SOL deposit.
    pub fn create_vault(
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
        instructions::create_vault::handler(
            ctx,
            vault_id,
            name,
            note,
            inactivity_window,
            grace_period,
            crank_fee_bps,
            beneficiaries,
            sol_deposit_lamports,
        )
    }

    /// Record a heartbeat (proof-of-life) for a vault.
    pub fn record_heartbeat(ctx: Context<RecordHeartbeat>) -> Result<()> {
        instructions::record_heartbeat::handler(ctx)
    }

    /// Update vault configuration (optional fields).
    pub fn update_vault(
        ctx: Context<UpdateVault>,
        name: Option<String>,
        note: Option<String>,
        inactivity_window: Option<i64>,
        grace_period: Option<i64>,
        crank_fee_bps: Option<u16>,
        beneficiaries: Option<Vec<BeneficiaryInput>>,
    ) -> Result<()> {
        instructions::update_vault::handler(
            ctx,
            name,
            note,
            inactivity_window,
            grace_period,
            crank_fee_bps,
            beneficiaries,
        )
    }

    /// Top up an existing vault with additional SOL and/or SPL tokens.
    pub fn top_up_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, TopUpVault<'info>>,
        sol_amount: u64,
        spl_deposits: Vec<SplDeposit>,
    ) -> Result<()> {
        instructions::top_up_vault::handler(ctx, sol_amount, spl_deposits)
    }

    /// Cancel a vault and return all assets to the owner.
    pub fn cancel_vault<'info>(
        ctx: Context<'_, '_, 'info, 'info, CancelVault<'info>>,
    ) -> Result<()> {
        instructions::cancel_vault::handler(ctx)
    }

    /// Execute redistribution of vault assets to beneficiaries.
    /// Permissionless — anyone can call when timing conditions are met.
    pub fn execute_redistribution<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteRedistribution<'info>>,
    ) -> Result<()> {
        instructions::execute::handler(ctx)
    }
}
