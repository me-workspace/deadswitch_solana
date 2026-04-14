"use client";

import { useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  ArrowLeft,
  Heart,
  Settings,
  Clock,
  Users,
  Coins,
  ExternalLink,
  Loader2,
  Activity,
  Eye,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";

import { useVaultDetail } from "@/hooks/useVaultDetail";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { StatusBadge, type VaultDisplayStatus } from "@/components/vault/StatusBadge";
import { ProgressBar } from "@/components/vault/ProgressBar";
import { ActivityLog } from "@/components/vault/ActivityLog";
import { ConfirmModal } from "@/components/vault/ConfirmModal";
import { TransactionToast, useTransactionToast } from "@/components/vault/TransactionToast";
import { BeneficiaryForm, type BeneficiaryEntry } from "@/components/vault/BeneficiaryForm";
import { AssetSelector, type AssetDeposit } from "@/components/vault/AssetSelector";
import { TimingSelector, CrankFeeSelector } from "@/components/vault/TimingSelector";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import {
  truncateAddress,
  formatUsd,
  formatDate,
  formatDuration,
  formatSol,
  parseAnchorError,
  cn,
  decimalToSmallestUnit,
  isValidSolanaAddress,
} from "@/lib/utils";
import { TOKEN_MINTS, NATIVE_SOL_MINT } from "@deadswitch/sdk";
import {
  buildRecordHeartbeatTx,
  buildUpdateVaultTx,
  buildCancelVaultTx,
  buildTopUpVaultTx,
  type UpdateVaultParams,
  type BeneficiaryInput,
} from "@/lib/solana/instructions";
import { syncVaultToDb } from "@/lib/sync";

/** Timing presets (duplicated from create page for use in settings) */
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

type TabId = "overview" | "activity" | "settings";

/**
 * Vault detail page with three tabs: Overview, Activity, Settings.
 */
export default function VaultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: vaultId } = use(params);
  const router = useRouter();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { vault, isLoading, error, mutate } = useVaultDetail(vaultId);
  const { prices } = useTokenPrices();
  const { balances, isLoading: balancesLoading } = useTokenBalances();
  const { toast, showToast, dismissToast } = useTransactionToast();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [isSendingHeartbeat, setIsSendingHeartbeat] = useState(false);
  const [heartbeatCooldown, setHeartbeatCooldown] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const isOwner = vault && publicKey && vault.owner === publicKey.toBase58();
  const isModifiable = vault?.displayStatus === "active" || vault?.displayStatus === "warning";

  // -------------------------------------------------------------------------
  // Heartbeat action
  // -------------------------------------------------------------------------

  const handleSendHeartbeat = useCallback(async () => {
    if (!publicKey || !connected || !vault || isSendingHeartbeat || heartbeatCooldown) return;

    setIsSendingHeartbeat(true);
    showToast("pending", "Sending heartbeat... Please approve in your wallet.");

    try {
      const vaultPubkey = new PublicKey(vault.pubkey);
      const tx = await buildRecordHeartbeatTx(vaultPubkey, publicKey);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      // Simulate first to catch errors without spending gas
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const simError = JSON.stringify(simulation.value.err);
        throw new Error(`Transaction simulation failed: ${simError}`);
      }

      const signature = await sendTransaction(tx, connection);
      showToast("pending", "Heartbeat sent. Waiting for confirmation...", signature);

      await connection.confirmTransaction(signature, "confirmed");
      showToast("confirmed", "Heartbeat recorded successfully!", signature);

      // Sync heartbeat to DB (non-blocking)
      syncVaultToDb({
        vaultPubkey: vault.pubkey,
        activityType: "manual",
        txSignature: signature,
        description: "Manual heartbeat confirmed by vault owner",
      });

      // Set 30-second cooldown to prevent spam
      setHeartbeatCooldown(true);
      setTimeout(() => setHeartbeatCooldown(false), 30_000);

      mutate();
    } catch (err) {
      console.error("Heartbeat failed:", err);
      showToast("error", parseAnchorError(err));
    } finally {
      setIsSendingHeartbeat(false);
    }
  }, [publicKey, connected, vault, isSendingHeartbeat, heartbeatCooldown, connection, sendTransaction, showToast, mutate]);

  // -------------------------------------------------------------------------
  // Cancel vault action
  // -------------------------------------------------------------------------

  const handleCancelVault = useCallback(async () => {
    if (!publicKey || !connected || !vault || isCancelling) return;

    setIsCancelling(true);
    showToast("pending", "Cancelling vault... Please approve in your wallet.");

    try {
      const vaultPubkey = new PublicKey(vault.pubkey);
      const assetMints = vault.assets
        .map((a) => new PublicKey(a.mint))
        .filter((m) => !m.equals(PublicKey.default));

      const tx = await buildCancelVaultTx(vaultPubkey, publicKey, assetMints);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      // Simulate first to catch errors without spending gas
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const simError = JSON.stringify(simulation.value.err);
        throw new Error(`Transaction simulation failed: ${simError}`);
      }

      const signature = await sendTransaction(tx, connection);
      showToast("pending", "Cancel transaction sent. Waiting for confirmation...", signature);

      await connection.confirmTransaction(signature, "confirmed");
      showToast("confirmed", "Vault cancelled. Assets returned to your wallet.", signature);

      // Sync cancellation to DB (non-blocking)
      syncVaultToDb({
        vaultPubkey: vault.pubkey,
        activityType: "cancellation",
        txSignature: signature,
        description: "Vault cancelled by owner — assets returned",
      });

      setShowCancelModal(false);
      mutate();
    } catch (err) {
      console.error("Cancel failed:", err);
      showToast("error", parseAnchorError(err));
    } finally {
      setIsCancelling(false);
    }
  }, [publicKey, connected, vault, isCancelling, connection, sendTransaction, showToast, mutate]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-white/10" />
          <div className="h-40 rounded-xl bg-white/5" />
          <div className="h-60 rounded-xl bg-white/5" />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error || !vault) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-red-400 mb-4" aria-hidden="true" />
        <h1 className="text-xl font-bold text-white">Vault Not Found</h1>
        <p className="mt-2 text-gray-400">
          {error?.message || "This vault could not be loaded. It may not exist or the network may be unavailable."}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => mutate()}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            Retry
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Solana Explorer link
  // -------------------------------------------------------------------------

  const explorerCluster = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const accountExplorerUrl = `https://explorer.solana.com/address/${vault.pubkey}${explorerCluster === "mainnet-beta" ? "" : `?cluster=${explorerCluster}`}`;

  // -------------------------------------------------------------------------
  // Tab contents
  // -------------------------------------------------------------------------

  const tabs: Array<{ id: TabId; label: string; icon: typeof Eye }> = [
    { id: "overview", label: "Overview", icon: Eye },
    { id: "activity", label: "Activity", icon: Activity },
    ...(isOwner ? [{ id: "settings" as TabId, label: "Settings", icon: Settings }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back nav + header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white truncate">{vault.name}</h1>
            <StatusBadge status={vault.displayStatus as VaultDisplayStatus} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
            <span className="font-mono">{truncateAddress(vault.pubkey, 6)}</span>
            <a
              href={accountExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-[#00ff88] transition-colors"
              aria-label="View on Solana Explorer"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-white/10 mb-6 overflow-x-auto scrollbar-none">
        <nav className="flex gap-6 min-w-max" aria-label="Vault sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors focus-visible:outline-none",
                  activeTab === tab.id
                    ? "border-[#00ff88] text-[#00ff88]"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                )}
                aria-selected={activeTab === tab.id}
                role="tab"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Status + Progress */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center justify-between mb-4">
              <StatusBadge status={vault.displayStatus as VaultDisplayStatus} size="lg" />
              {isOwner && isModifiable && (
                <button
                  type="button"
                  onClick={handleSendHeartbeat}
                  disabled={isSendingHeartbeat || heartbeatCooldown}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
                >
                  {isSendingHeartbeat ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Sending...
                    </>
                  ) : heartbeatCooldown ? (
                    <>
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      Cooldown...
                    </>
                  ) : (
                    <>
                      <Heart className="h-4 w-4" aria-hidden="true" />
                      Send Heartbeat
                    </>
                  )}
                </button>
              )}
            </div>

            <ProgressBar
              percent={vault.progressPercent}
              showLabel
              ariaLabel={`Inactivity progress: ${Math.round(vault.progressPercent)}%`}
            />

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Last Activity
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {formatDate(vault.lastActivityTimestamp)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Days Remaining</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {vault.daysRemaining > 0 ? `${vault.daysRemaining} days` : "Overdue"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Trigger Date</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {formatDate(
                    vault.lastActivityTimestamp +
                      vault.inactivityWindowDays * 86_400
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Grace End</p>
                <p className="mt-1 text-sm font-medium text-white">
                  {formatDate(
                    vault.lastActivityTimestamp +
                      vault.inactivityWindowDays * 86_400 +
                      vault.gracePeriodDays * 86_400
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Note */}
          {vault.note && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Note to Beneficiaries
              </h3>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{vault.note}</p>
            </div>
          )}

          {/* Assets table */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5" aria-hidden="true" />
              Assets
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Vault assets">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Token</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">Amount</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">USD Value</th>
                  </tr>
                </thead>
                <tbody>
                  {vault.assets.map((asset, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2.5 text-white font-medium">{asset.symbol}</td>
                      <td className="py-2.5 text-right text-gray-300">
                        {asset.uiAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                      </td>
                      <td className="py-2.5 text-right text-gray-400">
                        {formatUsd(asset.valueUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/10">
                    <td className="pt-2.5 text-gray-500">Total</td>
                    <td />
                    <td className="pt-2.5 text-right font-semibold text-white">
                      {formatUsd(vault.totalValueUsd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Beneficiaries table */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Beneficiaries
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Vault beneficiaries">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Name</th>
                    <th className="pb-2 text-left text-xs font-medium text-gray-500">Wallet</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">Share</th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">Est. USD</th>
                  </tr>
                </thead>
                <tbody>
                  {vault.beneficiaries.map((b, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2.5 text-white font-medium">{b.name}</td>
                      <td className="py-2.5 text-gray-400 font-mono text-xs">
                        {truncateAddress(b.wallet, 6)}
                      </td>
                      <td className="py-2.5 text-right text-[#00ff88]">
                        {(b.shareBps / 100).toFixed(2)}%
                      </td>
                      <td className="py-2.5 text-right text-gray-400">
                        {formatUsd(b.estimatedUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== ACTIVITY TAB ===== */}
      {activeTab === "activity" && (
        <div className="space-y-6">
          {/* Heartbeat button */}
          {isOwner && isModifiable && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSendHeartbeat}
                disabled={isSendingHeartbeat || heartbeatCooldown}
                className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
              >
                {isSendingHeartbeat ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending...
                  </>
                ) : heartbeatCooldown ? (
                  <>
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    Cooldown...
                  </>
                ) : (
                  <>
                    <Heart className="h-4 w-4" aria-hidden="true" />
                    Send Manual Heartbeat
                  </>
                )}
              </button>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
            <ActivityLog
              entries={vault.activityLog}
              isLoading={false}
            />
          </div>
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {activeTab === "settings" && isOwner && (
        <VaultSettings
          vault={vault}
          publicKey={publicKey!}
          connection={connection}
          sendTransaction={sendTransaction}
          showToast={showToast}
          mutate={mutate}
          balances={balances}
          balancesLoading={balancesLoading}
          prices={prices}
          onCancelClick={() => setShowCancelModal(true)}
        />
      )}

      {/* Cancel confirmation modal */}
      <ConfirmModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancelVault}
        title="Cancel Vault"
        description="This will permanently cancel your vault and return all deposited assets to your wallet. This action cannot be undone. Are you sure you want to proceed?"
        confirmText="Yes, Cancel Vault"
        isLoading={isCancelling}
        variant="danger"
      />

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

// ===========================================================================
// Settings sub-component (separated for readability)
// ===========================================================================

interface VaultSettingsProps {
  vault: NonNullable<ReturnType<typeof useVaultDetail>["vault"]>;
  publicKey: PublicKey;
  connection: ReturnType<typeof useConnection>["connection"];
  sendTransaction: ReturnType<typeof useWallet>["sendTransaction"];
  showToast: ReturnType<typeof useTransactionToast>["showToast"];
  mutate: () => void;
  balances: ReturnType<typeof useTokenBalances>["balances"];
  balancesLoading: boolean;
  prices: Record<string, number>;
  onCancelClick: () => void;
}

function VaultSettings({
  vault,
  publicKey,
  connection,
  sendTransaction,
  showToast,
  mutate,
  balances,
  balancesLoading,
  prices,
  onCancelClick,
}: VaultSettingsProps) {
  const isModifiable = vault.displayStatus === "active" || vault.displayStatus === "warning";
  const [isUpdating, setIsUpdating] = useState(false);

  // Editable fields
  const [editName, setEditName] = useState(vault.name);
  const [editNote, setEditNote] = useState(vault.note);
  const [editInactivityDays, setEditInactivityDays] = useState(vault.inactivityWindowDays);
  const [editGraceDays, setEditGraceDays] = useState(vault.gracePeriodDays);
  const [editCrankFee, setEditCrankFee] = useState(vault.crankFeeBps);

  // Beneficiary editing state (FIX 3)
  const [editBeneficiaries, setEditBeneficiaries] = useState<BeneficiaryEntry[]>(
    vault.beneficiaries.map((b) => ({
      name: b.name,
      wallet: b.wallet,
      shareBps: b.shareBps,
    }))
  );

  /** Check if beneficiaries have changed from the vault's current values */
  const hasBeneficiaryChanges = (() => {
    if (editBeneficiaries.length !== vault.beneficiaries.length) return true;
    return editBeneficiaries.some((eb, i) => {
      const vb = vault.beneficiaries[i];
      return eb.name !== vb.name || eb.wallet !== vb.wallet || eb.shareBps !== vb.shareBps;
    });
  })();

  /** Validate beneficiaries: shares total 10000, at least 1, valid wallets */
  const beneficiariesValid = (() => {
    if (editBeneficiaries.length < 1 || editBeneficiaries.length > 10) return false;
    const totalBps = editBeneficiaries.reduce((s, b) => s + b.shareBps, 0);
    if (totalBps !== 10_000) return false;
    const ownerWallet = publicKey.toBase58();
    const wallets = new Set<string>();
    for (const b of editBeneficiaries) {
      if (!b.name.trim() || b.name.length > 32) return false;
      if (!isValidSolanaAddress(b.wallet)) return false;
      if (b.wallet === ownerWallet) return false;
      if (wallets.has(b.wallet)) return false;
      wallets.add(b.wallet);
      if (b.shareBps < 1 || b.shareBps > 9999) return false;
    }
    return true;
  })();

  // Alert notification state (FIX 2)
  const [alertEmail, setAlertEmail] = useState("");
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertSaved, setAlertSaved] = useState(false);

  // Top-up deposits - use SDK token mints
  const topUpNetwork = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet") || "devnet";
  const [topUpDeposits, setTopUpDeposits] = useState<AssetDeposit[]>([
    { mint: NATIVE_SOL_MINT.toBase58(), symbol: "SOL", amount: "", decimals: 9 },
    { mint: TOKEN_MINTS[topUpNetwork].USDC.toBase58(), symbol: "USDC", amount: "", decimals: 6 },
    { mint: TOKEN_MINTS[topUpNetwork].USDT.toBase58(), symbol: "USDT", amount: "", decimals: 6 },
  ]);

  const hasNameChanges = editName !== vault.name || editNote !== vault.note;
  const hasTimingChanges =
    editInactivityDays !== vault.inactivityWindowDays ||
    editGraceDays !== vault.gracePeriodDays ||
    editCrankFee !== vault.crankFeeBps;

  const timingValid =
    editInactivityDays >= 30 &&
    editInactivityDays <= 365 &&
    editGraceDays >= 1 &&
    editGraceDays <= 30 &&
    editCrankFee >= 1 &&
    editCrankFee <= 500;

  /** Email validation regex */
  const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  /** Save alert settings to the API */
  const handleSaveAlerts = useCallback(async () => {
    if (alertLoading) return;
    if (alertEmail && !isValidEmail(alertEmail)) {
      showToast("error", "Please enter a valid email address.");
      return;
    }

    setAlertLoading(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultPublicKey: vault.pubkey,
          ownerPubkey: publicKey.toBase58(),
          email: alertEmail || null,
          enabled: alertEnabled,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errBody.error || `Request failed: ${res.status}`);
      }

      setAlertSaved(true);
      showToast("confirmed", "Alert settings saved.");
      setTimeout(() => setAlertSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save alert settings:", err);
      showToast("error", err instanceof Error ? err.message : "Failed to save alert settings.");
    } finally {
      setAlertLoading(false);
    }
  }, [alertLoading, alertEmail, alertEnabled, vault.pubkey, publicKey, showToast]);

  const handleUpdateVault = useCallback(
    async (updates: UpdateVaultParams) => {
      if (!publicKey || isUpdating) return;

      setIsUpdating(true);
      showToast("pending", "Updating vault... Please approve in your wallet.");

      try {
        const vaultPubkey = new PublicKey(vault.pubkey);
        const tx = await buildUpdateVaultTx(vaultPubkey, publicKey, updates);
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = publicKey;

        // Simulate first to catch errors without spending gas
        const simulation = await connection.simulateTransaction(tx);
        if (simulation.value.err) {
          const simError = JSON.stringify(simulation.value.err);
          throw new Error(`Transaction simulation failed: ${simError}`);
        }

        const signature = await sendTransaction(tx, connection);
        showToast("pending", "Update sent. Waiting for confirmation...", signature);

        await connection.confirmTransaction(signature, "confirmed");
        showToast("confirmed", "Vault updated successfully!", signature);

        // Sync update to DB (non-blocking)
        syncVaultToDb({
          vaultPubkey: vault.pubkey,
          activityType: "update",
          txSignature: signature,
          description: "Vault settings updated by owner",
        });

        mutate();
      } catch (err) {
        console.error("Update failed:", err);
        showToast("error", parseAnchorError(err));
      } finally {
        setIsUpdating(false);
      }
    },
    [publicKey, isUpdating, vault.pubkey, connection, sendTransaction, showToast, mutate]
  );

  const handleTopUp = useCallback(async () => {
    if (!publicKey || isUpdating) return;

    const hasDeposit = topUpDeposits.some((d) => parseFloat(d.amount) > 0);
    if (!hasDeposit) return;

    setIsUpdating(true);
    showToast("pending", "Depositing assets... Please approve in your wallet.");

    try {
      const vaultPubkey = new PublicKey(vault.pubkey);
      const solDeposit = topUpDeposits.find((d) => d.symbol === "SOL");
      const solAmount = new BN(decimalToSmallestUnit(solDeposit?.amount || "0", 9));

      const splDeposits = topUpDeposits
        .filter((d) => d.symbol !== "SOL" && parseFloat(d.amount) > 0)
        .map((d) => ({
          mint: new PublicKey(d.mint),
          amount: new BN(decimalToSmallestUnit(d.amount, d.decimals)),
        }));

      const tx = await buildTopUpVaultTx(vaultPubkey, publicKey, solAmount, splDeposits);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = publicKey;

      // Simulate first to catch errors without spending gas
      const simulation = await connection.simulateTransaction(tx);
      if (simulation.value.err) {
        const simError = JSON.stringify(simulation.value.err);
        throw new Error(`Transaction simulation failed: ${simError}`);
      }

      const signature = await sendTransaction(tx, connection);
      showToast("pending", "Deposit sent. Waiting for confirmation...", signature);

      await connection.confirmTransaction(signature, "confirmed");
      showToast("confirmed", "Assets deposited successfully!", signature);

      // Sync top-up to DB (non-blocking)
      syncVaultToDb({
        vaultPubkey: vault.pubkey,
        activityType: "top_up",
        txSignature: signature,
        description: "Assets deposited into vault",
      });

      // Reset deposit inputs
      setTopUpDeposits((prev) => prev.map((d) => ({ ...d, amount: "" })));
      mutate();
    } catch (err) {
      console.error("Top-up failed:", err);
      showToast("error", parseAnchorError(err));
    } finally {
      setIsUpdating(false);
    }
  }, [publicKey, isUpdating, vault.pubkey, topUpDeposits, connection, sendTransaction, showToast, mutate]);

  if (!isModifiable) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
        <Settings className="mx-auto h-10 w-10 text-gray-600 mb-3" aria-hidden="true" />
        <p className="text-gray-400">
          This vault is {vault.displayStatus} and can no longer be modified.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Name & Note */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Vault Info</h3>

        <div>
          <label htmlFor="edit-name" className="block text-xs text-gray-500 mb-1">
            Name
          </label>
          <input
            id="edit-name"
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value.slice(0, 64))}
            maxLength={64}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50"
          />
          <p className="mt-0.5 text-right text-[10px] text-gray-600">{editName.length}/64</p>
        </div>

        <div>
          <label htmlFor="edit-note" className="block text-xs text-gray-500 mb-1">
            Note
          </label>
          <textarea
            id="edit-note"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value.slice(0, 256))}
            maxLength={256}
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50 resize-none"
          />
          <p className="mt-0.5 text-right text-[10px] text-gray-600">{editNote.length}/256</p>
        </div>

        {hasNameChanges && (
          <button
            type="button"
            onClick={() =>
              handleUpdateVault({
                name: editName.trim(),
                note: editNote.trim(),
              })
            }
            disabled={isUpdating || !editName.trim()}
            className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            {isUpdating ? "Saving..." : "Save Changes"}
          </button>
        )}
      </div>

      {/* Beneficiaries (FIX 3) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Beneficiaries</h3>
        <p className="text-xs text-gray-400">
          Update who receives your assets and their share percentages. Shares must total exactly 100%.
        </p>

        <BeneficiaryForm
          beneficiaries={editBeneficiaries}
          onChange={setEditBeneficiaries}
          ownerWallet={publicKey.toBase58()}
        />

        {hasBeneficiaryChanges && beneficiariesValid && (
          <button
            type="button"
            onClick={() =>
              handleUpdateVault({
                beneficiaries: editBeneficiaries.map((b) => ({
                  wallet: new PublicKey(b.wallet),
                  shareBps: b.shareBps,
                  name: b.name,
                })),
              })
            }
            disabled={isUpdating}
            className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            {isUpdating ? "Updating..." : "Update Beneficiaries"}
          </button>
        )}

        {hasBeneficiaryChanges && !beneficiariesValid && (
          <p className="text-xs text-red-400">
            Please ensure all fields are valid, shares total 100%, and no wallet duplicates or self-assignment.
          </p>
        )}
      </div>

      {/* Timing settings */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-6">
        <h3 className="text-sm font-semibold text-white">Timing Settings</h3>

        <TimingSelector
          label="Inactivity Window"
          presets={TIMING_PRESETS}
          value={editInactivityDays}
          onChange={setEditInactivityDays}
          min={30}
          max={365}
        />

        <TimingSelector
          label="Grace Period"
          presets={GRACE_PRESETS}
          value={editGraceDays}
          onChange={setEditGraceDays}
          min={1}
          max={30}
        />

        <CrankFeeSelector value={editCrankFee} onChange={setEditCrankFee} />

        {hasTimingChanges && timingValid && (
          <button
            type="button"
            onClick={() =>
              handleUpdateVault({
                inactivityWindow: new BN(editInactivityDays * 86_400),
                gracePeriod: new BN(editGraceDays * 86_400),
                crankFeeBps: editCrankFee,
              })
            }
            disabled={isUpdating}
            className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            {isUpdating ? "Saving..." : "Update Timing"}
          </button>
        )}
      </div>

      {/* Top up assets */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Deposit More Assets</h3>

        <AssetSelector
          balances={balances}
          deposits={topUpDeposits}
          onChange={setTopUpDeposits}
          prices={prices}
          isLoading={balancesLoading}
        />

        {topUpDeposits.some((d) => parseFloat(d.amount) > 0) && (
          <button
            type="button"
            onClick={handleTopUp}
            disabled={isUpdating}
            className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
          >
            {isUpdating ? "Depositing..." : "Deposit Assets"}
          </button>
        )}
      </div>

      {/* Alert Notifications (FIX 2) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Alert Notifications</h3>
        <p className="text-xs text-gray-400">
          Get email alerts when your vault approaches its inactivity threshold.
        </p>

        <div>
          <label htmlFor="alert-email" className="block text-xs text-gray-500 mb-1">
            Email Address
          </label>
          <input
            id="alert-email"
            type="email"
            value={alertEmail}
            onChange={(e) => {
              setAlertEmail(e.target.value);
              setAlertSaved(false);
            }}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50"
          />
          {alertEmail && !isValidEmail(alertEmail) && (
            <p className="mt-1 text-xs text-red-400">Please enter a valid email address.</p>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={alertEnabled}
            onChange={(e) => {
              setAlertEnabled(e.target.checked);
              setAlertSaved(false);
            }}
            className="h-4 w-4 rounded border-white/20 bg-white/5 text-[#00ff88] focus:ring-[#00ff88]/50 focus:ring-offset-0"
          />
          <span className="text-sm text-gray-400">Enable email alerts</span>
        </label>

        <button
          type="button"
          onClick={handleSaveAlerts}
          disabled={alertLoading || (alertEmail !== "" && !isValidEmail(alertEmail))}
          className="rounded-lg bg-[#00ff88] px-4 py-2 text-sm font-semibold text-black hover:bg-[#00ff88]/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
        >
          {alertLoading ? "Saving..." : alertSaved ? "Saved!" : "Save Alert Settings"}
        </button>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-red-400">Danger Zone</h3>
        <p className="text-xs text-gray-400">
          Cancelling your vault will return all deposited assets to your wallet.
          This action is permanent and cannot be undone.
        </p>
        <button
          type="button"
          onClick={onCancelClick}
          className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Cancel Vault
        </button>
      </div>
    </div>
  );
}
