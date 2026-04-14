import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  createFundedKeypair,
  defaultCreateVaultParams,
  deriveVaultPDA,
  getBalance,
  getProgram,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "./helpers";

describe("top_up_vault", () => {
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

  async function setupVault(vaultId: number = 0, solDeposit?: number) {
    const params = defaultCreateVaultParams(beneficiary.publicKey);
    params.vaultId = new BN(vaultId);
    if (solDeposit !== undefined) {
      params.solDepositLamports = new BN(solDeposit);
    }

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

  // Top up with SOL on active vault
  it("tops up vault with additional SOL", async () => {
    const initialDeposit = 0.5 * LAMPORTS_PER_SOL;
    const topUpAmount = 1 * LAMPORTS_PER_SOL;
    const vaultPDA = await setupVault(0, initialDeposit);

    const vaultBefore = await program.account.vault.fetch(vaultPDA);
    expect(vaultBefore.assetConfigs[0].amount.toNumber()).to.equal(initialDeposit);

    await new Promise((r) => setTimeout(r, 1500));

    await program.methods
      .topUpVault(new BN(topUpAmount), [])
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const vaultAfter = await program.account.vault.fetch(vaultPDA);

    // Asset config should show sum
    expect(vaultAfter.assetConfigs[0].amount.toNumber()).to.equal(
      initialDeposit + topUpAmount
    );

    // Timer should be reset (proof of life)
    expect(vaultAfter.lastActivity.toNumber()).to.be.greaterThan(
      vaultBefore.lastActivity.toNumber()
    );
  });

  // Top up with SOL actually transfers lamports
  it("transfers SOL lamports to vault PDA", async () => {
    const vaultPDA = await setupVault(0, 0.5 * LAMPORTS_PER_SOL);
    const topUpAmount = 2 * LAMPORTS_PER_SOL;

    const vaultBalanceBefore = await getBalance(connection, vaultPDA);

    await program.methods
      .topUpVault(new BN(topUpAmount), [])
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const vaultBalanceAfter = await getBalance(connection, vaultPDA);
    expect(vaultBalanceAfter).to.equal(vaultBalanceBefore + topUpAmount);
  });

  // Top up by non-owner → Unauthorized (PDA mismatch)
  it("rejects top up by non-owner", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .topUpVault(new BN(0.1 * LAMPORTS_PER_SOL), [])
        .accounts({
          owner: nonOwner.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([nonOwner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // PDA seeds won't match because owner is different
      expect(err).to.exist;
    }
  });

  // Top up cancelled vault → VaultNotModifiable
  it("rejects top up on cancelled vault", async () => {
    const vaultPDA = await setupVault();

    // Cancel first
    await program.methods
      .cancelVault()
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    try {
      await program.methods
        .topUpVault(new BN(0.5 * LAMPORTS_PER_SOL), [])
        .accounts({
          owner: owner.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotModifiable");
    }
  });

  // Top up with zero amount → InsufficientDeposit
  it("rejects top up with zero amount", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .topUpVault(new BN(0), [])
        .accounts({
          owner: owner.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientDeposit");
    }
  });

  // Multiple top ups accumulate correctly
  it("accumulates multiple SOL top ups", async () => {
    const vaultPDA = await setupVault(0, 0.5 * LAMPORTS_PER_SOL);

    // Top up 3 times
    for (let i = 0; i < 3; i++) {
      await program.methods
        .topUpVault(new BN(0.1 * LAMPORTS_PER_SOL), [])
        .accounts({
          owner: owner.publicKey,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();
    }

    const vault = await program.account.vault.fetch(vaultPDA);
    const expectedTotal = 0.5 * LAMPORTS_PER_SOL + 3 * 0.1 * LAMPORTS_PER_SOL;
    expect(vault.assetConfigs[0].amount.toNumber()).to.equal(expectedTotal);
  });
});
