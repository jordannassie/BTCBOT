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

// ─── Period → Polymarket timePeriod mapping ───────────────────────────────────

const PERIOD_MAP: Record<string, string> = {
  daily:   'DAY',
  weekly:  'WEEK',
  monthly: 'MONTH',
};

const LB_ENDPOINT = 'https://data-api.polymarket.com/v1/leaderboard';

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

type LbEntry = {
  rank:          number;
  addr:          string;
  name:          string | null;
  pnl:           number | null;
  volume:        number | null;
  xUsername:     string | null;
  verifiedBadge: boolean;
};

async function fetchLeaderboard(timePeriod: string): Promise<LbEntry[]> {
  const url = new URL(LB_ENDPOINT);
  url.searchParams.set('category', 'OVERALL');
  url.searchParams.set('timePeriod', timePeriod);
  url.searchParams.set('orderBy', 'PNL');
  url.searchParams.set('limit', '50');
  url.searchParams.set('offset', '0');

  const res = await fetch(url.toString(), {
    signal:  AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
    cache:   'no-store',
  });

  if (!res.ok) {
    throw new Error(
      `Polymarket leaderboard HTTP ${res.status} — endpoint: ${LB_ENDPOINT}, timePeriod: ${timePeriod}`
    );
  }

  const json = await res.json();
  const items: PolyEntry[] = Array.isArray(json)
    ? json
    : (json.data ?? json.results ?? json.traders ?? []);

  return items
    .map((e, idx) => {
      const addr = extractStr(e, 'proxyWallet');
      if (!addr) return null;
      const rawRank = e['rank'];
      const rank =
        typeof rawRank === 'number'                               ? rawRank
        : typeof rawRank === 'string' && !isNaN(Number(rawRank)) ? Number(rawRank)
        : idx + 1;
      return {
        rank,
        addr,
        name:          extractStr(e, 'userName'),
        pnl:           extractNum(e, 'pnl'),
        volume:        extractNum(e, 'vol'),
        xUsername:     extractStr(e, 'xUsername'),
        verifiedBadge: e['verifiedBadge'] === true,
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
  const period     = searchParams.get('period') ?? 'monthly';
  const timePeriod = PERIOD_MAP[period] ?? 'MONTH';

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
    let leaderboardRows: LbEntry[] = [];

    try {
      leaderboardRows = await fetchLeaderboard(timePeriod);
      console.log(`DISCOVER_TRADERS_FETCH period=${timePeriod} status=200 count=${leaderboardRows.length}`);
    } catch (err) {
      leaderboardError = err instanceof Error ? err.message : 'Leaderboard unavailable';
      console.error(`DISCOVER_TRADERS_FETCH period=${timePeriod} error=${leaderboardError}`);
    }

    // Build response rows with rank, tracked status, etc.
    const rows = leaderboardRows.map((entry) => {
      const tracked_since = trackedMap.get(entry.addr) ?? null;
      return {
        rank:           entry.rank,
        wallet_address: entry.addr,
        display_name:   entry.name,
        username:       entry.xUsername,
        verified_badge: entry.verifiedBadge,
        period,
        pnl:            entry.pnl,
        volume:         entry.volume,
        is_tracked:     trackedMap.has(entry.addr),
        tracked_since,
        last_seen:      null,
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
