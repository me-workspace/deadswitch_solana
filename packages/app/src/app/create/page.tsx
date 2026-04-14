"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Shield, ArrowLeft, ArrowRight, Loader2, CheckCircle, ExternalLink } from "lucide-react";
import dynamic from "next/dynamic";

import { StepIndicator } from "@/components/vault/StepIndicator";
import { BeneficiaryForm, type BeneficiaryEntry } from "@/components/vault/BeneficiaryForm";
import { AssetSelector, type AssetDeposit } from "@/components/vault/AssetSelector";
import { TimingSelector, CrankFeeSelector } from "@/components/vault/TimingSelector";
import { TransactionToast, useTransactionToast } from "@/components/vault/TransactionToast";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useDeadswitchProgram } from "@/hooks/useDeadswitchProgram";
import {
  isValidSolanaAddress,
  formatUsd,
  formatDuration,
  truncateAddress,
  parseAnchorError,
  cn,
  decimalToSmallestUnit,
} from "@/lib/utils";
import { TOKEN_MINTS, NATIVE_SOL_MINT } from "@deadswitch/sdk";
import { buildCreateVaultTx, buildTopUpVaultTx, type CreateVaultParams, type SplDepositInput } from "@/lib/solana/instructions";
import { PROGRAM_ID } from "@/lib/solana/program";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

/** Wizard step definitions */
const WIZARD_STEPS = [
  { number: 1, label: "Name" },
  { number: 2, label: "Beneficiaries" },
  { number: 3, label: "Assets" },
  { number: 4, label: "Timing" },
  { number: 5, label: "Review" },
];

/** Timing presets from SDK constants */
const TIMING_PRESETS = [
  { days: 30, label: "30 days", description: "For daily active traders" },
  { days: 60, label: "60 days", description: "For weekly active users" },
  { days: 90, label: "90 days", description: "Recommended for most users", recommended: true },
  { days: 120, label: "120 days", description: "For monthly active users" },
  { days: 180, label: "180 days", description: "For long-term holders" },
  { days: 365, label: "365 days", description: "Maximum caution" },
] as const;

const GRACE_PRESETS = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days", recommended: true },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

/** Token mints sourced from SDK constants */
const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet") || "devnet";

const DEFAULT_DEPOSITS: AssetDeposit[] = [
  { mint: NATIVE_SOL_MINT.toBase58(), symbol: "SOL", amount: "", decimals: 9 },
  { mint: TOKEN_MINTS[network].USDC.toBase58(), symbol: "USDC", amount: "", decimals: 6 },
  { mint: TOKEN_MINTS[network].USDT.toBase58(), symbol: "USDT", amount: "", decimals: 6 },
];

/**
 * Multi-step vault creation wizard.
 * 5 steps: Name -> Beneficiaries -> Assets -> Timing -> Review & Confirm.
 */
export default function CreateVaultPage() {
  const router = useRouter();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { balances, isLoading: balancesLoading } = useTokenBalances();
  const { prices } = useTokenPrices();
  const { toast, showToast, dismissToast } = useTransactionToast();

  // Step state
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Name & Note
  const [vaultName, setVaultName] = useState("");
  const [vaultNote, setVaultNote] = useState("");

  // Step 2: Beneficiaries
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryEntry[]>([
    { name: "", wallet: "", shareBps: 10_000 },
  ]);

  // Step 3: Assets
  const [deposits, setDeposits] = useState<AssetDeposit[]>(DEFAULT_DEPOSITS);

  // Step 4: Timing
  const [inactivityDays, setInactivityDays] = useState(90);
  const [graceDays, setGraceDays] = useState(7);
  const [crankFeeBps, setCrankFeeBps] = useState(10);

  // Step 5: Transaction state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdVaultPubkey, setCreatedVaultPubkey] = useState<string | null>(null);

  // Owner wallet as string
  const ownerWallet = publicKey?.toBase58() ?? "";

  // -------------------------------------------------------------------------
  // Validation logic
  // -------------------------------------------------------------------------

  const step1Valid = useMemo(() => {
    return vaultName.trim().length >= 1 && vaultName.length <= 64 && vaultNote.length <= 256;
  }, [vaultName, vaultNote]);

  const step2Valid = useMemo(() => {
    if (beneficiaries.length < 1 || beneficiaries.length > 10) return false;
    const totalBps = beneficiaries.reduce((s, b) => s + b.shareBps, 0);
    if (totalBps !== 10_000) return false;

    const wallets = new Set<string>();
    for (const b of beneficiaries) {
      if (!b.name.trim() || b.name.length > 32) return false;
      if (!isValidSolanaAddress(b.wallet)) return false;
      if (b.wallet === ownerWallet) return false;
      if (wallets.has(b.wallet)) return false;
      wallets.add(b.wallet);
      if (b.shareBps < 1 || b.shareBps > 9999) return false;
    }
    return true;
  }, [beneficiaries, ownerWallet]);

  const step3Valid = useMemo(() => {
    const hasDeposit = deposits.some((d) => parseFloat(d.amount) > 0);
    if (!hasDeposit) return false;

    for (const d of deposits) {
      const amt = parseFloat(d.amount);
      if (amt <= 0) continue; // Skip zero deposits
      const balance = balances.find((b) => b.mint === d.mint);
      if (balance && amt > balance.uiAmount) return false;
    }
    return true;
  }, [deposits, balances]);

  const step4Valid = useMemo(() => {
    return (
      inactivityDays >= 30 &&
      inactivityDays <= 365 &&
      graceDays >= 1 &&
      graceDays <= 30 &&
      crankFeeBps >= 1 &&
      crankFeeBps <= 500
    );
  }, [inactivityDays, graceDays, crankFeeBps]);

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1: return step1Valid;
      case 2: return step2Valid;
      case 3: return step3Valid;
      case 4: return step4Valid;
      case 5: return true;
      default: return false;
    }
  }, [currentStep, step1Valid, step2Valid, step3Valid, step4Valid]);

  // -------------------------------------------------------------------------
  // Computed values for review
  // -------------------------------------------------------------------------

  const totalDepositUsd = useMemo(() => {
    return deposits.reduce((sum, d) => {
      const amt = parseFloat(d.amount) || 0;
      const price = prices[d.symbol] ?? 0;
      return sum + amt * price;
    }, 0);
  }, [deposits, prices]);

  const estimatedCrankFeeUsd = useMemo(() => {
    return totalDepositUsd * (crankFeeBps / 10_000);
  }, [totalDepositUsd, crankFeeBps]);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  const goNext = useCallback(() => {
    if (currentStep < 5 && canProceed) {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, canProceed]);

  const goBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !connected || isSubmitting) return;
    if (!step1Valid || !step2Valid || !step3Valid || !step4Valid) return;

    setIsSubmitting(true);
    showToast("pending", "Creating vault... Please approve the transaction in your wallet.");

    try {
      // Use timestamp * 1000 + random to prevent collisions
      const vaultId = new BN(Date.now() * 1000 + Math.floor(Math.random() * 1000));

      // Build SOL deposit amount using decimal-safe conversion
      const solDeposit = deposits.find((d) => d.symbol === "SOL");
      const solLamports = new BN(decimalToSmallestUnit(solDeposit?.amount || "0", 9));

      // Build beneficiary inputs
      const beneficiaryInputs = beneficiaries.map((b) => ({
        wallet: new PublicKey(b.wallet),
        shareBps: b.shareBps,
        name: b.name,
      }));

      // Build create vault params
      const params: CreateVaultParams = {
        owner: publicKey,
        vaultId,
        name: vaultName.trim(),
        note: vaultNote.trim(),
        inactivityWindow: new BN(inactivityDays * 86_400),
        gracePeriod: new BN(graceDays * 86_400),
        crankFeeBps,
        beneficiaries: beneficiaryInputs,
        solDepositLamports: solLamports,
        heartbeatAuthority: new PublicKey(
          process.env.NEXT_PUBLIC_HEARTBEAT_AUTHORITY || publicKey.toBase58()
        ),
      };

      const tx = await buildCreateVaultTx(params);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      // Simulate first to catch errors without spending gas
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const simError = JSON.stringify(simulation.value.err);
        throw new Error(`Transaction simulation failed: ${simError}`);
      }

      const signature = await sendTransaction(tx, connection);

      showToast("pending", "Transaction sent. Waiting for confirmation...", signature);

      await connection.confirmTransaction(signature, "confirmed");

      // Derive the vault PDA to link to
      const { deriveVaultPDA } = await import("@deadswitch/sdk");
      const [vaultPDA] = deriveVaultPDA(publicKey, vaultId, PROGRAM_ID);

      setCreatedVaultPubkey(vaultPDA.toBase58());

      // Chain SPL deposits if any
      const splDeposits: SplDepositInput[] = deposits
        .filter((d) => d.symbol !== "SOL" && parseFloat(d.amount) > 0)
        .map((d) => ({
          mint: new PublicKey(d.mint),
          amount: new BN(decimalToSmallestUnit(d.amount, d.decimals)),
        }));

      let splDepositSuccess = false;

      if (splDeposits.length > 0) {
        showToast("pending", "Depositing tokens into vault...", signature);
        try {
          const topUpTx = await buildTopUpVaultTx(vaultPDA, publicKey, new BN(0), splDeposits);
          topUpTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
          topUpTx.feePayer = publicKey;

          const sim = await connection.simulateTransaction(topUpTx);
          if (sim.value.err) {
            throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
          }

          const topUpSig = await sendTransaction(topUpTx, connection);
          await connection.confirmTransaction(topUpSig, "confirmed");
          splDepositSuccess = true;
          showToast("confirmed", "Vault created and tokens deposited!", topUpSig);
        } catch (splErr) {
          console.error("SPL deposit failed:", splErr);
          showToast(
            "confirmed",
            "Vault created with SOL only. Token deposit failed — you can top up from the vault page.",
            signature
          );
          // Non-blocking — vault is created with SOL only
        }
      } else {
        showToast("confirmed", "Vault created successfully!", signature);
      }

      // Build assets list based on what was actually deposited
      const depositedAssets = deposits
        .filter((d) => {
          if (parseFloat(d.amount) <= 0) return false;
          // SOL is always deposited; SPL only if top-up succeeded
          if (d.symbol === "SOL") return true;
          return splDepositSuccess;
        })
        .map((d) => ({
          mint: d.mint,
          symbol: d.symbol,
          amount: decimalToSmallestUnit(d.amount, d.decimals),
          decimals: d.decimals,
        }));

      // Sync vault to database (non-blocking)
      try {
        await fetch("/api/vaults/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vaultPubkey: vaultPDA.toBase58(),
            ownerPubkey: publicKey.toBase58(),
            vaultIdOnchain: vaultId.toNumber(),
            name: vaultName.trim(),
            note: vaultNote.trim(),
            inactivityWindowSecs: inactivityDays * 86_400,
            gracePeriodSecs: graceDays * 86_400,
            crankFeeBps,
            beneficiaries: beneficiaries.map((b) => ({
              wallet: b.wallet,
              name: b.name,
              shareBps: b.shareBps,
            })),
            assets: depositedAssets,
          }),
        });
      } catch (syncErr) {
        console.error("Failed to sync vault to DB:", syncErr);
        // Non-blocking — vault is already onchain
      }

      // Register Helius webhook for auto-heartbeat (non-blocking)
      try {
        await fetch("/api/webhooks/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerWallet: publicKey.toBase58(),
          }),
        });
      } catch (webhookErr) {
        console.error("Failed to register webhook:", webhookErr);
        // Non-blocking — user can still send manual heartbeats
      }
    } catch (err) {
      console.error("Vault creation failed:", err);
      showToast("error", parseAnchorError(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    publicKey,
    connected,
    isSubmitting,
    step1Valid,
    step2Valid,
    step3Valid,
    step4Valid,
    deposits,
    beneficiaries,
    vaultName,
    vaultNote,
    inactivityDays,
    graceDays,
    crankFeeBps,
    connection,
    sendTransaction,
    showToast,
  ]);

  // -------------------------------------------------------------------------
  // Handle Enter key for navigation
  // -------------------------------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canProceed && currentStep < 5) {
        e.preventDefault();
        goNext();
      }
    },
    [canProceed, currentStep, goNext]
  );

  // -------------------------------------------------------------------------
  // Render: wallet not connected
  // -------------------------------------------------------------------------

  if (!connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-32">
        <Shield className="h-16 w-16 text-gray-600" aria-hidden="true" />
        <div className="text-center">
          <h2 className="text-2xl font-bold">Connect Your Wallet</h2>
          <p className="mt-2 text-gray-400">
            Connect your Solana wallet to create a vault.
          </p>
        </div>
        <WalletMultiButton
          style={{
            backgroundColor: "#00ff88",
            color: "#000",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            height: "3rem",
            padding: "0 1.5rem",
          }}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: success state
  // -------------------------------------------------------------------------

  if (createdVaultPubkey) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 text-center">
        <div className="flex justify-center mb-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#00ff88]/10">
            <CheckCircle className="h-10 w-10 text-[#00ff88]" aria-hidden="true" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white">Vault Created!</h1>
        <p className="mt-3 text-gray-400">
          Your inheritance vault has been created and is now active on Solana.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => router.push(`/vault/${createdVaultPubkey}`)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#00ff88] px-5 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            View Vault
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-5 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            Back to Dashboard
          </button>
        </div>

        {toast && (
          <TransactionToast
            status={toast.status}
            message={toast.message}
            txSignature={toast.txSignature}
            onDismiss={dismissToast}
          />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: wizard
  // -------------------------------------------------------------------------

  return (
    <div
      className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create Vault</h1>
        <p className="mt-1 text-sm text-gray-400">
          Set up your inheritance vault step by step.
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <StepIndicator steps={WIZARD_STEPS} currentStep={currentStep} />
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 sm:p-8">
        {/* Step 1: Name & Note */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Name Your Vault</h2>
              <p className="mt-1 text-sm text-gray-400">
                Give your vault a memorable name and optional message for your beneficiaries.
              </p>
            </div>

            <div>
              <label htmlFor="vault-name" className="block text-sm font-medium text-white mb-1.5">
                Vault Name <span className="text-red-400">*</span>
              </label>
              <input
                id="vault-name"
                type="text"
                value={vaultName}
                onChange={(e) => setVaultName(e.target.value.slice(0, 64))}
                placeholder="e.g. Family Inheritance"
                maxLength={64}
                autoFocus
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-gray-600 focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50"
                aria-required="true"
              />
              <p className="mt-1 text-right text-xs text-gray-600">
                {vaultName.length}/64
              </p>
            </div>

            <div>
              <label htmlFor="vault-note" className="block text-sm font-medium text-white mb-1.5">
                Note to Beneficiaries
              </label>
              <textarea
                id="vault-note"
                value={vaultNote}
                onChange={(e) => setVaultNote(e.target.value.slice(0, 256))}
                placeholder="Optional message for your beneficiaries..."
                maxLength={256}
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-gray-600 focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50 resize-none"
              />
              <p className="mt-1 text-right text-xs text-gray-600">
                {vaultNote.length}/256
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Beneficiaries */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Add Beneficiaries</h2>
              <p className="mt-1 text-sm text-gray-400">
                Specify who will receive your assets and their share percentages. Shares must total exactly 100%.
              </p>
            </div>

            <BeneficiaryForm
              beneficiaries={beneficiaries}
              onChange={setBeneficiaries}
              ownerWallet={ownerWallet}
            />
          </div>
        )}

        {/* Step 3: Assets */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Deposit Assets</h2>
              <p className="mt-1 text-sm text-gray-400">
                Choose which tokens and how much to deposit into your vault. You must deposit at least one asset.
              </p>
            </div>

            <AssetSelector
              balances={balances}
              deposits={deposits}
              onChange={setDeposits}
              prices={prices}
              isLoading={balancesLoading}
            />
          </div>
        )}

        {/* Step 4: Timing */}
        {currentStep === 4 && (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-semibold text-white">Configure Timing</h2>
              <p className="mt-1 text-sm text-gray-400">
                Set how long your wallet must be inactive before triggering redistribution.
              </p>
            </div>

            <TimingSelector
              label="Inactivity Window"
              helpText="How long without activity before the vault begins its trigger process"
              presets={TIMING_PRESETS}
              value={inactivityDays}
              onChange={setInactivityDays}
              min={30}
              max={365}
            />

            <TimingSelector
              label="Grace Period"
              helpText="Additional time after inactivity window to send a heartbeat before execution"
              presets={GRACE_PRESETS}
              value={graceDays}
              onChange={setGraceDays}
              min={1}
              max={30}
            />

            <CrankFeeSelector value={crankFeeBps} onChange={setCrankFeeBps} />

            {/* Summary */}
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm text-gray-400">
                If your wallet is inactive for{" "}
                <span className="font-semibold text-white">
                  {formatDuration(inactivityDays * 86_400)}
                </span>{" "}
                + a{" "}
                <span className="font-semibold text-white">
                  {formatDuration(graceDays * 86_400)}
                </span>{" "}
                grace period, assets will be redistributed to your beneficiaries.
              </p>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Review & Confirm</h2>
              <p className="mt-1 text-sm text-gray-400">
                Review your vault settings before creating it on Solana.
              </p>
            </div>

            {/* Vault info */}
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Vault Info
                </h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Name</span>
                    <span className="text-white font-medium">{vaultName}</span>
                  </div>
                  {vaultNote && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500 shrink-0">Note</span>
                      <span className="text-white text-right">{vaultNote}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Beneficiaries */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Beneficiaries ({beneficiaries.length})
                </h3>
                <div className="space-y-2">
                  {beneficiaries.map((b, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-white font-medium truncate">
                          {b.name}
                        </span>
                        <span className="text-gray-600 font-mono text-xs">
                          {truncateAddress(b.wallet)}
                        </span>
                      </div>
                      <span className="text-[#00ff88] font-medium shrink-0 ml-2">
                        {(b.shareBps / 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Assets */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Assets
                </h3>
                <div className="space-y-2">
                  {deposits
                    .filter((d) => parseFloat(d.amount) > 0)
                    .map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-white">
                          {parseFloat(d.amount).toLocaleString("en-US", {
                            maximumFractionDigits: 6,
                          })}{" "}
                          {d.symbol}
                        </span>
                        <span className="text-gray-400">
                          {formatUsd((parseFloat(d.amount) || 0) * (prices[d.symbol] ?? 0))}
                        </span>
                      </div>
                    ))}
                  <div className="flex items-center justify-between text-sm border-t border-white/5 pt-2">
                    <span className="text-gray-500">Total Value</span>
                    <span className="text-white font-semibold">
                      {formatUsd(totalDepositUsd)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timing */}
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Timing & Fees
                </h3>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Inactivity Window</span>
                    <span className="text-white">{inactivityDays} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Grace Period</span>
                    <span className="text-white">{graceDays} days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Crank Fee</span>
                    <span className="text-white">{(crankFeeBps / 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between border-t border-white/5 pt-2">
                    <span className="text-gray-500">Est. Crank Fee Value</span>
                    <span className="text-gray-400">{formatUsd(estimatedCrankFeeUsd)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 1}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm text-gray-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] min-h-[44px]",
            currentStep === 1
              ? "opacity-0 pointer-events-none"
              : "hover:bg-white/5 hover:text-white"
          )}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </button>

        {currentStep < 5 ? (
          <button
            type="button"
            onClick={goNext}
            disabled={!canProceed}
            className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-5 py-3 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] min-h-[44px]"
          >
            Next
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] min-h-[44px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating Vault...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4" aria-hidden="true" />
                Create Vault
              </>
            )}
          </button>
        )}
      </div>

      {/* Transaction toast */}
      {toast && (
        <TransactionToast
          status={toast.status}
          message={toast.message}
          txSignature={toast.txSignature}
          onDismiss={dismissToast}
        />
      )}
    </div>
  );
}
