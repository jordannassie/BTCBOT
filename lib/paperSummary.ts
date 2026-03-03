import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_IDS = ['paper_fastloop', 'paper_sniper', 'paper_copy', 'paper_scalper'];

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
