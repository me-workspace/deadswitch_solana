import type { TokenPrice } from "@deadswitch/sdk";

/** Cache TTL in milliseconds (60 seconds) */
const CACHE_TTL_MS = 60_000;

/** In-memory price cache */
let cachedPrices: TokenPrice[] | null = null;
let cachedAt = 0;

/** Well-known mint addresses */
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Fallback prices for when external APIs are unavailable */
const FALLBACK_PRICES: TokenPrice[] = [
  {
    mint: SOL_MINT,
    symbol: "SOL",
    priceUsd: 150.0,
    updatedAt: new Date().toISOString(),
  },
  {
    mint: USDC_MINT_MAINNET,
    symbol: "USDC",
    priceUsd: 1.0,
    updatedAt: new Date().toISOString(),
  },
  {
    mint: USDT_MINT_MAINNET,
    symbol: "USDT",
    priceUsd: 1.0,
    updatedAt: new Date().toISOString(),
  },
];

/** Jupiter price API response shape */
interface JupiterPriceData {
  [mint: string]: {
    id: string;
    type: string;
    price: string;
  };
}

/**
 * Fetch token prices from the Jupiter Price API v2.
 *
 * @returns Array of token prices or null on failure
 */
async function fetchFromJupiter(): Promise<TokenPrice[] | null> {
  try {
    const ids = [SOL_MINT, USDC_MINT_MAINNET, USDT_MINT_MAINNET].join(",");
    const response = await fetch(
      `https://api.jup.ag/price/v2?ids=${ids}`,
      {
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const json = (await response.json()) as { data: JupiterPriceData };
    const now = new Date().toISOString();

    const prices: TokenPrice[] = [];

    const solData = json.data[SOL_MINT];
    if (solData) {
      prices.push({
        mint: SOL_MINT,
        symbol: "SOL",
        priceUsd: parseFloat(solData.price),
        updatedAt: now,
      });
    }

    const usdcData = json.data[USDC_MINT_MAINNET];
    if (usdcData) {
      prices.push({
        mint: USDC_MINT_MAINNET,
        symbol: "USDC",
        priceUsd: parseFloat(usdcData.price),
        updatedAt: now,
      });
    }

    const usdtData = json.data[USDT_MINT_MAINNET];
    if (usdtData) {
      prices.push({
        mint: USDT_MINT_MAINNET,
        symbol: "USDT",
        priceUsd: parseFloat(usdtData.price),
        updatedAt: now,
      });
    }

    return prices.length > 0 ? prices : null;
  } catch (err) {
    console.warn("[prices] Jupiter API fetch failed:", err);
    return null;
  }
}

/**
 * Fetch token prices from CoinGecko as a fallback.
 *
 * @returns Array of token prices or null on failure
 */
async function fetchFromCoinGecko(): Promise<TokenPrice[] | null> {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana,usd-coin,tether&vs_currencies=usd",
      {
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as Record<
      string,
      { usd: number }
    >;
    const now = new Date().toISOString();

    const prices: TokenPrice[] = [];

    if (data.solana) {
      prices.push({
        mint: SOL_MINT,
        symbol: "SOL",
        priceUsd: data.solana.usd,
        updatedAt: now,
      });
    }

    if (data["usd-coin"]) {
      prices.push({
        mint: USDC_MINT_MAINNET,
        symbol: "USDC",
        priceUsd: data["usd-coin"].usd,
        updatedAt: now,
      });
    }

    if (data.tether) {
      prices.push({
        mint: USDT_MINT_MAINNET,
        symbol: "USDT",
        priceUsd: data.tether.usd,
        updatedAt: now,
      });
    }

    return prices.length > 0 ? prices : null;
  } catch (err) {
    console.warn("[prices] CoinGecko API fetch failed:", err);
    return null;
  }
}

/**
 * Get current token prices for SOL, USDC, and USDT.
 *
 * Uses an in-memory cache with a 60-second TTL.
 * Fetches from Jupiter first, falls back to CoinGecko,
 * then falls back to hardcoded prices for devnet demo usage.
 *
 * @returns Array of TokenPrice objects
 */
export async function getTokenPrices(): Promise<TokenPrice[]> {
  const now = Date.now();

  // Return cached prices if still fresh
  if (cachedPrices && now - cachedAt < CACHE_TTL_MS) {
    return cachedPrices;
  }

  // Try Jupiter first (most accurate for Solana tokens)
  let prices = await fetchFromJupiter();

  // Fall back to CoinGecko
  if (!prices) {
    prices = await fetchFromCoinGecko();
  }

  // Fall back to last known prices or hardcoded defaults
  if (!prices) {
    if (cachedPrices) {
      console.warn(
        "[prices] All APIs failed — returning stale cached prices"
      );
      return cachedPrices;
    }
    console.warn(
      "[prices] All APIs failed and no cache — returning fallback prices"
    );
    return FALLBACK_PRICES;
  }

  // Update cache
  cachedPrices = prices;
  cachedAt = now;

  return prices;
}
