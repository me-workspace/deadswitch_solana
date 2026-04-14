import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import { Deadswitch } from "../packages/program/target/types/deadswitch";
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

describe("create_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;
  let beneficiary1: Keypair;
  let beneficiary2: Keypair;
  let beneficiary3: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = Keypair.generate();
    beneficiary1 = Keypair.generate();
    beneficiary2 = Keypair.generate();
    beneficiary3 = Keypair.generate();
  });

  /** Helper: create a vault with given params */
  async function createVault(
    params: ReturnType<typeof defaultCreateVaultParams>,
    ownerKp: Keypair = owner,
    hbAuth: Keypair = heartbeatAuthority
  ) {
    const [vaultPDA] = deriveVaultPDA(
      ownerKp.publicKey,
      params.vaultId.toNumber(),
      program.programId
    );

    return program.methods
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
        owner: ownerKp.publicKey,
        vault: vaultPDA,
        heartbeatAuthority: hbAuth.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([ownerKp])
      .rpc();
  }

  // TC-001: Valid 1 beneficiary SOL-only
  it("TC-001: creates vault with 1 beneficiary and SOL deposit", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    await createVault(params);

    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );
    const vault = await program.account.vault.fetch(vaultPDA);

    expect(vault.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(vault.vaultId.toNumber()).to.equal(0);
    expect(vault.numBeneficiaries).to.equal(1);
    expect(vault.beneficiaries[0].wallet.toBase58()).to.equal(
      beneficiary1.publicKey.toBase58()
    );
    expect(vault.beneficiaries[0].shareBps).to.equal(10_000);
    expect(vault.status).to.deep.equal({ active: {} });
    expect(vault.inactivityWindow.toNumber()).to.equal(daysToSeconds(90));
    expect(vault.gracePeriod.toNumber()).to.equal(daysToSeconds(7));
    expect(vault.crankFeeBps).to.equal(10);

    // Verify SOL deposited
    const vaultBalance = await getBalance(connection, vaultPDA);
    expect(vaultBalance).to.be.greaterThan(LAMPORTS_PER_SOL);
  });

  // TC-002: 3 beneficiaries, SOL + future USDC
  it("TC-002: creates vault with 3 beneficiaries", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
      makeBeneficiary(beneficiary2.publicKey, 3000, "Bob"),
      makeBeneficiary(beneficiary3.publicKey, 2000, "Charlie"),
    ];

    await createVault(params);

    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );
    const vault = await program.account.vault.fetch(vaultPDA);

    expect(vault.numBeneficiaries).to.equal(3);
    expect(vault.beneficiaries[0].shareBps).to.equal(5000);
    expect(vault.beneficiaries[1].shareBps).to.equal(3000);
    expect(vault.beneficiaries[2].shareBps).to.equal(2000);
  });

  // TC-003: 10 beneficiaries (max)
  it("TC-003: creates vault with 10 beneficiaries (max)", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [];

    for (let i = 0; i < 10; i++) {
      const kp = Keypair.generate();
      const share = i < 9 ? 1000 : 1000; // 10 × 1000 = 10000
      params.beneficiaries.push(makeBeneficiary(kp.publicKey, share, `Ben${i}`));
    }

    await createVault(params);

    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );
    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.numBeneficiaries).to.equal(10);
  });

  // TC-004: 11 beneficiaries → TooManyBeneficiaries
  it("TC-004: rejects 11 beneficiaries", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [];

    for (let i = 0; i < 11; i++) {
      const kp = Keypair.generate();
      params.beneficiaries.push(
        makeBeneficiary(kp.publicKey, i < 10 ? 909 : 910, `Ben${i}`)
      );
    }

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("TooManyBeneficiaries");
    }
  });

  // TC-005: 0 beneficiaries → NoBeneficiaries
  it("TC-005: rejects 0 beneficiaries", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [];

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NoBeneficiaries");
    }
  });

  // TC-006: Shares total 99%
  it("TC-006: rejects shares totaling 99%", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
      makeBeneficiary(beneficiary2.publicKey, 4900, "Bob"),
    ];

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SharesNotOneHundredPercent");
    }
  });

  // TC-007: Shares total 101%
  it("TC-007: rejects shares totaling 101%", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
      makeBeneficiary(beneficiary2.publicKey, 5100, "Bob"),
    ];

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SharesNotOneHundredPercent");
    }
  });

  // TC-008: Window = 29 days → InvalidInactivityWindow
  it("TC-008: rejects inactivity window below minimum", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.inactivityWindow = new BN(daysToSeconds(29));

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidInactivityWindow");
    }
  });

  // TC-009: Window = 366 days → InvalidInactivityWindow
  it("TC-009: rejects inactivity window above maximum", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.inactivityWindow = new BN(daysToSeconds(366));

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidInactivityWindow");
    }
  });

  // TC-010: Grace = 0 → InvalidGracePeriod
  it("TC-010: rejects zero grace period", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.gracePeriod = new BN(0);

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidGracePeriod");
    }
  });

  // TC-011: Self as beneficiary → SelfBeneficiary
  it("TC-011: rejects self as beneficiary", async () => {
    const params = defaultCreateVaultParams(owner.publicKey);

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SelfBeneficiary");
    }
  });

  // TC-012: Duplicate beneficiary → DuplicateBeneficiary
  it("TC-012: rejects duplicate beneficiary addresses", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
      makeBeneficiary(beneficiary1.publicKey, 5000, "Alice2"),
    ];

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("DuplicateBeneficiary");
    }
  });

  // TC-013: Crank fee = 0 → InvalidCrankFee
  it("TC-013: rejects zero crank fee", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.crankFeeBps = 0;

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidCrankFee");
    }
  });

  // TC-014: Crank fee = 501 bps → InvalidCrankFee
  it("TC-014: rejects crank fee above maximum", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.crankFeeBps = 501;

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidCrankFee");
    }
  });

  // TC-015: Name > 64 chars → VaultNameTooLong
  it("TC-015: rejects name exceeding 64 characters", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.name = "A".repeat(65);

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNameTooLong");
    }
  });

  // TC-016: Deposit 0 SOL → InsufficientDeposit
  it("TC-016: rejects zero SOL deposit", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    params.solDepositLamports = new BN(0);

    try {
      await createVault(params);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InsufficientDeposit");
    }
  });

  // TC-018: Verify last_activity == current timestamp
  it("TC-018: sets last_activity to current timestamp", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    await createVault(params);

    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );
    const vault = await program.account.vault.fetch(vaultPDA);

    // last_activity should be recent (within last 30 seconds)
    const now = Math.floor(Date.now() / 1000);
    expect(vault.lastActivity.toNumber()).to.be.closeTo(now, 30);
    expect(vault.createdAt.toNumber()).to.equal(vault.lastActivity.toNumber());
  });

  // TC-019: Verify PDA derivation matches
  it("TC-019: PDA derivation matches between TS and Rust", async () => {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
    const [expectedPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );

    await createVault(params);

    const vault = await program.account.vault.fetch(expectedPDA);
    expect(vault.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(vault.vaultId.toNumber()).to.equal(0);
  });

  // TC-020: Second vault for same owner
  it("TC-020: creates multiple vaults for same owner", async () => {
    const params0 = defaultCreateVaultParams(beneficiary1.publicKey);
    params0.name = "Vault Zero";
    await createVault(params0);

    const params1 = defaultCreateVaultParams(beneficiary2.publicKey);
    params1.vaultId = new BN(1);
    params1.name = "Vault One";
    await createVault(params1);

    const [vaultPDA0] = deriveVaultPDA(owner.publicKey, 0, program.programId);
    const [vaultPDA1] = deriveVaultPDA(owner.publicKey, 1, program.programId);

    const vault0 = await program.account.vault.fetch(vaultPDA0);
    const vault1 = await program.account.vault.fetch(vaultPDA1);

    expect(vault0.vaultId.toNumber()).to.equal(0);
    expect(vault1.vaultId.toNumber()).to.equal(1);
    expect(vaultPDA0.toBase58()).to.not.equal(vaultPDA1.toBase58());
  });
});
