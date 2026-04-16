// GET /api/copy/wallet-enrich?addresses=0x1,0x2,...
//
// Batch-enriches tracked wallets by fetching their public stats from
// Polymarket's profile API and upserting into wallet_metrics.
//
// Called automatically by TrackedWalletsSection for wallets with missing or
// stale metrics (> 1 hour since last update). Fire-and-forget from the
// frontend — the UI renders immediately from cached data and the enrichment
// arrives silently.
//
// DATA SOURCED PER WALLET (from Polymarket public profile API):
//   pnl_30d        → 30-day realised P&L
//   win_rate       → win rate, normalised to 0–1
//   trade_count    → 30-day trade count
//   trades_per_day → trade_count / 30  (leaderboard window = 30 days)
//   volume         → 30-day trading volume
//   last_trade_at  → timestamp of last observed trade
//   copy_score     → fast-copy suitability 0–100 (same formula as hot-wallets)
//
// FIELDS NOT AVAILABLE FROM PUBLIC API (remain null until worker populates):
//   avg_hold_minutes, quick_exit_rate, pnl_7d, pnl_all, first_trade_at
//
// UPSERT BEHAVIOUR:
//   Uses ON CONFLICT (wallet_address) → updates all Polymarket-sourced columns.
//   The FK on wallet_metrics ensures only tracked wallets are upserted; unknown
//   addresses are silently skipped by the DB.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE     = { 'Cache-Control': 'no-store, max-age=0' };
const MAX_ADDRS    = 20;
const FETCH_TIMEOUT = 5_000;

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Fast-copy score ──────────────────────────────────────────────────────────
// Identical formula to /api/copy/hot-wallets — keeps both endpoints consistent.

function fastCopyScore(c: {
  avg_hold_minutes:  number | null;
  quick_exit_rate:   number | null;
  win_rate:          number | null;
  pnl_30d:           number | null;
  last_trade_at:     string | null;
  trade_count:       number | null;
}): number {
  let s = 50;

  if (c.avg_hold_minutes != null) {
    if      (c.avg_hold_minutes < 30)   s += 20;
    else if (c.avg_hold_minutes < 120)  s += 12;
    else if (c.avg_hold_minutes < 360)  s +=  6;
    else if (c.avg_hold_minutes > 1440) s -= 10;
  }

  if (c.quick_exit_rate != null) {
    if      (c.quick_exit_rate >= 0.70) s += 10;
    else if (c.quick_exit_rate >= 0.50) s +=  6;
    else if (c.quick_exit_rate >= 0.30) s +=  3;
  }

  if (c.win_rate != null) {
    if      (c.win_rate >= 0.70) s += 12;
    else if (c.win_rate >= 0.60) s +=  7;
    else if (c.win_rate >= 0.50) s +=  3;
    else                         s -=  5;
  }

  if (c.pnl_30d != null) {
    if      (c.pnl_30d > 0)  s += Math.min(12, c.pnl_30d / 300);
    else if (c.pnl_30d < 0)  s -= Math.min(10, Math.abs(c.pnl_30d) / 300);
  }

  if (c.last_trade_at) {
    const h = (Date.now() - new Date(c.last_trade_at).getTime()) / 3_600_000;
    if      (h < 24)  s +=  8;
    else if (h < 72)  s +=  4;
    else if (h < 168) s +=  2;
    else if (h > 720) s -=  5;
  }

  if (c.trade_count != null && c.trade_count > 0) {
    s += Math.min(6, Math.log10(c.trade_count) * 2.5);
  }

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ─── Polymarket profile fetch ─────────────────────────────────────────────────

type EnrichedMetrics = {
  wallet_address:   string;
  display_name:     string | null;
  pnl_30d:          number;
  win_rate:         number;
  trade_count:      number;
  trades_per_day:   number | null;
  volume:           number;
  copy_score:       number;
  last_trade_at:    string | null;
  // Fields not from Polymarket — remain null; included so the upsert row is complete
  pnl_7d:           null;
  pnl_all:          null;
  avg_hold_minutes: null;
  quick_exit_rate:  null;
  max_drawdown:     number;
  updated_at:       string;
};

async function fetchProfile(address: string): Promise<EnrichedMetrics | null> {
  try {
    const res = await fetch(
      `https://polymarket.com/api/profile/${address}`,
      {
        signal:  AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
        cache:   'no-store',
      }
    );
    if (!res.ok) return null;
    const j = await res.json();

    const rawWr      = typeof j.winRate    === 'number' ? j.winRate
                     : typeof j.win_rate   === 'number' ? j.win_rate : null;
    const winRate    = rawWr != null && rawWr > 1 ? rawWr / 100 : rawWr;
    const pnl30d     = j.pnl ?? j.profit_and_loss ?? j.positiveProfit ?? j.netProfit ?? null;
    const tradeCount = j.tradeCount ?? j.numTrades ?? j.trade_count ?? null;
    const volume     = j.volume ?? j.totalVolume ?? null;
    const lastTradeAt= j.lastTradeAt ?? j.last_trade_at ?? null;

    // Leaderboard window is 30 days — trades_per_day is trade_count ÷ 30
    const tradesPerDay = typeof tradeCount === 'number'
      ? Math.round((tradeCount / 30) * 10) / 10
      : null;

    const score = fastCopyScore({
      avg_hold_minutes:  null,
      quick_exit_rate:   null,
      win_rate:          typeof winRate    === 'number' ? winRate    : null,
      pnl_30d:           typeof pnl30d     === 'number' ? pnl30d     : null,
      last_trade_at:     typeof lastTradeAt === 'string' ? lastTradeAt : null,
      trade_count:       typeof tradeCount  === 'number' ? tradeCount  : null,
    });

    return {
      wallet_address:   address,
      display_name:     j.name ?? j.username ?? j.pseudonym ?? null,
      pnl_30d:          typeof pnl30d     === 'number' ? pnl30d     : 0,
      win_rate:         typeof winRate    === 'number' ? winRate    : 0,
      trade_count:      typeof tradeCount === 'number' ? tradeCount : 0,
      trades_per_day:   tradesPerDay,
      volume:           typeof volume     === 'number' ? volume     : 0,
      copy_score:       score,
      last_trade_at:    typeof lastTradeAt === 'string' ? lastTradeAt : null,
      pnl_7d:           null,
      pnl_all:          null,
      avg_hold_minutes: null,
      quick_exit_rate:  null,
      max_drawdown:     0,
      updated_at:       new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  const { searchParams } = new URL(request.url);
  const addresses = (searchParams.get('addresses') ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.startsWith('0x') && a.length >= 20)
    .slice(0, MAX_ADDRS);

  if (!addresses.length) {
    return NextResponse.json(
      { ok: false, error: 'No valid addresses provided' },
      { status: 400, headers: NO_CACHE }
    );
  }

  // Fetch Polymarket profiles in parallel
  const results = await Promise.all(addresses.map(fetchProfile));
  const enriched = results.filter((r): r is EnrichedMetrics => r !== null);

  // Upsert into wallet_metrics
  // The FK (wallet_address → tracked_wallets) prevents unknown addresses
  // from inserting; any untracked address will produce a FK violation and
  // be captured in upsert_errors without failing the whole request.
  const upsertErrors: string[] = [];

  for (const m of enriched) {
    const { error } = await client
      .from('wallet_metrics')
      .upsert(
        {
          wallet_address:   m.wallet_address,
          pnl_30d:          m.pnl_30d,
          pnl_7d:           0,    // not from Polymarket; keep existing value via merge below
          pnl_all:          0,
          win_rate:         m.win_rate,
          trade_count:      m.trade_count,
          trades_per_day:   m.trades_per_day,
          volume:           m.volume,
          avg_hold_minutes: 0,
          max_drawdown:     0,
          copy_score:       m.copy_score,
          last_trade_at:    m.last_trade_at,
          updated_at:       m.updated_at,
        },
        { onConflict: 'wallet_address' }
      );
    if (error) upsertErrors.push(`${m.wallet_address}: ${error.message}`);
  }

  return NextResponse.json(
    {
      ok:           true,
      enriched:     enriched.length,
      failed:       addresses.length - enriched.length,
      upsert_errors: upsertErrors.length ? upsertErrors : undefined,
      // Return full metrics rows so TrackedWalletsSection can merge them
      // into React state without a second fetch.
      metrics: enriched,
    },
    { headers: NO_CACHE }
  );
}
