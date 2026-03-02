'use server';

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

const BOT_ID = 'default';

export type OperatorSettingsPayload = {
  isEnabled: boolean;
  mode: 'PAPER' | 'LIVE';
  edgeThreshold: number | null;
  tradeSize: number | null;
  maxTradesPerHour: number | null;
  paperBalanceUsd: number | null;
};

export async function updateOperatorSettings(payload: OperatorSettingsPayload) {

  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    throw new Error('Supabase service credentials are missing.');
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  const updates: Record<string, unknown> = {
    is_enabled: payload.isEnabled,
    mode: payload.mode,
    edge_threshold: payload.edgeThreshold,
    trade_size_usd: payload.tradeSize,
    max_trades_per_hour: payload.maxTradesPerHour,
    paper_balance_usd: typeof payload.paperBalanceUsd === 'number' ? Math.round(payload.paperBalanceUsd * 100) / 100 : null,
    updated_at: new Date().toISOString()
  };

  const { error } = await client.from('bot_settings').update(updates).eq('bot_id', BOT_ID);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/activity');

  return true;
}
