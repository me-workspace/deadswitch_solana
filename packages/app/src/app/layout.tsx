import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SolanaProviders } from "@/lib/solana/wallet-provider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Deadswitch — Onchain Inheritance on Solana",
  description:
    "Non-custodial dead man's switch protocol. Automatically distribute your crypto to beneficiaries if your wallet becomes inactive.",
  openGraph: {
    title: "Deadswitch — Your Crypto Shouldn't Die With You",
    description:
      "Non-custodial onchain inheritance protocol on Solana. Set it once, forget it.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} dark h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-white">
        <SolanaProviders>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </SolanaProviders>
      </body>
    </html>
  );
}
