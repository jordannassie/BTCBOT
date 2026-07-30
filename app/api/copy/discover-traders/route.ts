// GET /api/copy/discover-traders
//
// Read-only. Fetches traders from Polymarket's public leaderboard for a given
// time period (daily / weekly / monthly) and cross-references with
// tracked_wallets so the UI can show "Already Tracked" status.
//
// No writes. No mutations. No trading execution.
//
// Query params:
//   ?period=daily | weekly | monthly  (default: monthly)
//
// Response per row:
//   rank            — position in leaderboard (1-indexed)
//   wallet_address  — Polymarket proxy wallet
//   display_name    — name / pseudonym from leaderboard (null if none)
//   period          — 'daily' | 'weekly' | 'monthly'
//   pnl             — profit/loss for the period in USD (null if missing)
//   volume          — trading volume for the period in USD (null if missing)
//   is_tracked      — true if already in tracked_wallets
//   tracked_since   — tracked_wallets.created_at if tracked, else null
//   last_seen       — last_trade_at from leaderboard data (null if missing)

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

// ─── Supabase (read-only selects only) ───────────────────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Period → Polymarket timeframe mapping ────────────────────────────────────

const PERIOD_MAP: Record<string, string> = {
  daily:   '1d',
  weekly:  '1w',
  monthly: '1m',
};

// ─── Leaderboard fetch ────────────────────────────────────────────────────────

type PolyEntry = Record<string, unknown>;

function extractStr(e: PolyEntry, ...keys: string[]): string | null {
  for (const k of keys) if (typeof e[k] === 'string') return e[k] as string;
  return null;
}
function extractNum(e: PolyEntry, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '') return Number(v);
  }
  return null;
}

async function fetchLeaderboard(timeframe: string): Promise<
  { addr: string; name: string | null; pnl: number | null; volume: number | null; lastSeen: string | null }[]
> {
  const url = `https://data.polymarket.com/trading-leaderboard?timeframe=${timeframe}&limit=100`;

  const res = await fetch(url, {
    signal:  AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
    cache:   'no-store',
  });

  if (!res.ok) throw new Error(`Polymarket leaderboard responded with ${res.status}`);

  const json = await res.json();
  const items: PolyEntry[] = Array.isArray(json)
    ? json
    : (json.data ?? json.results ?? json.traders ?? []);

  return items
    .map((e) => {
      const addr = extractStr(e, 'proxyWallet', 'wallet', 'address', 'pseudonymousAddress');
      if (!addr || !addr.startsWith('0x')) return null;
      return {
        addr,
        name:     extractStr(e, 'name', 'username', 'pseudonym'),
        pnl:      extractNum(e, 'pnl', 'profit_and_loss', 'positiveProfit', 'netProfit'),
        volume:   extractNum(e, 'volume', 'totalVolume'),
        lastSeen: extractStr(e, 'lastTradeAt', 'last_trade_at', 'updatedAt'),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
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
  const period    = searchParams.get('period') ?? 'monthly';
  const timeframe = PERIOD_MAP[period] ?? '1m';

  try {
    // Fetch tracked wallets for "Already Tracked" cross-reference
    const { data: trackedData, error: trackedErr } = await client
      .from('tracked_wallets')
      .select('wallet_address, created_at');

    if (trackedErr) {
      return NextResponse.json(
        { ok: false, error: trackedErr.message },
        { status: 500, headers: NO_CACHE }
      );
    }

    // Build a map: wallet_address → created_at (tracked_since)
    const trackedMap = new Map<string, string>(
      (trackedData ?? []).map((r: { wallet_address: string; created_at: string }) => [
        r.wallet_address,
        r.created_at,
      ])
    );

    // Fetch leaderboard from Polymarket
    let leaderboardError: string | null = null;
    let leaderboardRows: ReturnType<typeof fetchLeaderboard> extends Promise<infer T> ? T : never = [];

    try {
      leaderboardRows = await fetchLeaderboard(timeframe);
    } catch (err) {
      leaderboardError = err instanceof Error ? err.message : 'Leaderboard unavailable';
    }

    // Build response rows with rank, tracked status, etc.
    const rows = leaderboardRows.map((entry, idx) => {
      const tracked_since = trackedMap.get(entry.addr) ?? null;
      return {
        rank:           idx + 1,
        wallet_address: entry.addr,
        display_name:   entry.name,
        period,
        pnl:            entry.pnl,
        volume:         entry.volume,
        is_tracked:     trackedMap.has(entry.addr),
        tracked_since,
        last_seen:      entry.lastSeen,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        rows,
        period,
        leaderboard_error: leaderboardError,
        total:             rows.length,
        tracked_count:     rows.filter((r) => r.is_tracked).length,
        fetched_at:        new Date().toISOString(),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
