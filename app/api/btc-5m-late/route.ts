// GET + POST /api/btc-5m-late
//
// Narrowly-scoped toggle for the BTC 5-minute late-entry strategy.
//
// bot_id is hardcoded to 'btc_5m_late'.
// The client may only supply is_enabled.
// mode is always forced to 'PAPER'.
// arm_live is always forced to false.
//
// GET — returns the current row (or safe defaults if the row doesn't exist yet).
//
// POST { is_enabled: boolean }
//   • If the row exists: updates is_enabled, mode=PAPER, arm_live=false.
//     All other columns (trade_size_usd, paper_balance_usd, strategy_settings …) preserved.
//   • If the row does not exist: upserts with safe defaults.
//
// NEVER touches copy_bots, copied_positions, LIVE settings, or ARM LIVE.
// NEVER accepts bot_id, mode, or arm_live from the client.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const BOT_ID   = 'btc_5m_late';
const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

// Safe defaults used when the row does not yet exist.
const SAFE_DEFAULTS = {
  bot_id:           BOT_ID,
  mode:             'PAPER',
  arm_live:         false,
  trade_size_usd:   1,
  paper_balance_usd: 100,
  is_enabled:       false,
} as const;

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
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd')
      .eq('bot_id', BOT_ID)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    // Row doesn't exist yet — return safe defaults so the UI can show them
    if (!data) {
      return NextResponse.json({ ok: true, settings: SAFE_DEFAULTS, created: false }, { headers: NO_CACHE });
    }

    return NextResponse.json({ ok: true, settings: data, created: true }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
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
    // Read existing row to preserve all other fields
    const { data: existing } = await client
      .from('bot_settings')
      .select('*')
      .eq('bot_id', BOT_ID)
      .maybeSingle();

    // Upsert: always force mode=PAPER, arm_live=false; only is_enabled from client
    const upsertPayload = {
      ...(existing ?? SAFE_DEFAULTS),  // preserve everything else
      bot_id:     BOT_ID,              // locked
      mode:       'PAPER',             // forced
      arm_live:   false,               // forced
      is_enabled: isEnabled,           // client-supplied
      updated_at: now,
    };

    const { data, error } = await client
      .from('bot_settings')
      .upsert(upsertPayload, { onConflict: 'bot_id' })
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    console.info(`BTC_5M_LATE_TOGGLE is_enabled=${isEnabled} mode=PAPER arm_live=false ts=${now}`);

    return NextResponse.json({ ok: true, settings: data }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
