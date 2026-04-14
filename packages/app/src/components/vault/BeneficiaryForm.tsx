"use client";

import { useCallback } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import { cn, isValidSolanaAddress } from "@/lib/utils";

/** Single beneficiary entry in the form */
export interface BeneficiaryEntry {
  name: string;
  wallet: string;
  shareBps: number;
}

interface BeneficiaryFormProps {
  /** Current list of beneficiaries */
  beneficiaries: BeneficiaryEntry[];
  /** Callback to update the full beneficiary list */
  onChange: (beneficiaries: BeneficiaryEntry[]) => void;
  /** Connected wallet address (to prevent self-as-beneficiary) */
  ownerWallet: string;
  /** Validation errors per index */
  errors?: Record<number, string[]>;
}

/**
 * Dynamic add/remove beneficiary rows.
 * Validates: names, wallet addresses, share percentages.
 * Enforces min 1, max 10 beneficiaries, total shares = 100%.
 */
export function BeneficiaryForm({
  beneficiaries,
  onChange,
  ownerWallet,
  errors = {},
}: BeneficiaryFormProps) {
  const totalShareBps = beneficiaries.reduce((sum, b) => sum + b.shareBps, 0);
  const totalPercent = totalShareBps / 100;
  const isSharesValid = totalShareBps === 10_000;

  const addBeneficiary = useCallback(() => {
    if (beneficiaries.length >= 10) return;
    onChange([...beneficiaries, { name: "", wallet: "", shareBps: 0 }]);
  }, [beneficiaries, onChange]);

  const removeBeneficiary = useCallback(
    (index: number) => {
      if (beneficiaries.length <= 1) return;
      onChange(beneficiaries.filter((_, i) => i !== index));
    },
    [beneficiaries, onChange]
  );

  const updateBeneficiary = useCallback(
    (index: number, field: keyof BeneficiaryEntry, value: string | number) => {
      const updated = beneficiaries.map((b, i) => {
        if (i !== index) return b;
        return { ...b, [field]: value };
      });
      onChange(updated);
    },
    [beneficiaries, onChange]
  );

  const distributeEvenly = useCallback(() => {
    const count = beneficiaries.length;
    if (count === 0) return;
    const baseShare = Math.floor(10_000 / count);
    const remainder = 10_000 - baseShare * count;
    const updated = beneficiaries.map((b, i) => ({
      ...b,
      shareBps: baseShare + (i < remainder ? 1 : 0),
    }));
    onChange(updated);
  }, [beneficiaries, onChange]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Beneficiaries</h3>
          <p className="text-xs text-gray-500">
            {beneficiaries.length}/10 beneficiaries
          </p>
        </div>
        <button
          type="button"
          onClick={distributeEvenly}
          className="text-xs text-[#00ff88] hover:text-[#00ff88]/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88] rounded px-2 py-1"
          disabled={beneficiaries.length === 0}
        >
          Distribute Evenly
        </button>
      </div>

      {/* Beneficiary rows */}
      <div className="space-y-3">
        {beneficiaries.map((b, index) => {
          const rowErrors = errors[index] ?? [];
          const isSelf =
            b.wallet && ownerWallet && b.wallet === ownerWallet;
          const isDuplicate =
            b.wallet &&
            beneficiaries.some(
              (other, i) => i !== index && other.wallet === b.wallet && b.wallet !== ""
            );
          const isInvalidWallet =
            b.wallet.length > 0 && !isValidSolanaAddress(b.wallet);

          return (
            <div
              key={index}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="flex items-start gap-3">
                {/* Name */}
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`ben-name-${index}`}
                    className="block text-xs text-gray-500 mb-1"
                  >
                    Name
                  </label>
                  <input
                    id={`ben-name-${index}`}
                    type="text"
                    value={b.name}
                    onChange={(e) =>
                      updateBeneficiary(index, "name", e.target.value.slice(0, 32))
                    }
                    placeholder="e.g. Alice"
                    maxLength={32}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50"
                    aria-label={`Beneficiary ${index + 1} name`}
                  />
                  <p className="mt-0.5 text-right text-[10px] text-gray-600">
                    {b.name.length}/32
                  </p>
                </div>

                {/* Share */}
                <div className="w-24 shrink-0">
                  <label
                    htmlFor={`ben-share-${index}`}
                    className="block text-xs text-gray-500 mb-1"
                  >
                    Share %
                  </label>
                  <input
                    id={`ben-share-${index}`}
                    type="number"
                    value={b.shareBps > 0 ? (b.shareBps / 100).toString() : ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (Number.isNaN(val)) {
                        updateBeneficiary(index, "shareBps", 0);
                      } else {
                        updateBeneficiary(
                          index,
                          "shareBps",
                          Math.round(Math.min(Math.max(val, 0), 100) * 100)
                        );
                      }
                    }}
                    placeholder="0"
                    min={0}
                    max={100}
                    step={0.01}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-[#00ff88]/50 focus:outline-none focus:ring-1 focus:ring-[#00ff88]/50"
                    aria-label={`Beneficiary ${index + 1} share percentage`}
                  />
                </div>

                {/* Remove button */}
                <div className="shrink-0 pt-5">
                  <button
                    type="button"
                    onClick={() => removeBeneficiary(index)}
                    disabled={beneficiaries.length <= 1}
                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    aria-label={`Remove beneficiary ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Wallet address - full width below */}
              <div className="mt-2">
                <label
                  htmlFor={`ben-wallet-${index}`}
                  className="block text-xs text-gray-500 mb-1"
                >
                  Wallet Address
                </label>
                <input
                  id={`ben-wallet-${index}`}
                  type="text"
                  value={b.wallet}
                  onChange={(e) =>
                    updateBeneficiary(index, "wallet", e.target.value.trim())
                  }
                  placeholder="Solana wallet address (base58)"
                  className={cn(
                    "w-full rounded-lg border bg-white/5 px-3 py-2 text-sm font-mono text-white placeholder:text-gray-600 focus:outline-none focus:ring-1",
                    isSelf || isDuplicate || isInvalidWallet
                      ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50"
                      : "border-white/10 focus:border-[#00ff88]/50 focus:ring-[#00ff88]/50"
                  )}
                  aria-label={`Beneficiary ${index + 1} wallet address`}
                  aria-invalid={!!(isSelf || isDuplicate || isInvalidWallet)}
                />
                {isSelf && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Cannot use your own wallet as beneficiary
                  </p>
                )}
                {isDuplicate && !isSelf && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Duplicate wallet address
                  </p>
                )}
                {isInvalidWallet && !isSelf && !isDuplicate && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" />
                    Invalid Solana address
                  </p>
                )}
              </div>

              {/* Row-level errors */}
              {rowErrors.map((err, ei) => (
                <p
                  key={ei}
                  className="mt-1 flex items-center gap-1 text-xs text-red-400"
                >
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  {err}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {/* Add beneficiary button */}
      <button
        type="button"
        onClick={addBeneficiary}
        disabled={beneficiaries.length >= 10}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 py-3 text-sm text-gray-400 transition-colors hover:border-[#00ff88]/30 hover:text-[#00ff88] disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add Beneficiary
      </button>

      {/* Total share indicator */}
      <div
        className={cn(
          "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
          isSharesValid
            ? "bg-[#00ff88]/5 text-[#00ff88]"
            : "bg-red-500/5 text-red-400"
        )}
        role="status"
        aria-label={`Total shares: ${totalPercent}%`}
      >
        <span>Total Shares</span>
        <span className="font-semibold">
          {totalPercent.toFixed(2)}%
          {!isSharesValid && " (must equal 100%)"}
        </span>
      </div>
    </div>
  );
}
