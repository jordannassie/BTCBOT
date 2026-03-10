import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_IDS = ['paper_fastloop', 'paper_sniper', 'paper_candle_bias'];

export async function GET(req: Request) {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing or invalid' }, { status: 500 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status')?.toUpperCase() ?? 'OPEN';
  const strategyParam = url.searchParams.get('strategy')?.toUpperCase();
  if (!['OPEN', 'CLOSED'].includes(status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 });
  }

  try {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const desiredStatuses =
      status === 'OPEN' ? ['OPEN'] : ['CLOSED', 'FORCED_CLOSE'];

    const query = client
      .from('paper_positions')
      .select(
        'id, bot_id, status, market_slug, side, entry_price, size_usd, opened_at, resolved_side, pnl_usd, closed_at, strategy_id'
      )
      .in('bot_id', PAPER_BOT_IDS)
      .in('status', desiredStatuses)
      .limit(50);

    if (strategyParam && strategyParam !== 'ALL') {
      query.eq('strategy_id', strategyParam);
    }
    if (status === 'OPEN') {
      query.order('opened_at', { ascending: false });
    } else {
      query.order('closed_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: data?.length ?? 0, rows: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
