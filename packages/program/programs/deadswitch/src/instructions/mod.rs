pub mod cancel_vault;
pub mod create_vault;
pub mod execute;
pub mod record_heartbeat;
pub mod top_up_vault;
pub mod update_vault;

// Glob re-exports required for Anchor's #[program] macro to find generated account modules.
// The `handler` name collision is harmless — we reference handlers via full module path in lib.rs.
#[allow(ambiguous_glob_reexports)]
pub use cancel_vault::*;
pub use create_vault::*;
pub use execute::*;
pub use record_heartbeat::*;
pub use top_up_vault::*;
pub use update_vault::*;
