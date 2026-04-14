"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import {
  Shield,
  Clock,
  Users,
  ArrowRight,
  ChevronDown,
  Lock,
  Eye,
  Code,
  Zap,
} from "lucide-react";
import { useState } from "react";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

export default function LandingPage() {
  const { connected } = useWallet();

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden py-24 sm:py-32">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-[500px] w-[500px] rounded-full bg-[#00ff88]/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl px-4 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#00ff88]/10 px-4 py-1.5 text-sm text-[#00ff88] ring-1 ring-inset ring-[#00ff88]/20">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00ff88] animate-pulse" />
            Live on Solana Devnet
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Your Crypto Shouldn&apos;t
            <br />
            <span className="text-[#00ff88]">Die With You</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400 sm:text-xl">
            Non-custodial onchain inheritance protocol on Solana. Automatically
            distribute your crypto to loved ones if your wallet goes inactive.
            No seed phrases to share. No trusted third parties.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {connected ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-[#00ff88] px-6 py-3 text-sm font-semibold text-black transition-all hover:bg-[#00ff88]/90 hover:shadow-lg hover:shadow-[#00ff88]/25"
              >
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
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
            )}
            <a
              href="https://github.com/me-workspace/deadswitch_solana"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:border-white/20 hover:text-white"
            >
              <Code className="h-4 w-4" />
              View Source
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 px-4 py-8 sm:grid-cols-4">
          {[
            { label: "Lost Crypto (est.)", value: "$140B+" },
            { label: "Solana Competitors", value: "Zero" },
            { label: "Protocol Fee", value: "0%" },
            { label: "Beneficiary Effort", value: "None" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-bold text-[#00ff88]">
                {stat.value}
              </div>
              <div className="mt-1 text-sm text-gray-500">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Three steps to protect your crypto legacy. Set it once, forget it.
          </p>

          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            {[
              {
                icon: Shield,
                step: "1",
                title: "Create a Vault",
                description:
                  "Connect your wallet, choose beneficiaries, deposit assets, and set your inactivity window.",
              },
              {
                icon: Clock,
                step: "2",
                title: "Live Your Life",
                description:
                  "Any normal wallet activity (swaps, transfers, staking) automatically resets the timer. No check-ins needed.",
              },
              {
                icon: Users,
                step: "3",
                title: "Protected",
                description:
                  "If your wallet goes inactive beyond the threshold, assets are automatically redistributed to your beneficiaries.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="group relative rounded-xl border border-white/10 bg-white/[0.02] p-6 transition-all hover:border-[#00ff88]/30 hover:bg-[#00ff88]/[0.02]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#00ff88]/10 text-[#00ff88]">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium text-gray-500">
                    Step {item.step}
                  </span>
                </div>
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-y border-white/10 bg-white/[0.02] py-20">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Why Deadswitch?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-gray-400">
            Compare with existing approaches to crypto inheritance.
          </p>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-left font-medium text-gray-400">
                    Feature
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-[#00ff88]">
                    Deadswitch
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-400">
                    Seed Phrase
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-400">
                    Multisig
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-400">
                    Sarcophagus
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["Non-custodial", "yes", "yes", "yes", "yes"],
                  ["No manual check-ins", "yes", "na", "na", "no"],
                  ["Zero beneficiary burden", "yes", "no", "no", "no"],
                  ["No seed phrase sharing", "yes", "no", "yes", "yes"],
                  ["Automatic execution", "yes", "no", "no", "partial"],
                  ["On Solana", "yes", "na", "yes", "no"],
                  ["No protocol token", "yes", "na", "yes", "no"],
                ].map(([feature, ...vals]) => (
                  <tr key={feature}>
                    <td className="px-4 py-3 text-gray-300">{feature}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        {v === "yes" ? (
                          <span className="text-[#00ff88]">&#10003;</span>
                        ) : v === "no" ? (
                          <span className="text-red-400">&#10007;</span>
                        ) : v === "partial" ? (
                          <span className="text-yellow-400">~</span>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">
            Trust Properties
          </h2>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: "Non-Custodial",
                description:
                  "Your keys, your crypto. Deadswitch never holds your private keys. Assets are locked in an onchain vault PDA.",
              },
              {
                icon: Eye,
                title: "Transparent",
                description:
                  "All vault state is onchain. Anyone can verify the protocol's behavior. 100% open source.",
              },
              {
                icon: Zap,
                title: "Permissionless",
                description:
                  "No admin keys can access your funds. Redistribution is executed by permissionless crank operators.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-6"
              >
                <item.icon className="h-8 w-8 text-[#00ff88] mb-4" />
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-white/10 bg-white/[0.02] py-20">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold sm:text-4xl">FAQ</h2>

          <div className="mt-12 space-y-4">
            {[
              {
                q: "What happens if I'm still alive but haven't used my wallet?",
                a: "You'll receive email alerts at 50%, 75%, and 90% of your inactivity window. You can also manually submit a heartbeat with one click. Any wallet activity automatically resets the timer.",
              },
              {
                q: "Do my beneficiaries need to install anything?",
                a: "No. Tokens are sent directly to their wallet addresses. They don't need to use Deadswitch, install any app, or even know the protocol exists.",
              },
              {
                q: "Can I cancel and get my crypto back?",
                a: "Yes. You can cancel your vault at any time and all deposited assets are returned to your wallet immediately.",
              },
              {
                q: "What if the protocol goes offline?",
                a: "The smart contract lives onchain and is immutable. Even if the website goes down, anyone can execute redistribution by calling the program directly. Your assets are never at risk.",
              },
              {
                q: "Is there a protocol token?",
                a: "No. There is no Deadswitch token. Fees are paid in SOL/USDC. We believe in building useful software, not speculative tokens.",
              },
              {
                q: "What chains are supported?",
                a: "Solana only for now. Multi-chain support (EVM) is on the roadmap.",
              },
            ].map((faq) => (
              <FAQItem key={faq.q} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 text-left"
      >
        <span className="text-sm font-medium">{question}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-white/5 px-6 py-4">
          <p className="text-sm text-gray-400">{answer}</p>
        </div>
      )}
    </div>
  );
}
