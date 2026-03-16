import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const PAPER_BOT_IDS = [
  'paper_fastloop',
  'paper_sniper',
  'paper_candle_bias',
  'paper_sweep_reclaim',
  'paper_breakout_close',
  'paper_engulfing_level',
  'paper_rejection_wick',
  'paper_follow_through'
];

export async function GET(request: Request) {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    const empty = NextResponse.json({ trades: [] });
    empty.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    empty.headers.set('Pragma', 'no-cache');
    return empty;
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  const url = new URL(request.url);
  const strategyParam = url.searchParams.get('strategy')?.toUpperCase();

  const query = client
    .from('bot_trades')
    .select('*')
    .in('bot_id', PAPER_BOT_IDS)
    .order('created_at', { ascending: false })
    .limit(100);

  if (strategyParam && strategyParam !== 'ALL') {
    query.eq('strategy_id', strategyParam);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to load trades:', error);
    const errRes = NextResponse.json({ trades: [] }, { status: 500 });
    errRes.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    errRes.headers.set('Pragma', 'no-cache');
    return errRes;
  }

  const trades = data ?? [];
  if (trades.length > 0) {
    const newest = trades[0];
    console.info(
      `ACTIVITY_FETCH rows_count=${trades.length} newest_created_at=${newest.created_at ?? ''} newest_bot_id=${newest.bot_id ?? ''} newest_strategy_id=${newest.strategy_id ?? ''}`
    );
  }

  const res = NextResponse.json({ trades });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  return res;
}
