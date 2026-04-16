// GET /api/copy/hot-wallets
//
// WHY THE PREVIOUS VERSION WAS ALWAYS EMPTY
// ──────────────────────────────────────────
// The previous implementation queried wallet_metrics WHERE wallet_address NOT IN
// tracked_wallets. This can never return any rows because wallet_metrics has a
// hard FK constraint → tracked_wallets (ON DELETE CASCADE). PostgreSQL physically
// prevents a wallet_metrics row from existing unless the wallet is already tracked.
// There is also no discovery pipeline: the Worker only writes wallet_metrics for
// wallets already in tracked_wallets. So the query always returned [].
//
// THIS VERSION
// ────────────────────────────────────────────────────────────────────────────────
// 1. PRIMARY source  — Polymarket's public trading leaderboard API.
//    Fetches the top 100 traders by 30-day P&L from:
//      https://data.polymarket.com/trading-leaderboard?timeframe=1m&limit=100
//    No auth required. Runs server-side so there are no CORS issues.
//
// 2. MANUAL candidates — operator-seeded addresses passed as ?manual=addr1,addr2
//    The HotWalletsSection stores these in localStorage and sends them as a query
//    parameter. For manual candidates the Polymarket user profile is fetched to
//    get basic stats.
//
// Both sources are filtered against tracked_wallets so already-tracked wallets
// are excluded. Each candidate gets a computed hot_score (0–100).
//
// The response always includes a `source` field per row:
//   'leaderboard' — came from the Polymarket leaderboard
//   'manual'      — operator-added by address
//   'error'       — leaderboard unreachable; fallback to manual-only mode

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

// ─── Supabase ─────────────────────────────────────────────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type CandidateSource = 'leaderboard' | 'manual';

type Candidate = {
  wallet_address:               string;
  display_name:                 string | null;
  pnl_30d:                      number | null;
  pnl_7d:                       number | null;
  pnl_daily:                    number | null;  // pnl_30d / 30
  win_rate:                     number | null;
  trade_count:                  number | null;
  trades_per_day:               number | null;  // trade_count / 30 (leaderboard window)
  volume:                       number | null;
  avg_hold_minutes:             number | null;
  last_trade_at:                string | null;
  category_focus:               string | null;
  exit_before_resolution_rate:  number | null;  // fraction 0–1
  hot_score:                    number;
  source:                       CandidateSource;
};

// ─── Hot score ────────────────────────────────────────────────────────────────
// Computes a 0–100 suitability score for fast-turnover copy trading.
// Weights are tuned toward the ranking factors the operator specified:
//   – fast hold time          (avg_hold_minutes)
//   – high activity           (trade_count, last_trade_at)
//   – positive recent PnL     (pnl_30d)
//   – accuracy                (win_rate)

function hotScore(c: Omit<Candidate, 'hot_score' | 'source'>): number {
  let s = 50; // neutral base

  // Speed: lower hold → faster exits → easier position management
  if (c.avg_hold_minutes != null) {
    if      (c.avg_hold_minutes < 30)   s += 20;
    else if (c.avg_hold_minutes < 120)  s += 12;
    else if (c.avg_hold_minutes < 360)  s +=  6;
    else if (c.avg_hold_minutes > 1440) s -= 10; // >1 day hold is slow
  }

  // Exit-before-resolution rate: higher = trader actively closes early = better
  // for copy trading (you can follow the exit before the market resolves)
  if (c.exit_before_resolution_rate != null) {
    if      (c.exit_before_resolution_rate >= 0.70) s += 10;
    else if (c.exit_before_resolution_rate >= 0.50) s +=  6;
    else if (c.exit_before_resolution_rate >= 0.30) s +=  3;
  }

  // Win rate accuracy bonus
  if (c.win_rate != null) {
    if      (c.win_rate >= 0.70) s += 12;
    else if (c.win_rate >= 0.60) s +=  7;
    else if (c.win_rate >= 0.50) s +=  3;
    else                         s -=  5;
  }

  // Positive 30d PnL — capped at +12 pts
  if (c.pnl_30d != null) {
    if      (c.pnl_30d > 0)  s += Math.min(12, c.pnl_30d / 300);
    else if (c.pnl_30d < 0)  s -= Math.min(10, Math.abs(c.pnl_30d) / 300);
  }

  // Recency — active recently = still valid strategy
  if (c.last_trade_at) {
    const h = (Date.now() - new Date(c.last_trade_at).getTime()) / 3_600_000;
    if      (h < 24)  s +=  8;
    else if (h < 72)  s +=  4;
    else if (h < 168) s +=  2;
    else if (h > 720) s -=  5; // inactive for 30+ days
  }

  // Evidence volume (more trades = more reliable signal)
  if (c.trade_count != null && c.trade_count > 0) {
    s += Math.min(6, Math.log10(c.trade_count) * 2.5);
  }

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ─── Polymarket leaderboard ───────────────────────────────────────────────────
// Fetches the top traders from Polymarket's public data API.
// The response is an array (or { data: [...] }) of trader objects.
// We accept multiple field names since the API has had minor format changes.

type PolyEntry = Record<string, unknown>;

function extractStr(e: PolyEntry, ...keys: string[]): string | null {
  for (const k of keys) if (typeof e[k] === 'string') return e[k] as string;
  return null;
}
function extractNum(e: PolyEntry, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !isNaN(Number(v))) return Number(v);
  }
  return null;
}

async function fetchLeaderboard(): Promise<Candidate[]> {
  const url =
    'https://data.polymarket.com/trading-leaderboard?timeframe=1m&limit=100';

  const res = await fetch(url, {
    signal:  AbortSignal.timeout(6_000),
    headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
    cache:   'no-store',
  });

  if (!res.ok) throw new Error(`Polymarket leaderboard ${res.status}`);

  const json = await res.json();
  const items: PolyEntry[] = Array.isArray(json)
    ? json
    : (json.data ?? json.results ?? json.traders ?? []);

  return items
    .map((e): Candidate | null => {
      // Address may be in proxyWallet, wallet, address, or pseudonymousAddress
      const addr = extractStr(e, 'proxyWallet', 'wallet', 'address', 'pseudonymousAddress');
      if (!addr || !addr.startsWith('0x')) return null;

      const pnl30d       = extractNum(e, 'pnl', 'profit_and_loss', 'positiveProfit', 'netProfit');
      const tradeCount   = extractNum(e, 'tradeCount', 'trade_count', 'numTrades');
      const rawWinRate   = extractNum(e, 'winRate', 'win_rate', 'winPercentage');
      const rawExitRate  = extractNum(e, 'earlyExitRate', 'exitBeforeResolutionRate',
                                        'exit_before_resolution_rate', 'closeBeforeExpiry',
                                        'unresolvedExitRate');

      // Leaderboard timeframe is 1 month (~30 days)
      const pnlDaily      = pnl30d      != null ? pnl30d      / 30 : null;
      const tradesPerDay  = tradeCount  != null ? tradeCount  / 30 : null;
      // Normalise to 0–1 fraction if the API returns 0–100
      const winRateNorm   = rawWinRate  != null && rawWinRate  > 1 ? rawWinRate  / 100 : rawWinRate;
      const exitRateNorm  = rawExitRate != null && rawExitRate > 1 ? rawExitRate / 100 : rawExitRate;

      const candidate: Omit<Candidate, 'hot_score'> = {
        wallet_address:              addr,
        display_name:                extractStr(e, 'name', 'username', 'pseudonym'),
        pnl_30d:                     pnl30d,
        pnl_7d:                      null,
        pnl_daily:                   pnlDaily,
        win_rate:                    winRateNorm,
        trade_count:                 tradeCount,
        trades_per_day:              tradesPerDay,
        volume:                      extractNum(e, 'volume', 'totalVolume'),
        avg_hold_minutes:            null,  // leaderboard doesn't expose hold time
        last_trade_at:               extractStr(e, 'lastTradeAt', 'last_trade_at', 'updatedAt'),
        category_focus:              null,
        exit_before_resolution_rate: exitRateNorm,
        source:                      'leaderboard',
      };

      return { ...candidate, hot_score: hotScore(candidate) };
    })
    .filter((c): c is Candidate => c !== null);
}

// ─── Manual candidate enrichment ─────────────────────────────────────────────
// For operator-added addresses we try to fetch basic stats from Polymarket's
// user profile endpoint. If that fails we return the address with null metrics.

async function enrichManual(address: string): Promise<Candidate> {
  const base: Omit<Candidate, 'hot_score'> = {
    wallet_address:               address,
    display_name:                 null,
    pnl_30d:                      null,
    pnl_7d:                       null,
    pnl_daily:                    null,
    win_rate:                     null,
    trade_count:                  null,
    trades_per_day:               null,
    volume:                       null,
    avg_hold_minutes:             null,
    last_trade_at:                null,
    category_focus:               null,
    exit_before_resolution_rate:  null,
    source:                       'manual',
  };

  try {
    // Try Polymarket's public user profile endpoint
    const res = await fetch(
      `https://polymarket.com/api/profile/${address}`,
      { signal: AbortSignal.timeout(4_000), cache: 'no-store' }
    );
    if (res.ok) {
      const j = await res.json();
      const rawWr  = typeof j.winRate  === 'number' ? j.winRate  : null;
      const rawEbr = typeof j.earlyExitRate === 'number' ? j.earlyExitRate
                   : typeof j.exitBeforeResolutionRate === 'number' ? j.exitBeforeResolutionRate
                   : null;
      const pnl30d     = j.pnl ?? j.profit_and_loss ?? null;
      const tradeCount = j.tradeCount ?? j.numTrades ?? null;

      const enriched: Omit<Candidate, 'hot_score'> = {
        ...base,
        display_name:                 j.name ?? j.username ?? null,
        pnl_30d:                      pnl30d,
        pnl_daily:                    pnl30d     != null ? pnl30d     / 30 : null,
        win_rate:                     rawWr      != null && rawWr > 1 ? rawWr / 100 : rawWr,
        trade_count:                  tradeCount,
        trades_per_day:               tradeCount != null ? tradeCount / 30 : null,
        volume:                       j.volume ?? null,
        last_trade_at:                j.lastTradeAt ?? null,
        exit_before_resolution_rate:  rawEbr     != null && rawEbr > 1 ? rawEbr / 100 : rawEbr,
      };
      return { ...enriched, hot_score: hotScore(enriched) };
    }
  } catch {
    // silently fall through to base with null metrics
  }

  return { ...base, hot_score: hotScore(base) };
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
  // Operator-added manual addresses from localStorage (comma-separated)
  const manualRaw = searchParams.get('manual') ?? '';
  const manualAddrs = manualRaw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.startsWith('0x') && a.length >= 20);

  try {
    // Fetch tracked wallets for deduplication
    const { data: trackedData } = await client
      .from('tracked_wallets')
      .select('wallet_address');
    const trackedSet = new Set(
      (trackedData ?? []).map((r: { wallet_address: string }) => r.wallet_address)
    );

    // Fetch leaderboard candidates
    let leaderboardCandidates: Candidate[] = [];
    let leaderboardError: string | null = null;
    try {
      leaderboardCandidates = await fetchLeaderboard();
    } catch (err) {
      leaderboardError = err instanceof Error ? err.message : 'Leaderboard unavailable';
    }

    // Enrich manual candidates (parallel, 5 s timeout total)
    const manualCandidates: Candidate[] = await Promise.all(
      manualAddrs.map((addr) => enrichManual(addr))
    );

    // Merge: leaderboard first, then manual extras not already in leaderboard
    const lbAddrs = new Set(leaderboardCandidates.map((c) => c.wallet_address));
    const merged = [
      ...leaderboardCandidates,
      ...manualCandidates.filter((c) => !lbAddrs.has(c.wallet_address)),
    ];

    // Remove already-tracked wallets
    const candidates = merged
      .filter((c) => !trackedSet.has(c.wallet_address))
      .sort((a, b) => b.hot_score - a.hot_score);

    return NextResponse.json(
      {
        ok: true,
        rows: candidates,
        leaderboard_error: leaderboardError,
        total_leaderboard: leaderboardCandidates.length,
        total_manual:       manualCandidates.length,
        total_tracked:      trackedSet.size,
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
