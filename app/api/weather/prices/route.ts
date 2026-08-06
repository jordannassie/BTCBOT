// POST /api/weather/prices
//
// Fetches public CLOB order-book data for a list of Polymarket token IDs.
// No authentication required — all order-book data is publicly readable.
//
// Body: { tokenIds: string[] }   (max 20 token IDs)
//
// Returns PricesApiResponse with best asks, best bids, and depth per token.
// Does NOT place, prepare, or simulate any orders. Read-only.

import { NextRequest, NextResponse } from 'next/server';
import type { OrderBookData, OrderBookLevel, PricesApiResponse } from '@/lib/weather-types';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const CLOB_BASE   = 'https://clob.polymarket.com';
const MAX_TOKENS  = 20;
const FETCH_TIMEOUT_MS = 8_000;

// ── Fetch one order book from CLOB ───────────────────────────────────────────

interface ClobOrderBook {
  market:          string;
  asset_id:        string;
  timestamp:       string;
  bids:            Array<{ price: string; size: string }>;
  asks:            Array<{ price: string; size: string }>;
  last_trade_price?: string;
}

async function fetchOrderBook(tokenId: string): Promise<OrderBookData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'BTCBOT-Weather/1.0' },
      next: { revalidate: 0 },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return emptyBook(tokenId, `CLOB ${res.status}`);
    }

    const raw: ClobOrderBook = await res.json();

    // Parse bids sorted descending (best bid = highest price = first)
    const bids: OrderBookLevel[] = (raw.bids || [])
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size))
      .sort((a, b) => b.price - a.price);  // descending

    // Parse asks sorted ascending (best ask = lowest price = first)
    const asks: OrderBookLevel[] = (raw.asks || [])
      .map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
      .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size))
      .sort((a, b) => a.price - b.price);  // ascending

    const lastTradeRaw = raw.last_trade_price;
    const lastTrade = lastTradeRaw ? parseFloat(lastTradeRaw) : null;

    return {
      tokenId,
      outcome:        '',   // populated by the caller who knows the mapping
      bids,
      asks,
      bestBid:        bids.length > 0  ? bids[0].price  : null,
      bestAsk:        asks.length > 0  ? asks[0].price  : null,
      lastTradePrice: Number.isFinite(lastTrade ?? NaN) ? (lastTrade as number) : null,
      timestamp:      raw.timestamp
        ? new Date(Number(raw.timestamp)).toISOString()
        : new Date().toISOString(),
      error:          null,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return emptyBook(tokenId, msg.includes('abort') ? 'Timeout' : msg);
  }
}

function emptyBook(tokenId: string, error: string): OrderBookData {
  return {
    tokenId,
    outcome:        '',
    bids:           [],
    asks:           [],
    bestBid:        null,
    bestAsk:        null,
    lastTradePrice: null,
    timestamp:      new Date().toISOString(),
    error,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, orderBooks: {}, error: 'Invalid JSON body' } satisfies PricesApiResponse,
      { status: 400 }
    );
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { tokenIds?: unknown }).tokenIds)) {
    return NextResponse.json(
      { ok: false, orderBooks: {}, error: 'Body must contain tokenIds array' } satisfies PricesApiResponse,
      { status: 400 }
    );
  }

  const rawIds = (body as { tokenIds: unknown[] }).tokenIds;
  const tokenIds = rawIds
    .filter((id) => typeof id === 'string' && id.length > 0)
    .slice(0, MAX_TOKENS) as string[];

  if (tokenIds.length === 0) {
    return NextResponse.json(
      { ok: false, orderBooks: {}, error: 'No valid token IDs provided' } satisfies PricesApiResponse,
      { status: 400 }
    );
  }

  try {
    // Fetch all order books in parallel
    const results = await Promise.all(tokenIds.map(fetchOrderBook));

    const orderBooks: Record<string, OrderBookData> = {};
    for (const ob of results) {
      orderBooks[ob.tokenId] = ob;
    }

    const response: PricesApiResponse = {
      ok:         true,
      orderBooks,
      error:      null,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[weather/prices] error:', message);

    return NextResponse.json(
      { ok: false, orderBooks: {}, error: message } satisfies PricesApiResponse,
      { status: 500 }
    );
  }
}
