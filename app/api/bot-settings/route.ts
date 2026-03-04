import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_BOT_IDS = new Set([
  'default',
  'live',
  'paper_fastloop',
  'paper_sniper',
  'paper_copy',
  'paper_scalper'
]);

function getSupabase() {
  let supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (supabaseUrl.startsWith('$')) supabaseUrl = '';
  return { supabaseUrl, serviceKey };
}

export async function GET(request: Request) {
  const { supabaseUrl, serviceKey } = getSupabase();

  if (!supabaseUrl.startsWith('http')) {
    return NextResponse.json(
      { ok: false, error: `SUPABASE_URL missing/invalid: "${supabaseUrl}"` },
      { status: 500 }
    );
  }
  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const botId = searchParams.get('bot_id') || 'default';

  try {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data, error } = await client
      .from('bot_settings')
      .select('*')
      .eq('bot_id', botId)
      .limit(1)
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: `bot_settings row not found for bot_id=${botId}` },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, settings: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { supabaseUrl, serviceKey } = getSupabase();

  if (!supabaseUrl.startsWith('http')) {
    return NextResponse.json(
      { ok: false, error: `SUPABASE_URL missing/invalid: "${supabaseUrl}"` },
      { status: 500 }
    );
  }
  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 });
  }

  try {
    const payload = await request.json();
    const {
      bot_id,
      is_enabled,
      mode,
      edge_threshold,
      trade_size,
      max_trades_per_hour,
      paper_balance_usd,
      arm_live,
      strategy_settings
    } = payload;

    if (!bot_id || !ALLOWED_BOT_IDS.has(bot_id)) {
      return NextResponse.json({ ok: false, error: 'Invalid bot_id.' }, { status: 400 });
    }

    if (mode != null && mode !== 'PAPER' && mode !== 'LIVE') {
      return NextResponse.json({ ok: false, error: 'Mode must be PAPER or LIVE.' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (is_enabled != null) updates.is_enabled = is_enabled;
    if (mode != null) updates.mode = mode;
    if (edge_threshold != null) updates.edge_threshold = edge_threshold;
    if (trade_size != null) updates.trade_size_usd = trade_size;
    if (max_trades_per_hour != null) updates.max_trades_per_hour = max_trades_per_hour;
    if (typeof paper_balance_usd === 'number') {
      updates.paper_balance_usd = Math.round(paper_balance_usd * 100) / 100;
    }
    if (typeof arm_live === 'boolean') {
      updates.arm_live = arm_live;
    }

    if (
      bot_id === 'paper_scalper' &&
      strategy_settings &&
      typeof strategy_settings === 'object' &&
      !Array.isArray(strategy_settings)
    ) {
      const { data: existing } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', bot_id)
        .limit(1)
        .single();
      const mergedStrategySettings = {
        ...(existing?.strategy_settings ?? {}),
        ...strategy_settings
      };
      updates.strategy_settings = mergedStrategySettings;
    }

    const { data, error } = await client
      .from('bot_settings')
      .upsert({ bot_id, ...updates }, { onConflict: 'bot_id' })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, settings: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
