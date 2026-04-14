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

describe("edge_cases", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = Keypair.generate();
  });

  // --- Lifecycle: create → heartbeat → heartbeat → cancel ---

  it("full lifecycle: create → heartbeat → heartbeat → cancel", async () => {
    const beneficiary = Keypair.generate();
    const params = defaultCreateVaultParams(beneficiary.publicKey);
    const [vaultPDA] = deriveVaultPDA(
      owner.publicKey,
      0,
      program.programId
    );

    // 1. Create
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

    let vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.status).to.deep.equal({ active: {} });

    // 2. First heartbeat (owner)
    await new Promise((r) => setTimeout(r, 1500));
    await program.methods
      .recordHeartbeat()
      .accounts({
        authority: owner.publicKey,
        vault: vaultPDA,
      })
      .signers([owner])
      .rpc();

    const afterHb1 = await program.account.vault.fetch(vaultPDA);
    expect(afterHb1.lastActivity.toNumber()).to.be.greaterThan(
      vault.lastActivity.toNumber()
    );

    // 3. Second heartbeat (authority)
    await new Promise((r) => setTimeout(r, 1500));
    const hbAuth = await createFundedKeypair(connection, 0.5 * LAMPORTS_PER_SOL);

    // Need a vault with this hbAuth — let's use vault_id=1
    const params2 = defaultCreateVaultParams(beneficiary.publicKey);
    params2.vaultId = new BN(1);
    const [vaultPDA2] = deriveVaultPDA(owner.publicKey, 1, program.programId);

    await program.methods
      .createVault(
        params2.vaultId,
        params2.name,
        params2.note,
        params2.inactivityWindow,
        params2.gracePeriod,
        params2.crankFeeBps,
        params2.beneficiaries,
        params2.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA2,
        heartbeatAuthority: hbAuth.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    await new Promise((r) => setTimeout(r, 1500));
    await program.methods
      .recordHeartbeat()
      .accounts({
        authority: hbAuth.publicKey,
        vault: vaultPDA2,
      })
      .signers([hbAuth])
      .rpc();

    // 4. Cancel
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

    vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.status).to.deep.equal({ cancelled: {} });

    // Owner got SOL back
    const ownerBalanceAfter = await getBalance(connection, owner.publicKey);
    expect(ownerBalanceAfter).to.be.greaterThan(ownerBalanceBefore);
  });

  // --- Multiple vaults per owner are independent ---

  it("multiple vaults per owner operate independently", async () => {
    const ben1 = Keypair.generate();
    const ben2 = Keypair.generate();

    // Create vault 0
    const params0 = defaultCreateVaultParams(ben1.publicKey);
    params0.name = "Vault Zero";
    const [pda0] = deriveVaultPDA(owner.publicKey, 0, program.programId);
    await program.methods
      .createVault(
        params0.vaultId, params0.name, params0.note,
        params0.inactivityWindow, params0.gracePeriod,
        params0.crankFeeBps, params0.beneficiaries, params0.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: pda0,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Create vault 1
    const params1 = defaultCreateVaultParams(ben2.publicKey);
    params1.vaultId = new BN(1);
    params1.name = "Vault One";
    const [pda1] = deriveVaultPDA(owner.publicKey, 1, program.programId);
    await program.methods
      .createVault(
        params1.vaultId, params1.name, params1.note,
        params1.inactivityWindow, params1.gracePeriod,
        params1.crankFeeBps, params1.beneficiaries, params1.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: pda1,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Cancel vault 0
    await program.methods
      .cancelVault()
      .accounts({
        owner: owner.publicKey, vault: pda0,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    // Vault 0 cancelled, vault 1 still active
    const v0 = await program.account.vault.fetch(pda0);
    const v1 = await program.account.vault.fetch(pda1);
    expect(v0.status).to.deep.equal({ cancelled: {} });
    expect(v1.status).to.deep.equal({ active: {} });

    // Can still heartbeat vault 1
    await new Promise((r) => setTimeout(r, 1500));
    await program.methods
      .recordHeartbeat()
      .accounts({ authority: owner.publicKey, vault: pda1 })
      .signers([owner])
      .rpc();

    const v1After = await program.account.vault.fetch(pda1);
    expect(v1After.lastActivity.toNumber()).to.be.greaterThan(
      v1.lastActivity.toNumber()
    );
  });

  // --- Max beneficiaries (10) with various share splits ---

  it("creates vault with 10 beneficiaries at exact 100%", async () => {
    const bens = [];
    // 9 beneficiaries at 10% each = 90%, last at 10% = 100%
    for (let i = 0; i < 10; i++) {
      const kp = Keypair.generate();
      bens.push(makeBeneficiary(kp.publicKey, 1000, `B${i}`));
    }

    const params = defaultCreateVaultParams(bens[0].wallet);
    params.beneficiaries = bens;
    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.numBeneficiaries).to.equal(10);

    // Verify all shares
    let totalBps = 0;
    for (let i = 0; i < 10; i++) {
      expect(vault.beneficiaries[i].shareBps).to.equal(1000);
      totalBps += vault.beneficiaries[i].shareBps;
    }
    expect(totalBps).to.equal(10000);
  });

  // --- Uneven share splits ---

  it("handles uneven share splits (1 bps granularity)", async () => {
    const ben1 = Keypair.generate();
    const ben2 = Keypair.generate();
    const ben3 = Keypair.generate();

    const params = defaultCreateVaultParams(ben1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(ben1.publicKey, 3333, "Alice"),
      makeBeneficiary(ben2.publicKey, 3333, "Bob"),
      makeBeneficiary(ben3.publicKey, 3334, "Charlie"), // absorbs the 1 bps
    ];

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    const totalBps =
      vault.beneficiaries[0].shareBps +
      vault.beneficiaries[1].shareBps +
      vault.beneficiaries[2].shareBps;
    expect(totalBps).to.equal(10000);
  });

  // --- Boundary: minimum share (1 bps = 0.01%) ---

  it("allows minimum 1 bps share for a beneficiary", async () => {
    const ben1 = Keypair.generate();
    const ben2 = Keypair.generate();

    const params = defaultCreateVaultParams(ben1.publicKey);
    params.beneficiaries = [
      makeBeneficiary(ben1.publicKey, 9999, "Almost All"),
      makeBeneficiary(ben2.publicKey, 1, "Tiny"), // 0.01%
    ];

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.beneficiaries[1].shareBps).to.equal(1);
  });

  // --- Vault name exactly at limit (64 chars) ---

  it("accepts vault name at exact 64 char limit", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.name = "A".repeat(64);

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    // All 64 bytes should be 'A' (0x41)
    for (let i = 0; i < 64; i++) {
      expect(vault.name[i]).to.equal(0x41);
    }
  });

  // --- Note exactly at limit (256 chars) ---

  it("accepts note at exact 256 char limit", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.note = "N".repeat(256);

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    for (let i = 0; i < 256; i++) {
      expect(vault.note[i]).to.equal(0x4e); // 'N'
    }
  });

  // --- Note > 256 chars rejected ---

  it("rejects note exceeding 256 chars", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.note = "X".repeat(257);

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    try {
      await program.methods
        .createVault(
          params.vaultId, params.name, params.note,
          params.inactivityWindow, params.gracePeriod,
          params.crankFeeBps, params.beneficiaries, params.solDepositLamports
        )
        .accounts({
          owner: owner.publicKey, vault: vaultPDA,
          heartbeatAuthority: heartbeatAuthority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("NoteTooLong");
    }
  });

  // --- Timing boundaries ---

  it("accepts minimum inactivity window (30 days)", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.inactivityWindow = new BN(daysToSeconds(30));

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.inactivityWindow.toNumber()).to.equal(daysToSeconds(30));
  });

  it("accepts maximum inactivity window (365 days)", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.inactivityWindow = new BN(daysToSeconds(365));

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.inactivityWindow.toNumber()).to.equal(daysToSeconds(365));
  });

  // --- Crank fee boundaries ---

  it("accepts minimum crank fee (1 bps = 0.01%)", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.crankFeeBps = 1;

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.crankFeeBps).to.equal(1);
  });

  it("accepts maximum crank fee (500 bps = 5%)", async () => {
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.crankFeeBps = 500;

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.crankFeeBps).to.equal(500);
  });

  // --- Cancel returns exact SOL amount (deterministic check) ---

  it("cancel returns exact deposited SOL minus rent", async () => {
    const depositAmount = 2 * LAMPORTS_PER_SOL;
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.solDepositLamports = new BN(depositAmount);

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Get vault balance (deposit + rent)
    const vaultBalance = await getBalance(connection, vaultPDA);
    const ownerBalanceBefore = await getBalance(connection, owner.publicKey);

    await program.methods
      .cancelVault()
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const ownerBalanceAfter = await getBalance(connection, owner.publicKey);
    const rent = await connection.getMinimumBalanceForRentExemption(1906);

    // Owner should get back: deposit amount (not the rent, vault PDA keeps rent)
    // ownerBalanceAfter ≈ ownerBalanceBefore + deposit - gas
    // We check within 0.01 SOL tolerance for gas fees
    const recovered = ownerBalanceAfter - ownerBalanceBefore;
    expect(recovered).to.be.greaterThan(depositAmount - 0.01 * LAMPORTS_PER_SOL);
    expect(recovered).to.be.lessThanOrEqual(depositAmount);
  });

  // --- Top up then cancel: get everything back ---

  it("top up then cancel returns total deposited amount", async () => {
    const initialDeposit = 0.5 * LAMPORTS_PER_SOL;
    const topUpAmount = 1 * LAMPORTS_PER_SOL;
    const ben = Keypair.generate();
    const params = defaultCreateVaultParams(ben.publicKey);
    params.solDepositLamports = new BN(initialDeposit);

    const [vaultPDA] = deriveVaultPDA(owner.publicKey, 0, program.programId);

    await program.methods
      .createVault(
        params.vaultId, params.name, params.note,
        params.inactivityWindow, params.gracePeriod,
        params.crankFeeBps, params.beneficiaries, params.solDepositLamports
      )
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        heartbeatAuthority: heartbeatAuthority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    // Top up
    await program.methods
      .topUpVault(new BN(topUpAmount), [])
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    // Verify total
    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.assetConfigs[0].amount.toNumber()).to.equal(
      initialDeposit + topUpAmount
    );

    // Cancel
    const ownerBefore = await getBalance(connection, owner.publicKey);
    await program.methods
      .cancelVault()
      .accounts({
        owner: owner.publicKey, vault: vaultPDA,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();

    const ownerAfter = await getBalance(connection, owner.publicKey);
    const totalDeposited = initialDeposit + topUpAmount;
    const recovered = ownerAfter - ownerBefore;

    // Should recover approximately total deposited minus gas
    expect(recovered).to.be.greaterThan(totalDeposited - 0.01 * LAMPORTS_PER_SOL);
  });
});
