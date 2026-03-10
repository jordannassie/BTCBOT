import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_IDS = ['paper_fastloop', 'paper_sniper', 'paper_candle_bias'];

function getServiceClient() {
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

export type PaperSummaryRow = {
  bot_id: string;
  paper_balance_usd?: number | null;
  paper_pnl_usd?: number | null;
};

export async function getPaperSummary(): Promise<PaperSummaryRow[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('bot_settings')
    .select('bot_id, paper_balance_usd, paper_pnl_usd')
    .in('bot_id', PAPER_BOT_IDS);

  if (error) {
    console.error('Unable to fetch paper summary', error);
    return [];
  }

  return Array.isArray(data) ? (data as PaperSummaryRow[]) : [];
}

export async function getDefaultStrategySettings(): Promise<Record<string, unknown>> {
  const client = getServiceClient();
  const { data, error } = await client
    .from('bot_settings')
    .select('strategy_settings')
    .eq('bot_id', 'default')
    .limit(1)
    .single();

  if (error) {
    console.error('Unable to fetch default strategy settings', error);
    return {};
  }

  return data?.strategy_settings ?? {};
}
