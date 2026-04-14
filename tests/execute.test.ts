import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  airdrop,
  createFundedKeypair,
  defaultCreateVaultParams,
  deriveVaultPDA,
  daysToSeconds,
  getBalance,
  getProgram,
  makeBeneficiary,
  SystemProgram,
} from "./helpers";

/**
 * Execute redistribution tests.
 *
 * NOTE: These tests use production timing (30+ day windows) so we cannot
 * actually trigger execution in a test. Instead we test:
 * 1. Execute fails when vault is still active (VaultNotTriggered)
 * 2. Execute fails on cancelled/executed vaults (VaultNotModifiable)
 * 3. Execute succeeds via time-warped local validator (solana-test-validator --warp-slot)
 *
 * For the time-warp tests, we'd need bankrun or a custom test validator.
 * For now, test the error paths and account setup.
 */
describe("execute_redistribution", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;
  let beneficiary1: Keypair;
  let beneficiary2: Keypair;
  let beneficiary3: Keypair;
  let crankOperator: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = Keypair.generate();
    beneficiary1 = await createFundedKeypair(connection, 0.1 * LAMPORTS_PER_SOL);
    beneficiary2 = await createFundedKeypair(connection, 0.1 * LAMPORTS_PER_SOL);
    beneficiary3 = await createFundedKeypair(connection, 0.1 * LAMPORTS_PER_SOL);
    crankOperator = await createFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);
  });

  async function setupVault(
    vaultId: number = 0,
    beneficiaries?: { wallet: PublicKey; shareBps: number; name: string }[],
    solDeposit?: number
  ) {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.vaultId = new BN(vaultId);
    if (beneficiaries) params.beneficiaries = beneficiaries;
    if (solDeposit) params.solDepositLamports = new BN(solDeposit);

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

  // TC-029: Execute before inactivity window elapsed → VaultNotTriggered
  it("TC-029: rejects execution before inactivity window", async () => {
    const vaultPDA = await setupVault(0, [
      makeBeneficiary(beneficiary1.publicKey, 10000, "Alice"),
    ]);

    try {
      await program.methods
        .executeRedistribution()
        .accounts({
          crank: crankOperator.publicKey,
          vault: vaultPDA,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: beneficiary1.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([crankOperator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotTriggered");
    }
  });

  // TC-035: Execute already-executed vault → VaultNotModifiable
  // (Can't actually execute, so we test cancelled vault as proxy)
  it("TC-036: rejects execution on cancelled vault", async () => {
    const vaultPDA = await setupVault();

    // Cancel first
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
        .executeRedistribution()
        .accounts({
          crank: crankOperator.publicKey,
          vault: vaultPDA,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: beneficiary1.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([crankOperator])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotModifiable");
    }
  });

  // TC-037: Anyone can call execute (permissionless) — verified by using a random wallet
  it("TC-037: random wallet can call execute (permissionless)", async () => {
    const vaultPDA = await setupVault();
    const randomCrank = await createFundedKeypair(connection, 1 * LAMPORTS_PER_SOL);

    // Will fail with VaultNotTriggered (not Unauthorized) — proving it's permissionless
    try {
      await program.methods
        .executeRedistribution()
        .accounts({
          crank: randomCrank.publicKey,
          vault: vaultPDA,
          owner: owner.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        })
        .remainingAccounts([
          { pubkey: beneficiary1.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([randomCrank])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Should fail with VaultNotTriggered, NOT Unauthorized
      expect(err.error.errorCode.code).to.equal("VaultNotTriggered");
    }
  });

  // Verify vault stores correct data for multi-beneficiary setup
  it("verifies multi-beneficiary vault setup for future execution", async () => {
    const bens = [
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
      makeBeneficiary(beneficiary2.publicKey, 3000, "Bob"),
      makeBeneficiary(beneficiary3.publicKey, 2000, "Charlie"),
    ];
    const depositAmount = 5 * LAMPORTS_PER_SOL;

    const vaultPDA = await setupVault(0, bens, depositAmount);
    const vault = await program.account.vault.fetch(vaultPDA);

    expect(vault.numBeneficiaries).to.equal(3);
    expect(vault.beneficiaries[0].shareBps).to.equal(5000);
    expect(vault.beneficiaries[1].shareBps).to.equal(3000);
    expect(vault.beneficiaries[2].shareBps).to.equal(2000);
    expect(vault.numAssets).to.equal(1);
    expect(vault.assetConfigs[0].amount.toNumber()).to.equal(depositAmount);

    // Verify vault has the SOL
    const vaultBalance = await getBalance(connection, vaultPDA);
    expect(vaultBalance).to.be.greaterThan(depositAmount);
  });

  // Verify crank fee calculation math
  it("verifies crank fee math setup", async () => {
    const depositAmount = 5 * LAMPORTS_PER_SOL;
    const vaultPDA = await setupVault(
      0,
      [makeBeneficiary(beneficiary1.publicKey, 10000, "Alice")],
      depositAmount
    );

    const vault = await program.account.vault.fetch(vaultPDA);
    const crankFeeBps = vault.crankFeeBps;

    // Expected crank fee: 5 SOL * 10 bps / 10000 = 0.005 SOL
    const expectedFee = Math.floor(
      (depositAmount * crankFeeBps) / 10000
    );
    expect(expectedFee).to.equal(0.005 * LAMPORTS_PER_SOL);

    // Expected distributable: 5 SOL - 0.005 SOL = 4.995 SOL
    const distributable = depositAmount - expectedFee;
    expect(distributable).to.equal(4.995 * LAMPORTS_PER_SOL);
  });
});
