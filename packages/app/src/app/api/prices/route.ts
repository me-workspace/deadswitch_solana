import type { ApiResponse, TokenPrice } from "@deadswitch/sdk";
import { getTokenPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * Return cached token prices for SOL, USDC, and USDT.
 *
 * Prices are cached in-memory for 60 seconds. Falls back to
 * hardcoded prices when external APIs are unavailable.
 */
export async function GET(): Promise<Response> {
  try {
    const prices = await getTokenPrices();

    const response: ApiResponse<TokenPrice[]> = {
      data: prices,
      meta: {
        version: "0.1.0",
        timestamp: Date.now(),
      },
    };

    return Response.json(response, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  } catch (err) {
    console.error("[prices] Unexpected error:", err);

    const response: ApiResponse<TokenPrice[]> = {
      data: [],
      error: "Failed to fetch prices",
      meta: {
        version: "0.1.0",
        timestamp: Date.now(),
      },
    };

    return Response.json(response, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

/**
 * Handle CORS preflight.
 */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
