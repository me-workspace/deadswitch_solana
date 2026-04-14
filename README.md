# Deadswitch

**Onchain Inheritance & Dead Man's Switch Protocol on Solana**

> Your crypto shouldn't die with you.

Deadswitch is a non-custodial, permissionless protocol that automatically distributes your crypto assets to designated beneficiaries if your wallet becomes inactive. No seed phrases to share. No manual check-ins. No trusted third parties.

## How It Works

1. **Create a Vault** — Connect your wallet, choose beneficiaries, deposit assets, set an inactivity window.
2. **Live Your Life** — Any normal wallet activity (swaps, transfers, staking) automatically resets the timer.
3. **Protected** — If your wallet goes inactive beyond the threshold + grace period, assets are automatically redistributed to your beneficiaries.

## Key Features

- **Non-custodial** — Your keys, your crypto. Deadswitch never holds your private keys.
- **Passive proof-of-life** — No "check-in" buttons. Normal wallet usage is your proof of life.
- **Permissionless execution** — Anyone can trigger redistribution when conditions are met (crank mechanism).
- **No custom token** — Fees paid in SOL/USDC. No protocol token required.
- **Zero beneficiary burden** — Recipients get tokens directly in their wallet. No app downloads, no seed phrases.

## Architecture

```
┌─────────────────────────────────────────┐
│           DEADSWITCH PROTOCOL           │
│                                         │
│  Anchor Program (Solana) ← Source of    │
│  │                         Truth        │
│  ├── Vault creation & management        │
│  ├── Heartbeat recording                │
│  └── Redistribution execution           │
│                                         │
│  Helius Webhooks ← Wallet Monitoring    │
│  Next.js App ← Frontend + Backend       │
│  Crank Bot ← Permissionless Executor    │
└─────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contract | Anchor (Rust) on Solana |
| Frontend | Next.js 15 + React 19 + TypeScript |
| Styling | TailwindCSS + shadcn/ui |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Monitoring | Helius Webhooks |
| Email | Resend |
| Hosting | Vercel |

## Project Structure

```
deadswitch_solana/
├── programs/deadswitch/     # Anchor program (Rust)
├── app/                     # Next.js frontend + API
├── crank/                   # Crank bot
├── tests/                   # Anchor integration tests
└── docs/                    # Whitepaper, PRD
```

## Documentation

- [Whitepaper](docs/WHITEPAPER.md)
- [Product Requirements Document](docs/PRD.md)

## Development

```bash
# Prerequisites: Rust, Solana CLI, Anchor CLI, Node.js 20+

# Install dependencies
npm install

# Build Anchor program
anchor build

# Run tests
anchor test

# Start frontend
cd app && npm run dev
```

## Hackathon

Built for the [Solana Frontier Hackathon](https://www.colosseum.org/) (April 6 – May 11, 2026).

## License

MIT
