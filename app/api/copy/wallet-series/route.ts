import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Cumulative P&L series per tracked wallet, built from closed copied_positions.
// Used by the TrackedWalletsSection sparklines.

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
    // Fetch all closed positions ordered by close time.
    // We cap at 2000 rows — enough for dense sparklines without overloading.
    const { data, error } = await client
      .from('copied_positions')
      .select('wallet_address, closed_at, pnl')
      .eq('status', 'CLOSED')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: true })
      .limit(2000);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Group by wallet_address and compute cumulative P&L
    const walletMap = new Map<string, SeriesPoint[]>();
    const runningTotal = new Map<string, number>();

    for (const row of data ?? []) {
      const addr: string = row.wallet_address;
      const pnl: number = Number(row.pnl ?? 0);
      const closedAt: string = row.closed_at;

      if (!walletMap.has(addr)) {
        walletMap.set(addr, [{ x: closedAt, y: 0 }]); // start at zero
        runningTotal.set(addr, 0);
      }

      const prev = runningTotal.get(addr) ?? 0;
      const cumulative = prev + pnl;
      runningTotal.set(addr, cumulative);
      walletMap.get(addr)!.push({ x: closedAt, y: Number(cumulative.toFixed(4)) });
    }

    const series: WalletSeries[] = Array.from(walletMap.entries()).map(
      ([wallet_address, points]) => ({ wallet_address, points })
    );

    return NextResponse.json({ ok: true, series }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
