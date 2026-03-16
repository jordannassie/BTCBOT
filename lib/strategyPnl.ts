import { createClient } from '@supabase/supabase-js';

const STRATEGY_BOT_IDS = [
  'paper_fastloop',
  'paper_sniper',
  'paper_candle_bias',
  'paper_sweep_reclaim',
  'paper_breakout_close',
  'paper_engulfing_level',
  'paper_rejection_wick',
  'paper_follow_through'
];

function getSupabaseClient() {
  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    throw new Error('Supabase service credentials are missing.');
  }

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

const HOURS_24 = 24 * 60 * 60 * 1000;

export async function getStrategyPnl24h(botId: string): Promise<number> {
  if (!STRATEGY_BOT_IDS.includes(botId)) {
    return 0;
  }

  const client = getSupabaseClient();
  const since = new Date(Date.now() - HOURS_24).toISOString();
  const { data, error } = await client
    .from('paper_positions')
    .select('sum(pnl_usd)')
    .eq('bot_id', botId)
    .eq('status', 'CLOSED')
    .gte('closed_at', since);

  if (error) {
    console.error('Error fetching 24h pnl', error);
    return 0;
  }

  const row = Array.isArray(data) ? data[0] : null;
  const sumValue = Number(row?.sum ?? 0);
  return sumValue;
}

export async function getAllStrategyPnl24h(): Promise<Record<string, number>> {
  const client = getSupabaseClient();
  const since = new Date(Date.now() - HOURS_24).toISOString();
  const { data, error } = await client
    .from('paper_positions')
    .select('bot_id, pnl_usd')
    .in('bot_id', STRATEGY_BOT_IDS)
    .eq('status', 'CLOSED')
    .gte('closed_at', since);

  if (error) {
    console.error('Error fetching all strategy 24h pnl', error);
    return {};
  }

  const totals: Record<string, number> = {};
  (data ?? []).forEach((row: { bot_id: string; pnl_usd?: number | string | null }) => {
    const value = Number(row.pnl_usd ?? 0);
    totals[row.bot_id] = (totals[row.bot_id] ?? 0) + value;
  });
  return totals;
}
