// GET /api/crypto-5m?bot_id=eth_5m_paper|sol_5m_paper|xrp_5m_paper
// POST /api/crypto-5m  { bot_id, is_enabled, trade_size_usd? }
//
// Generic settings endpoint for ETH, SOL and XRP 5-minute paper bots.
// Mirrors /api/btc-5m-late exactly — same structure, same safety guarantees.
//
// GET — returns the current bot_settings row (or safe defaults if absent).
// POST — updates is_enabled and optionally trade_size_usd.
//        Always forces mode=PAPER, arm_live=false.
//
// NEVER touches LIVE settings, BTC data, or copy-trading rows.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

// Supported bot IDs — only these may be toggled via this endpoint.
const ALLOWED_BOT_IDS = new Set(['eth_5m_paper', 'sol_5m_paper', 'xrp_5m_paper']);

const DEFAULT_TRADE_SIZE: Record<string, number> = {
  eth_5m_paper: 0.10,
  sol_5m_paper: 0.10,
  xrp_5m_paper: 0.10,
};

function safeDefaults(botId: string) {
  return {
    bot_id:            botId,
    mode:              'PAPER',
    arm_live:          false,
    trade_size_usd:    DEFAULT_TRADE_SIZE[botId] ?? 0.10,
    paper_balance_usd: 100,
    is_enabled:        false,
  };
}

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url   = new URL(request.url);
  const botId = url.searchParams.get('bot_id') ?? '';

  if (!ALLOWED_BOT_IDS.has(botId)) {
    return NextResponse.json(
      { ok: false, error: `bot_id must be one of: ${[...ALLOWED_BOT_IDS].join(', ')}` },
      { status: 400, headers: NO_CACHE }
    );
  }

  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    const { data, error } = await client
      .from('bot_settings')
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd, paper_pnl_usd, strategy_settings')
      .eq('bot_id', botId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    if (!data) {
      return NextResponse.json({ ok: true, settings: safeDefaults(botId), created: false }, { headers: NO_CACHE });
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
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: NO_CACHE }); }

  const botId = String(body.bot_id ?? '');
  if (!ALLOWED_BOT_IDS.has(botId)) {
    return NextResponse.json(
      { ok: false, error: `bot_id must be one of: ${[...ALLOWED_BOT_IDS].join(', ')}` },
      { status: 400, headers: NO_CACHE }
    );
  }

  // is_enabled — optional. Validated only when present in the body.
  const hasIsEnabled = 'is_enabled' in body;
  if (hasIsEnabled && body.is_enabled !== true && body.is_enabled !== false) {
    return NextResponse.json(
      { ok: false, error: 'is_enabled must be a boolean' },
      { status: 400, headers: NO_CACHE }
    );
  }
  const isEnabled = hasIsEnabled ? (body.is_enabled as boolean) : null;

  // trade_size_usd — optional. Validated only when present.
  if ('trade_size_usd' in body) {
    const checkSize = Number(body.trade_size_usd);
    if (!Number.isFinite(checkSize) || checkSize <= 0) {
      return NextResponse.json(
        { ok: false, error: 'trade_size_usd must be a positive number' },
        { status: 400, headers: NO_CACHE }
      );
    }
  }
  const rawSize = body.trade_size_usd;
  const tradeSizeOverride = (typeof rawSize === 'number' && rawSize > 0) ? rawSize : null;

  const now = new Date().toISOString();

  try {
    const { data: existing } = await client
      .from('bot_settings')
      .select('*')
      .eq('bot_id', botId)
      .maybeSingle();

    const upsertPayload: Record<string, unknown> = {
      ...(existing ?? safeDefaults(botId)),
      bot_id:    botId,
      mode:      'PAPER',   // forced
      arm_live:  false,     // forced
      updated_at: now,
    };
    // Only overwrite is_enabled when explicitly supplied
    if (isEnabled !== null) {
      upsertPayload.is_enabled = isEnabled;
    }
    if (tradeSizeOverride !== null) {
      upsertPayload.trade_size_usd = tradeSizeOverride;
    }

    const { data, error } = await client
      .from('bot_settings')
      .upsert(upsertPayload, { onConflict: 'bot_id' })
      .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd, paper_pnl_usd, strategy_settings')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    console.info(
      `CRYPTO5M bot_id=${botId} is_enabled=${isEnabled ?? 'unchanged'} mode=PAPER ` +
      `trade_size_usd=${tradeSizeOverride ?? 'unchanged'} ts=${now}`
    );

    return NextResponse.json({ ok: true, settings: data }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
