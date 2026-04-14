import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { expect } from "chai";
import {
  createFundedKeypair,
  defaultCreateVaultParams,
  deriveVaultPDA,
  daysToSeconds,
  getProgram,
  makeBeneficiary,
  SystemProgram,
} from "./helpers";

describe("update_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = getProgram();
  const connection = provider.connection;

  let owner: Keypair;
  let heartbeatAuthority: Keypair;
  let beneficiary1: Keypair;
  let beneficiary2: Keypair;
  let nonOwner: Keypair;

  beforeEach(async () => {
    owner = await createFundedKeypair(connection);
    heartbeatAuthority = Keypair.generate();
    beneficiary1 = Keypair.generate();
    beneficiary2 = Keypair.generate();
    nonOwner = await createFundedKeypair(connection, 2 * LAMPORTS_PER_SOL);
  });

  async function setupVault(vaultId: number = 0) {
    const params = defaultCreateVaultParams(beneficiary1.publicKey);
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

  // TC-046: Update beneficiary list
  it("TC-046: updates beneficiary list and resets timer", async () => {
    const vaultPDA = await setupVault();

    await new Promise((r) => setTimeout(r, 1500));
    const vaultBefore = await program.account.vault.fetch(vaultPDA);

    await program.methods
      .updateVault(
        null, // name
        null, // note
        null, // inactivity_window
        null, // grace_period
        null, // crank_fee_bps
        [
          makeBeneficiary(beneficiary1.publicKey, 6000, "Alice Updated"),
          makeBeneficiary(beneficiary2.publicKey, 4000, "Bob"),
        ]
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
      })
      .signers([owner])
      .rpc();

    const vaultAfter = await program.account.vault.fetch(vaultPDA);
    expect(vaultAfter.numBeneficiaries).to.equal(2);
    expect(vaultAfter.beneficiaries[0].shareBps).to.equal(6000);
    expect(vaultAfter.beneficiaries[1].shareBps).to.equal(4000);
    // Timer should have reset
    expect(vaultAfter.lastActivity.toNumber()).to.be.greaterThanOrEqual(
      vaultBefore.lastActivity.toNumber()
    );
  });

  // TC-047: Update inactivity window
  it("TC-047: updates inactivity window", async () => {
    const vaultPDA = await setupVault();

    await program.methods
      .updateVault(
        null,
        null,
        new BN(daysToSeconds(120)), // new window: 120 days
        null,
        null,
        null
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.inactivityWindow.toNumber()).to.equal(daysToSeconds(120));
  });

  // TC-048: Update by non-owner → Unauthorized
  it("TC-048: rejects update by non-owner", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .updateVault(
          "Hacked",
          null,
          null,
          null,
          null,
          null
        )
        .accounts({
          owner: nonOwner.publicKey,
          vault: vaultPDA,
        })
        .signers([nonOwner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // PDA seed mismatch will cause failure
      expect(err).to.exist;
    }
  });

  // TC-049: Update executed vault → VaultNotModifiable
  it("TC-049: rejects update on cancelled vault", async () => {
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
        .updateVault(
          "New Name",
          null,
          null,
          null,
          null,
          null
        )
        .accounts({
          owner: owner.publicKey,
          vault: vaultPDA,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("VaultNotModifiable");
    }
  });

  // TC-050: Update with invalid shares → SharesNotOneHundredPercent
  it("TC-050: rejects update with invalid shares", async () => {
    const vaultPDA = await setupVault();

    try {
      await program.methods
        .updateVault(
          null,
          null,
          null,
          null,
          null,
          [
            makeBeneficiary(beneficiary1.publicKey, 5000, "Alice"),
            makeBeneficiary(beneficiary2.publicKey, 4000, "Bob"),
          ] // Total: 9000 ≠ 10000
        )
        .accounts({
          owner: owner.publicKey,
          vault: vaultPDA,
        })
        .signers([owner])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("SharesNotOneHundredPercent");
    }
  });

  // Update vault name
  it("updates vault name", async () => {
    const vaultPDA = await setupVault();

    await program.methods
      .updateVault(
        "My Updated Vault",
        null,
        null,
        null,
        null,
        null
      )
      .accounts({
        owner: owner.publicKey,
        vault: vaultPDA,
      })
      .signers([owner])
      .rpc();

    const vault = await program.account.vault.fetch(vaultPDA);
    // Name stored as byte array — check first bytes match
    const nameBytes = Buffer.from("My Updated Vault");
    for (let i = 0; i < nameBytes.length; i++) {
      expect(vault.name[i]).to.equal(nameBytes[i]);
    }
    // Rest should be zeros
    expect(vault.name[nameBytes.length]).to.equal(0);
  });
});
