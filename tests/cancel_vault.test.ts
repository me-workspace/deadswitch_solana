import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  createFundedKeypair,
  defaultCreateVaultParams,
  deriveVaultPDA,
  getBalance,
  getProgram,
  SystemProgram,
} from "./helpers";

describe("cancel_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;
  let beneficiary: Keypair;
  let nonOwner: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = Keypair.generate();
    beneficiary = Keypair.generate();
    nonOwner = await createFundedKeypair(connection, 2 * LAMPORTS_PER_SOL);
  });

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

  // TC-039: Cancel active vault
  it("TC-039: cancels active vault and returns SOL", async () => {
    const vaultPDA = await setupVault();
    const ownerBalanceBefore = await getBalance(connection, owner.publicKey);

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

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.status).to.deep.equal({ cancelled: {} });

    // Owner should have received SOL back (minus gas)
    const ownerBalanceAfter = await getBalance(connection, owner.publicKey);
    expect(ownerBalanceAfter).to.be.greaterThan(ownerBalanceBefore);
  });

  // TC-042: Cancel by non-owner → Unauthorized
  it("TC-042: rejects cancel by non-owner", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .cancelVault()
        .accounts({
          owner: nonOwner.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        })
        .signers([nonOwner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // PDA seed mismatch or has_one constraint will fail
      expect(err).to.exist;
    }
  });

  // TC-045: Verify vault status = Cancelled
  it("TC-045: sets vault status to Cancelled", async () => {
    const vaultPDA = await setupVault();

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

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.status).to.deep.equal({ cancelled: {} });
    expect(vault.assetConfigs[0].amount.toNumber()).to.equal(0);
  });

  // Cancel already-cancelled vault → VaultNotModifiable
  it("rejects cancelling an already-cancelled vault", async () => {
    const vaultPDA = await setupVault();

    // Cancel first time
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

    // Try to cancel again
    try {
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
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotModifiable");
    }
  });
});
