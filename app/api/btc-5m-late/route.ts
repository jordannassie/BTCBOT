// GET + POST /api/btc-5m-late
//
// Narrowly-scoped toggle for the BTC 5-minute late-entry strategy.
//
// bot_id is hardcoded to 'btc_5m_late'.
// mode is always forced to 'PAPER'.
// arm_live is always forced to false.
//
// GET — returns the current row (or safe defaults if the row doesn't exist yet).
//
// POST { is_enabled: boolean, test_mode?: boolean, trade_size_usd?: number }
//   • is_enabled (required): enable or disable the strategy.
//   • test_mode  (optional): when true, merges { test_mode: true, paper_test_mode: true }
//     into strategy_settings JSONB and forces trade_size_usd = 0.10.
//   • trade_size_usd (optional): override trade size; ignored if test_mode=true (forced to 0.10).
//   • If the row exists: updates is_enabled, mode=PAPER, arm_live=false.
//     All other columns preserved (unless test_mode overrides).
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
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd, strategy_settings')
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

  // is_enabled — optional. Validated only when present.
  const hasIsEnabled = 'is_enabled' in body;
  if (hasIsEnabled && body.is_enabled !== true && body.is_enabled !== false) {
    return NextResponse.json(
      { ok: false, error: 'is_enabled must be a boolean' },
      { status: 400, headers: NO_CACHE }
    );
  }
  const isEnabled = hasIsEnabled ? (body.is_enabled as boolean) : null;

  // test_mode — optional boolean; forces trade_size_usd=0.10 when true
  const testMode = body.test_mode === true;

  // trade_size_usd — optional. Validated only when present.
  const hasSizeField = 'trade_size_usd' in body;
  if (hasSizeField) {
    const checkSize = Number(body.trade_size_usd);
    if (!Number.isFinite(checkSize) || checkSize <= 0) {
      return NextResponse.json(
        { ok: false, error: 'trade_size_usd must be a positive number' },
        { status: 400, headers: NO_CACHE }
      );
    }
  }
  const rawSize = body.trade_size_usd;
  const tradeSizeOverride = testMode
    ? 0.10
    : (typeof rawSize === 'number' && rawSize > 0 ? rawSize : null);

  const now = new Date().toISOString();

  try {
    // Read existing row to preserve all other fields
    const { data: existing } = await client
      .from('bot_settings')
      .select('*')
      .eq('bot_id', BOT_ID)
      .maybeSingle();

    // Merge test_mode into existing strategy_settings JSONB when requested
    let strategySettings: Record<string, unknown> = {};
    if (existing && existing.strategy_settings && typeof existing.strategy_settings === 'object') {
      strategySettings = { ...(existing.strategy_settings as Record<string, unknown>) };
    }
    if (testMode) {
      // Both keys so the worker reads correctly regardless of which key it checks
      strategySettings = { ...strategySettings, test_mode: true, paper_test_mode: true };
    }

    // Upsert: always force mode=PAPER, arm_live=false; only write fields that were sent
    const upsertPayload: Record<string, unknown> = {
      ...(existing ?? SAFE_DEFAULTS),  // preserve everything else
      bot_id:            BOT_ID,        // locked
      mode:              'PAPER',       // forced
      arm_live:          false,         // forced
      strategy_settings: strategySettings,
      updated_at:        now,
    };
    // Only overwrite is_enabled when it was explicitly supplied in the request
    if (isEnabled !== null) {
      upsertPayload.is_enabled = isEnabled;
    }
    if (tradeSizeOverride !== null) {
      upsertPayload.trade_size_usd = tradeSizeOverride;
    }

    const { data, error } = await client
      .from('bot_settings')
      .upsert(upsertPayload, { onConflict: 'bot_id' })
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd, strategy_settings')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    console.info(
      `BTC_5M_LATE is_enabled=${isEnabled ?? 'unchanged'} mode=PAPER arm_live=false ` +
      `test_mode=${testMode} trade_size_usd=${tradeSizeOverride ?? 'unchanged'} ts=${now}`
    );

    return NextResponse.json({
      ok: true,
      settings: data,
      test_mode_activated: testMode,
    }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
