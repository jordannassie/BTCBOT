import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_DEFAULTS: Record<string, number> = {
  paper_fastloop: 50,
  paper_sniper: 50,
  paper_candle_bias: 50,
  paper_sweep_reclaim: 100,
  paper_breakout_close: 100,
  paper_engulfing_level: 100,
  paper_rejection_wick: 100,
  paper_follow_through: 100
};

const PAPER_BOT_IDS = new Set(Object.keys(PAPER_BOT_DEFAULTS));

function getSupabaseConfig() {
  let supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (supabaseUrl.startsWith('$')) supabaseUrl = '';
  return { supabaseUrl, serviceKey };
}

export async function POST(request: Request) {
  const { supabaseUrl, serviceKey } = getSupabaseConfig();

  if (!supabaseUrl.startsWith('http')) {
    return NextResponse.json(
      { ok: false, error: `SUPABASE_URL missing/invalid: "${supabaseUrl}"` },
      { status: 500 }
    );
  }

  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || payload.reset !== true) {
    return NextResponse.json(
      { ok: false, error: 'Invalid payload: add {"reset": true}' },
      { status: 400 }
    );
  }

  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const updates = Object.entries(PAPER_BOT_DEFAULTS).map(([bot_id, balance]) => ({
    bot_id,
    paper_balance_usd: balance,
    paper_pnl_usd: 0,
    updated_at: new Date().toISOString()
  }));

  try {
    const { error } = await client
      .from('bot_settings')
      .upsert(updates, { onConflict: 'bot_id' });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
