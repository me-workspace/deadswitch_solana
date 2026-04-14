"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, Info } from "lucide-react";

interface TimingPreset {
  days: number;
  label: string;
  description?: string;
  recommended?: boolean;
}

interface TimingSelectorProps {
  /** Label for the selector */
  label: string;
  /** Help text shown below label */
  helpText?: string;
  /** Available presets */
  presets: readonly TimingPreset[];
  /** Currently selected value in days */
  value: number;
  /** Callback when value changes */
  onChange: (days: number) => void;
  /** Minimum allowed value in days */
  min: number;
  /** Maximum allowed value in days */
  max: number;
  /** Unit label (default: "days") */
  unit?: string;
}

/**
 * Preset + custom timing input component.
 * Shows preset buttons and a custom input field.
 * Validates min/max bounds.
 */
export function TimingSelector({
  label,
  helpText,
  presets,
  value,
  onChange,
  min,
  max,
  unit = "days",
}: TimingSelectorProps) {
  const isCustom = !presets.some((p) => p.days === value);
  const isOutOfRange = value < min || value > max;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-white">{label}</label>
        {helpText && (
          <p className="mt-0.5 text-xs text-gray-500">{helpText}</p>
        )}
      </div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.days}
            type="button"
            onClick={() => onChange(preset.days)}
            className={cn(
              "relative rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]",
              value === preset.days
                ? "border-[#00ff88] bg-[#00ff88]/10 text-[#00ff88]"
                : "border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-white"
            )}
            aria-pressed={value === preset.days}
          >
            {preset.label}
            {preset.recommended && (
              <span className="ml-1 text-[10px] text-[#00ff88]/60">
                (rec.)
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Custom input */}
      <div className="flex items-center gap-2">
        <label htmlFor={`timing-${label}`} className="text-xs text-gray-500 shrink-0">
          Custom:
        </label>
        <input
          id={`timing-${label}`}
          type="number"
          value={value || ""}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) {
              onChange(v);
            } else if (e.target.value === "") {
              onChange(0);
            }
          }}
          min={min}
          max={max}
          className={cn(
            "w-24 rounded-lg border bg-white/5 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1",
            isOutOfRange && value > 0
              ? "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/50"
              : "border-white/10 focus:border-[#00ff88]/50 focus:ring-[#00ff88]/50"
          )}
          aria-label={`Custom ${label.toLowerCase()} in ${unit}`}
          aria-invalid={isOutOfRange && value > 0}
        />
        <span className="text-xs text-gray-500">{unit}</span>
      </div>

      {/* Validation error */}
      {isOutOfRange && value > 0 && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          Must be between {min} and {max} {unit}
        </p>
      )}

      {/* Selected preset description */}
      {presets.find((p) => p.days === value)?.description && (
        <p className="flex items-center gap-1 text-xs text-gray-500">
          <Info className="h-3 w-3" aria-hidden="true" />
          {presets.find((p) => p.days === value)?.description}
        </p>
      )}
    </div>
  );
}

interface CrankFeeSelectorProps {
  /** Current crank fee in basis points */
  value: number;
  /** Callback when value changes */
  onChange: (bps: number) => void;
}

/**
 * Crank fee selector with slider and presets.
 * Range: 1-500 bps (0.01% - 5%).
 */
export function CrankFeeSelector({ value, onChange }: CrankFeeSelectorProps) {
  const percentValue = value / 100;
  const isOutOfRange = value < 1 || value > 500;

  const presets = [
    { bps: 1, label: "0.01%" },
    { bps: 10, label: "0.1%" },
    { bps: 50, label: "0.5%" },
    { bps: 100, label: "1%" },
    { bps: 250, label: "2.5%" },
    { bps: 500, label: "5%" },
  ];

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-white">
          Crank Fee
        </label>
        <p className="mt-0.5 text-xs text-gray-500">
          Fee paid to the executor who triggers redistribution
        </p>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.bps}
            type="button"
            onClick={() => onChange(preset.bps)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ff88]",
              value === preset.bps
                ? "border-[#00ff88] bg-[#00ff88]/10 text-[#00ff88]"
                : "border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20 hover:text-white"
            )}
            aria-pressed={value === preset.bps}
          >
            {preset.label}
            {preset.bps === 10 && (
              <span className="ml-1 text-[10px] text-[#00ff88]/60">(default)</span>
            )}
          </button>
        ))}
      </div>

      {/* Slider */}
      <div className="space-y-1">
        <input
          type="range"
          min={1}
          max={500}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full accent-[#00ff88]"
          aria-label="Crank fee slider"
        />
        <div className="flex justify-between text-[10px] text-gray-600">
          <span>0.01%</span>
          <span className="font-medium text-white">{percentValue.toFixed(2)}%</span>
          <span>5%</span>
        </div>
      </div>

      {isOutOfRange && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          Fee must be between 0.01% and 5%
        </p>
      )}
    </div>
  );
}
