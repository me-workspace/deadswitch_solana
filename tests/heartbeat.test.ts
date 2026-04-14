import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  airdrop,
  createFundedKeypair,
  defaultCreateVaultParams,
  deriveVaultPDA,
  getProgram,
  makeBeneficiary,
  SystemProgram,
} from "./helpers";

describe("record_heartbeat", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;
  let beneficiary: Keypair;
  let unauthorizedWallet: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = await createFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
    beneficiary = Keypair.generate();
    unauthorizedWallet = await createFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
  });

  /** Helper: create a vault and return the PDA */
  async function setupVault(vaultId: number = 0) {
    const params = defaultCreateVaultParams(beneficiary.publicKey);
    params.vaultId = new BN(vaultId);

    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      vaultId,
      program.programId
    );

    await program.methods
      .createVault(
        params.vaultId,
        params.name,
        params.note,
        params.inactivityWindow,
        params.gracePeriod,
        params.crankFeeBps,
        params.beneficiaries,
        params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    return vaultPDA;
  }

  // TC-021: Record heartbeat on active vault
  it("TC-021: records heartbeat on active vault", async () => {
    const vaultPDA = await setupVault();

    // Wait a moment so timestamp advances
    await new Promise((r) => setTimeout(r, 1500));

    const vaultBefore = await program.account.vault.fetch(vaultPDA);

    await program.methods
      .recordHeartbeat()
      .accounts({
        authority: heartbeatAuthority.publicKey,
        vault: vaultPDA,
      })
      .signers([heartbeatAuthority])
      .rpc();

    const vaultAfter = await program.account.vault.fetch(vaultPDA);
    expect(vaultAfter.lastActivity.toNumber()).to.be.greaterThanOrEqual(
      vaultBefore.lastActivity.toNumber()
    );
  });

  // TC-023: Record heartbeat on cancelled vault → VaultNotModifiable
  it("TC-023: rejects heartbeat on cancelled vault", async () => {
    const vaultPDA = await setupVault();

    // Cancel the vault first
    await program.methods
      .cancelVault()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    try {
      await program.methods
        .recordHeartbeat()
        .accounts({
          authority: heartbeatAuthority.publicKey,
          vault: vaultPDA,
        })
        .signers([heartbeatAuthority])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotModifiable");
    }
  });

  // TC-027: Record heartbeat by unauthorized wallet → UnauthorizedHeartbeat
  it("TC-027: rejects heartbeat from unauthorized wallet", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .recordHeartbeat()
        .accounts({
          authority: unauthorizedWallet.publicKey,
          vault: vaultPDA,
        })
        .signers([unauthorizedWallet])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("UnauthorizedHeartbeat");
    }
  });

  // TC-028: Record heartbeat by vault owner directly
  it("TC-028: allows heartbeat from vault owner", async () => {
    const vaultPDA = await setupVault();

    await new Promise((r) => setTimeout(r, 1500));

    await program.methods
      .recordHeartbeat()
      .accounts({
        authority: owner.publicKey,
        vault: vaultPDA,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    const now = Math.floor(Date.now() / 1000);
    expect(vault.lastActivity.toNumber()).to.be.closeTo(now, 30);
  });
});
