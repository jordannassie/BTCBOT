import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_IDS = ['paper_fastloop', 'paper_sniper', 'paper_copy', 'paper_scalper'];

export async function GET(request: Request) {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ trades: [] });
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
    return NextResponse.json({ trades: [] }, { status: 500 });
  }

  if (data) {
    const strategyIds = Array.from(new Set(data.map((item) => (item.strategy_id ?? 'UNKNOWN').toUpperCase())));
    console.info('ACTIVITY_FETCH', {
      rows_count: data.length,
      strategy_ids: strategyIds
    });
  }

  return NextResponse.json({ trades: data ?? [] });
}
