import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Cumulative P&L series per tracked wallet.
// Data source priority:
//   1. wallet_pnl_daily  — populated by the worker from source wallet trade history.
//                          This reflects the SOURCE WALLET's own performance curve.
//   2. copied_positions  — our copy-bot closed positions (fallback until worker runs).
//                          Reflects how copying that wallet has performed for US.
// Per wallet, whichever source has data is used; daily rows win if both exist.

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type SeriesPoint = { x: string; y: number };
export type WalletSeries = { wallet_address: string; points: SeriesPoint[] };

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    // Run both queries in parallel — prefer wallet_pnl_daily per wallet.
    const [dailyRes, positionsRes] = await Promise.all([
      // Primary: worker-populated daily P&L time series
      client
        .from('wallet_pnl_daily')
        .select('wallet_address, date, cumulative_pnl')
        .order('date', { ascending: true }),

      // Fallback: our own copy-bot closed positions
      client
        .from('copied_positions')
        .select('wallet_address, closed_at, pnl')
        .eq('status', 'CLOSED')
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: true })
        .limit(2000),
    ]);

    if (positionsRes.error && dailyRes.error) {
      return NextResponse.json(
        { ok: false, error: positionsRes.error.message },
        { status: 500 }
      );
    }

    // ── Build series from wallet_pnl_daily (primary) ──────────────────────────
    const dailySeriesMap = new Map<string, SeriesPoint[]>();
    for (const row of dailyRes.data ?? []) {
      const addr: string = row.wallet_address;
      if (!dailySeriesMap.has(addr)) dailySeriesMap.set(addr, []);
      dailySeriesMap.get(addr)!.push({
        x: row.date,
        y: Number(Number(row.cumulative_pnl).toFixed(4)),
      });
    }

    // ── Build series from copied_positions (fallback) ─────────────────────────
    const positionsSeriesMap = new Map<string, SeriesPoint[]>();
    const runningTotal       = new Map<string, number>();

    for (const row of positionsRes.data ?? []) {
      const addr: string   = row.wallet_address;
      const pnl: number    = Number(row.pnl ?? 0);
      const closedAt: string = row.closed_at;

      if (!positionsSeriesMap.has(addr)) {
        positionsSeriesMap.set(addr, [{ x: closedAt, y: 0 }]);
        runningTotal.set(addr, 0);
      }

      const prev       = runningTotal.get(addr) ?? 0;
      const cumulative = prev + pnl;
      runningTotal.set(addr, cumulative);
      positionsSeriesMap.get(addr)!.push({ x: closedAt, y: Number(cumulative.toFixed(4)) });
    }

    // ── Merge: prefer daily per wallet ────────────────────────────────────────
    const allAddresses = new Set([
      ...dailySeriesMap.keys(),
      ...positionsSeriesMap.keys(),
    ]);

    const series: WalletSeries[] = Array.from(allAddresses).map((addr) => ({
      wallet_address: addr,
      points: dailySeriesMap.get(addr) ?? positionsSeriesMap.get(addr) ?? [],
      source: dailySeriesMap.has(addr) ? 'daily' : 'positions',
    }));

    return NextResponse.json(
      { ok: true, series },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
