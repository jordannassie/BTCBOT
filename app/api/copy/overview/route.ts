import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const CRYPTO_BOT_IDS = ['btc_5m_late'];

    const [walletsRes, botsRes, positionsRes, attemptsRes, settingsRes, cryptoBotsRes] = await Promise.all([
      // Filter is_active=true — only count wallets the worker is actively monitoring
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }).eq('is_active', true),
      // copy_bots = copy-trader bots only (not crypto strategy bots)
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true),
      client.from('copied_positions').select('*', { count: 'exact', head: true }).eq('status', 'OPEN'),
      client.from('copy_attempts').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      client.from('copy_global_settings').select('*').eq('id', 1).maybeSingle(),
      // crypto strategy bots from bot_settings (btc_5m_late etc.)
      client.from('bot_settings').select('*', { count: 'exact', head: true })
        .eq('is_enabled', true)
        .in('bot_id', CRYPTO_BOT_IDS),
    ]);

    return NextResponse.json({
      ok: true,
      walletCount: walletsRes.count ?? 0,
      activeBotCount: botsRes.count ?? 0,        // copy-trader bots
      activeCryptoBotCount: cryptoBotsRes.count ?? 0, // crypto strategy bots
      openPositionCount: positionsRes.count ?? 0,
      attemptsTodayCount: attemptsRes.count ?? 0,
      settings: settingsRes.data ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
