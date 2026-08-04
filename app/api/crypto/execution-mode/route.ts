// GET  /api/crypto/execution-mode
// POST /api/crypto/execution-mode  { "mode": "PAPER" | "LIVE" }
//
// Reads/writes the global crypto execution mode for all four 5-minute bots:
//   btc_5m_late, eth_5m_paper, sol_5m_paper, xrp_5m_paper
//
// Stored in:
//   bot_settings WHERE bot_id = 'crypto_paper'
//   strategy_settings.crypto_execution_mode = 'PAPER' | 'LIVE'
//
// Default: 'PAPER' — always returns PAPER on missing row/field (fail-safe).
//
// PRESERVED (never altered by this route):
//   - is_enabled, arm_live, trade_size_usd on all bot rows
//   - paper_balance_usd, paper_pnl_usd
//   - LIVE positions, LIVE bankroll
//   - wallet secrets (never exposed here)
//   - Copy Trading data

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE   = { 'Cache-Control': 'no-store, max-age=0' };
const ACCOUNT_ID = 'crypto_paper';
const CRYPTO_BOT_IDS = ['btc_5m_late', 'eth_5m_paper', 'sol_5m_paper', 'xrp_5m_paper'];
type ExecMode = 'PAPER' | 'LIVE';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function readModeFromSS(ss: Record<string, unknown> | null | undefined): ExecMode {
  const raw = (ss?.crypto_execution_mode as string | undefined)?.toUpperCase();
  return raw === 'LIVE' ? 'LIVE' : 'PAPER';
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service client unavailable' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // Fetch shared account row + bot rows + live master + open positions
    const [accountRes, botRes, liveMasterRes, paperPosRes, livePosRes] = await Promise.all([
      client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', ACCOUNT_ID)
        .maybeSingle(),

      client
        .from('bot_settings')
        .select('bot_id, is_enabled, arm_live, mode')
        .in('bot_id', CRYPTO_BOT_IDS),

      client
        .from('bot_settings')
        .select('is_enabled')
        .eq('bot_id', 'live')
        .maybeSingle(),

      // Existing PAPER open positions
      client
        .from('paper_positions')
        .select('id, bot_id', { count: 'exact', head: false })
        .in('bot_id', CRYPTO_BOT_IDS)
        .eq('status', 'OPEN'),

      // Existing LIVE open positions
      client
        .from('paper_positions')
        .select('id, bot_id', { count: 'exact', head: false })
        .in('bot_id', CRYPTO_BOT_IDS)
        .eq('status', 'LIVE_OPEN'),
    ]);

    const ss = accountRes.data?.strategy_settings as Record<string, unknown> | null;
    const currentMode = readModeFromSS(ss);

    // Live master state
    const liveMasterRow = liveMasterRes.data as { is_enabled: boolean } | null;
    const liveMasterEnabled = liveMasterRow?.is_enabled ?? false;

    // Per-bot state (arm_live)
    type BotRow = { bot_id: string; is_enabled: boolean; arm_live: boolean; mode: string };
    const botRows = (botRes.data ?? []) as BotRow[];
    const enabledBots = botRows.filter((r) => r.is_enabled).map((r) => r.bot_id);
    const armedBots   = botRows.filter((r) => r.arm_live).map((r) => r.bot_id);

    // Open position counts
    const paperOpenPositions = (paperPosRes.data ?? []).length;
    const liveOpenPositions  = (livePosRes.data  ?? []).length;

    return NextResponse.json(
      {
        ok:                     true,
        mode:                   currentMode,
        account_id:             ACCOUNT_ID,
        live_master_enabled:    liveMasterEnabled,
        emergency_stop:         null,   // read from copy_global_settings (worker-side only)
        enabled_bots:           enabledBots,
        armed_bots:             armedBots,
        paper_open_positions:   paperOpenPositions,
        live_open_positions:    liveOpenPositions,
        note_live_redemption:   'Automatic CLOB redemption is not implemented. Winning LIVE positions must be redeemed manually via Polymarket.',
      },
      { headers: NO_CACHE }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[execution-mode GET] error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service client unavailable' },
      { status: 500, headers: NO_CACHE }
    );
  }

  // ── Parse + validate body ──────────────────────────────────────────────────
  let newMode: ExecMode;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const raw  = (body?.mode as string | undefined)?.toUpperCase();
    if (raw !== 'PAPER' && raw !== 'LIVE') {
      return NextResponse.json(
        { ok: false, error: 'mode must be "PAPER" or "LIVE".' },
        { status: 400, headers: NO_CACHE }
      );
    }
    newMode = raw;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Request body must be valid JSON: { "mode": "PAPER" | "LIVE" }' },
      { status: 400, headers: NO_CACHE }
    );
  }

  try {
    // ── Read current mode ──────────────────────────────────────────────────
    const { data: currentRow } = await client
      .from('bot_settings')
      .select('strategy_settings')
      .eq('bot_id', ACCOUNT_ID)
      .maybeSingle();

    const existingSS = (currentRow?.strategy_settings as Record<string, unknown> | null) ?? {};
    const previousMode = readModeFromSS(existingSS);
    const newSS = { ...existingSS, crypto_execution_mode: newMode };

    if (currentRow) {
      await client
        .from('bot_settings')
        .update({ strategy_settings: newSS, updated_at: new Date().toISOString() })
        .eq('bot_id', ACCOUNT_ID);
    } else {
      // Create the shared account row if missing (safe default)
      await client.from('bot_settings').insert({
        bot_id:            ACCOUNT_ID,
        is_enabled:        false,
        mode:              'PAPER',
        arm_live:          false,
        trade_size_usd:    0,
        paper_balance_usd: 1000,
        paper_pnl_usd:     0,
        strategy_settings: newSS,
      });
    }

    // Fetch which bots are currently enabled
    const { data: botData } = await client
      .from('bot_settings')
      .select('bot_id, is_enabled')
      .in('bot_id', CRYPTO_BOT_IDS);

    const enabledBots = ((botData ?? []) as { bot_id: string; is_enabled: boolean }[])
      .filter((r) => r.is_enabled)
      .map((r) => r.bot_id);

    console.info(
      `[execution-mode POST] mode changed: ${previousMode} → ${newMode} ` +
      `enabled_bots=${JSON.stringify(enabledBots)}`
    );

    return NextResponse.json(
      {
        ok:            true,
        mode:          newMode,
        previous_mode: previousMode,
        enabled_bots:  enabledBots,
      },
      { headers: NO_CACHE }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[execution-mode POST] error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
