// GET /api/btc-ema-metrics
//
// Returns performance metrics for the BTC 5M EMA strategy only
// (bot_id = 'btc_5m_ema'). Reads from the shared bot_trades table,
// filtered strictly to this bot — never touches copy_bots, copied_positions,
// copy_global_settings, or any copy-trading path.
//
// Response:
//   open_count:   number   — trades currently open
//   open_exposure: number  — USD sum of size on open trades
//   total_pnl:    number   — all-time realized P/L (sum of pnl_usd on closed)
//   daily_series: { date: string; cumulative_pnl: number }[]
//                          — daily cumulative P/L for the sparkline
//                            (empty when no closed trades exist)

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BOT_ID = 'btc_5m_ema';
const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type BotTrade = {
  status: string;
  size: number | null;
  pnl_usd: number | null;
  updated_at: string | null;
  created_at: string;
};

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // Fetch all trades for btc_5m_ema — typically small in number so no pagination needed
    const { data, error } = await client
      .from('bot_trades')
      .select('status, size, pnl_usd, updated_at, created_at')
      .eq('bot_id', BOT_ID)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    const trades = (data ?? []) as BotTrade[];

    // ── Open exposure ──────────────────────────────────────────────────────────
    const openTrades = trades.filter((t) => t.status === 'open');
    const openCount    = openTrades.length;
    const openExposure = openTrades.reduce((sum, t) => sum + (t.size ?? 0), 0);

    // ── All-time realized P/L ─────────────────────────────────────────────────
    const closedTrades = trades.filter((t) => t.status === 'closed' || t.status === 'CLOSED');
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl_usd ?? 0), 0);

    // ── Daily cumulative P/L series for sparkline ─────────────────────────────
    // Group closed trades by close date (updated_at date, falling back to created_at).
    // Returns an array sorted by date with running cumulative P/L.
    const dailyMap = new Map<string, number>();
    for (const t of closedTrades) {
      const raw = t.updated_at ?? t.created_at;
      const date = raw ? raw.slice(0, 10) : null; // 'YYYY-MM-DD'
      if (!date) continue;
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + (t.pnl_usd ?? 0));
    }

    // Sort dates and compute running cumulative sum
    const sortedDates = Array.from(dailyMap.keys()).sort();
    let running = 0;
    const dailySeries = sortedDates.map((date) => {
      running += dailyMap.get(date) ?? 0;
      return { date, cumulative_pnl: parseFloat(running.toFixed(4)) };
    });

    return NextResponse.json(
      {
        ok: true,
        open_count:    openCount,
        open_exposure: parseFloat(openExposure.toFixed(4)),
        total_pnl:     parseFloat(totalPnl.toFixed(4)),
        daily_series:  dailySeries,
        fetched_at:    new Date().toISOString(),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
