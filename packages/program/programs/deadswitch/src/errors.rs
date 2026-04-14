use anchor_lang::prelude::*;

#[error_code]
pub enum DeadswitchError {
    #[msg("Inactivity window must be between 30 and 365 days")]
    InvalidInactivityWindow,

    #[msg("Grace period must be between 1 and 30 days")]
    InvalidGracePeriod,

    #[msg("Crank fee must be between 0.01% and 5%")]
    InvalidCrankFee,

    #[msg("Beneficiary shares must total exactly 100%")]
    SharesNotOneHundredPercent,

    #[msg("Too many beneficiaries (max 10)")]
    TooManyBeneficiaries,

    #[msg("At least one beneficiary is required")]
    NoBeneficiaries,

    #[msg("Too many assets (max 20)")]
    TooManyAssets,

    #[msg("At least one asset is required")]
    NoAssets,

    #[msg("Vault name is too long (max 64 characters)")]
    VaultNameTooLong,

    #[msg("Note is too long (max 256 characters)")]
    NoteTooLong,

    #[msg("Beneficiary name is too long (max 32 characters)")]
    BeneficiaryNameTooLong,

    #[msg("Cannot use your own address as a beneficiary")]
    SelfBeneficiary,

    #[msg("Duplicate beneficiary address")]
    DuplicateBeneficiary,

    #[msg("Invalid beneficiary address")]
    InvalidBeneficiary,

    #[msg("Vault is not in a modifiable state")]
    VaultNotModifiable,

    #[msg("Vault is not eligible for execution")]
    VaultNotTriggered,

    #[msg("Heartbeat timestamp is in the future")]
    FutureHeartbeat,

    #[msg("Heartbeat timestamp is not newer than last activity")]
    StaleHeartbeat,

    #[msg("Unauthorized — only the vault owner can perform this action")]
    Unauthorized,

    #[msg("Unauthorized — invalid heartbeat authority")]
    UnauthorizedHeartbeat,

    #[msg("Insufficient deposit amount")]
    InsufficientDeposit,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Beneficiary share is zero")]
    ZeroShare,
}
