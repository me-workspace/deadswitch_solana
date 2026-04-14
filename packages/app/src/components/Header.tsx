"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

export function Header() {
  const { connected } = useWallet();

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00ff88]/10 text-[#00ff88] font-bold text-sm">
              DS
            </div>
            <span className="text-lg font-semibold text-white">
              Deadswitch
            </span>
          </Link>

          {connected && (
            <nav className="hidden sm:flex items-center gap-6">
              <Link
                href="/dashboard"
                className="text-sm text-gray-400 transition-colors hover:text-white"
              >
                Dashboard
              </Link>
              <Link
                href="/create"
                className="text-sm text-gray-400 transition-colors hover:text-white"
              >
                Create Vault
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex items-center rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs font-medium text-yellow-400 ring-1 ring-inset ring-yellow-500/20">
            Devnet
          </span>
          <WalletMultiButton
            style={{
              backgroundColor: "rgba(0, 255, 136, 0.1)",
              border: "1px solid rgba(0, 255, 136, 0.3)",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              height: "2.5rem",
            }}
          />
        </div>
      </div>
    </header>
  );
}
