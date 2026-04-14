import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-[#0a0a0a]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-[#00ff88]/10 text-[#00ff88] font-bold text-xs">
              DS
            </div>
            <span className="text-sm text-gray-400">Deadswitch Protocol</span>
          </div>

          <div className="flex items-center gap-6">
            <Link
              href="/docs/WHITEPAPER.md"
              className="text-sm text-gray-500 hover:text-gray-300"
              target="_blank"
            >
              Whitepaper
            </Link>
            <a
              href="https://github.com/me-workspace/deadswitch_solana"
              className="text-sm text-gray-500 hover:text-gray-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Built on</span>
            <span className="font-medium text-gray-400">Solana</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
