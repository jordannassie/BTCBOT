import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'default';
const RANGE_DELTA: Record<'1D' | '1W' | '1M', number> = {
  '1D': 24 * 60 * 60,
  '1W': 7 * 24 * 60 * 60,
  '1M': 30 * 24 * 60 * 60
};

export async function GET(request: Request) {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing or invalid' }, { status: 500 });
  }

  const url = new URL(request.url);
  const range = (url.searchParams.get('range') ?? '1D').toUpperCase() as '1D' | '1W' | '1M' | 'ALL';
  if (!['1D', '1W', '1M', 'ALL'].includes(range)) {
    return NextResponse.json({ ok: false, error: 'Invalid range' }, { status: 400 });
  }

  try {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let query = client
      .from('paper_positions')
      .select('pnl_usd, closed_at')
      .eq('bot_id', BOT_ID)
      .eq('status', 'CLOSED')
      .not('pnl_usd', 'is', null)
      .order('closed_at', { ascending: true })
      .limit(500);

    if (range !== 'ALL') {
      const sinceSeconds = Math.floor(Date.now() / 1000) - RANGE_DELTA[range];
      const sinceIso = new Date(sinceSeconds * 1000).toISOString();
      query = query.gte('closed_at', sinceIso);
    }

    const { data: positions, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (positions ?? []) as { pnl_usd: number; closed_at: string }[];

    const { data: settings } = await client
      .from('bot_settings')
      .select('paper_balance_usd')
      .eq('bot_id', BOT_ID)
      .single();

    const currentBalance = settings?.paper_balance_usd ?? 0;
    const pnlSum = rows.reduce((sum, row) => sum + (row.pnl_usd ?? 0), 0);
    const startEquity = currentBalance - pnlSum;

    let equity = startEquity;
    const points = rows.map((row) => {
      equity += row.pnl_usd ?? 0;
      return {
        t: new Date(row.closed_at).getTime(),
        equity
      };
    });

    const endEquity = points.length > 0 ? points[points.length - 1].equity : startEquity;
    const pnl = endEquity - startEquity;

    const response = NextResponse.json({
      ok: true,
      range,
      start_equity: startEquity,
      end_equity: endEquity,
      pnl,
      points
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
