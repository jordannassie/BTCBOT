// GET + PATCH /api/crypto/btc-5m/settings
//
// Narrowly-scoped route for the btc_5m_late bot settings toggle.
//
// GET  — returns is_enabled, mode, arm_live, trade_size_usd for btc_5m_late.
//
// PATCH { is_enabled: boolean }
//   — updates ONLY is_enabled for bot_id = 'btc_5m_late'.
//   — does NOT change mode, arm_live, trade_size_usd, strategy_settings,
//     paper_balance_usd, or any other field.
//
// NEVER touches copy_bots, copied_positions, LIVE settings, or ARM LIVE.
// NEVER accepts bot_id, mode, or arm_live from the client.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const BOT_ID   = 'btc_5m_late';
const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    const { data, error } = await client
      .from('bot_settings')
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, strategy_settings')
      .eq('bot_id', BOT_ID)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    if (!data) {
      return NextResponse.json({
        ok: true,
        settings: { bot_id: BOT_ID, is_enabled: false, mode: 'PAPER', arm_live: false, trade_size_usd: 0.10 },
        exists: false,
      }, { headers: NO_CACHE });
    }

    return NextResponse.json({ ok: true, settings: data, exists: true }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: NO_CACHE }); }

  // Only is_enabled is accepted from the client
  const rawEnabled = body.is_enabled;
  if (rawEnabled !== true && rawEnabled !== false) {
    return NextResponse.json(
      { ok: false, error: 'is_enabled must be a boolean' },
      { status: 400, headers: NO_CACHE }
    );
  }
  const isEnabled = rawEnabled as boolean;

  const now = new Date().toISOString();

  try {
    // Update ONLY is_enabled — all other fields preserved as-is
    const { data, error } = await client
      .from('bot_settings')
      .update({ is_enabled: isEnabled, updated_at: now })
      .eq('bot_id', BOT_ID)
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    console.info(`BTC_5M_LATE_TOGGLE is_enabled=${isEnabled} ts=${now}`);

    return NextResponse.json({ ok: true, settings: data }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
