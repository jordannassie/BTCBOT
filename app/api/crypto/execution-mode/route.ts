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
    // Fetch shared account row + bot rows + live master + open positions + emergency stop
    const [accountRes, botRes, liveMasterRes, paperPosRes, livePosRes, globalSettingsRes] = await Promise.all([
      client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', ACCOUNT_ID)
        .maybeSingle(),

      client
        .from('bot_settings')
        .select('bot_id, is_enabled, arm_live, mode, trade_size_usd')
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

      // Emergency stop (for live_ready computation)
      client
        .from('copy_global_settings')
        .select('emergency_stop')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    const ss = accountRes.data?.strategy_settings as Record<string, unknown> | null;
    const currentMode            = readModeFromSS(ss);
    const cryptoLiveMasterEnabled = (ss?.crypto_live_master_enabled as boolean | undefined) ?? false;

    // Global live master (for display/diagnostic only — crypto uses its own)
    const liveMasterRow = liveMasterRes.data as { is_enabled: boolean } | null;
    const globalLiveMasterEnabled = liveMasterRow?.is_enabled ?? false;

    // Per-bot state (arm_live)
    type BotRow = { bot_id: string; is_enabled: boolean; arm_live: boolean; mode: string; trade_size_usd: number };
    const botRows = (botRes.data ?? []) as BotRow[];
    const enabledBots = botRows.filter((r) => r.is_enabled).map((r) => r.bot_id);
    const armedBots   = botRows.filter((r) => r.arm_live).map((r) => r.bot_id);

    // Open position counts
    const paperOpenPositions = (paperPosRes.data ?? []).length;
    const liveOpenPositions  = (livePosRes.data  ?? []).length;

    // Live readiness — safe to expose (no secrets, no trade logic)
    const emergencyStop = (globalSettingsRes.data as { emergency_stop: boolean } | null)?.emergency_stop ?? false;
    const badSizeBots   = botRows
      .filter((r) => r.is_enabled && (!r.trade_size_usd || r.trade_size_usd <= 0))
      .map((r) => r.bot_id);
    const liveReady          = !emergencyStop && badSizeBots.length === 0;
    const liveNotReadyReason = emergencyStop
      ? 'emergency_stop_active'
      : badSizeBots.length > 0
      ? `invalid_trade_size:${badSizeBots.join(',')}`
      : null;

    // is_live_active = mode is LIVE AND all four bot rows confirm arm_live=true
    const allFourArmedGet = CRYPTO_BOT_IDS.every((id) =>
      botRows.find((r) => r.bot_id === id)?.arm_live === true
    );
    const isLiveActiveGet = currentMode === 'LIVE' && allFourArmedGet;

    return NextResponse.json(
      {
        ok:                           true,
        mode:                         currentMode,
        is_live_active:               isLiveActiveGet,
        account_id:                   ACCOUNT_ID,
        crypto_live_master_enabled:   cryptoLiveMasterEnabled,
        global_live_master_enabled:   globalLiveMasterEnabled,
        emergency_stop:               emergencyStop,
        live_ready:                   liveReady,
        live_not_ready_reason:        liveNotReadyReason,
        enabled_bots:                 enabledBots,
        armed_bots:                   armedBots,
        paper_open_positions:         paperOpenPositions,
        live_open_positions:          liveOpenPositions,
        // Redemption status
        automatic_redemption_enabled:  false,
        pending_redeemable_positions:  liveOpenPositions,
        note_live_redemption:
          'Automatic CLOB redemption is not implemented. ' +
          'Winning LIVE positions must be redeemed manually via Polymarket UI.',
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
//
// Atomic PAPER↔LIVE transition.
//
// PAPER → LIVE:
//   1. LIVE readiness validation (emergency stop, trade sizes)
//   2. crypto_paper.strategy_settings.crypto_execution_mode = 'LIVE'
//   3. crypto_paper.strategy_settings.crypto_live_master_enabled = true
//   4. bot_settings.arm_live = true for all four crypto bots
//
// LIVE → PAPER:
//   1. crypto_paper.strategy_settings.crypto_execution_mode = 'PAPER'
//   2. crypto_paper.strategy_settings.crypto_live_master_enabled = false
//   3. bot_settings.arm_live = false for all four crypto bots
//
// If any write fails: rolls back the crypto_paper row and returns error.
// Existing PAPER OPEN / LIVE_OPEN positions are never touched.

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service client unavailable' },
      { status: 500, headers: NO_CACHE }
    );
  }

  // ── 0. Parse + validate body ───────────────────────────────────────────────
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

  const goingLive = newMode === 'LIVE';
  const armValue  = goingLive;

  try {
    // ── 1. Read current state ──────────────────────────────────────────────
    const [accountRes, botRes, globalSettingsRes, paperPosRes, livePosRes] = await Promise.all([
      client
        .from('bot_settings')
        .select('strategy_settings, paper_balance_usd, paper_pnl_usd')
        .eq('bot_id', ACCOUNT_ID)
        .maybeSingle(),

      client
        .from('bot_settings')
        .select('bot_id, is_enabled, arm_live, trade_size_usd')
        .in('bot_id', CRYPTO_BOT_IDS),

      client
        .from('copy_global_settings')
        .select('emergency_stop')
        .eq('id', 1)
        .maybeSingle(),

      // Count existing PAPER OPEN positions (not touched by this operation)
      client
        .from('paper_positions')
        .select('id')
        .in('bot_id', CRYPTO_BOT_IDS)
        .eq('status', 'OPEN'),

      // Count existing LIVE_OPEN positions (not touched by this operation)
      client
        .from('paper_positions')
        .select('id')
        .in('bot_id', CRYPTO_BOT_IDS)
        .eq('status', 'LIVE_OPEN'),
    ]);

    type BotRow = { bot_id: string; is_enabled: boolean; arm_live: boolean; trade_size_usd: number };
    const existingSS   = (accountRes.data?.strategy_settings as Record<string, unknown> | null) ?? {};
    const previousMode = readModeFromSS(existingSS);
    const botRows      = (botRes.data ?? []) as BotRow[];
    const emergency    = (globalSettingsRes.data as { emergency_stop: boolean } | null)?.emergency_stop ?? false;

    const existingPaperOpen = (paperPosRes.data ?? []).length;
    const existingLiveOpen  = (livePosRes.data  ?? []).length;

    // ── 2. LIVE readiness validation ───────────────────────────────────────
    if (goingLive) {
      // 2a: Emergency stop check
      if (emergency) {
        const reason = 'emergency_stop_active';
        console.warn(`[execution-mode POST] LIVE blocked: ${reason}`);
        return NextResponse.json(
          { ok: false, error: reason, blocking_reason: reason },
          { status: 409, headers: NO_CACHE }
        );
      }

      // 2b: All ENABLED crypto bots must have valid trade sizes
      const badSizeBots = botRows
        .filter((r) => r.is_enabled && (!r.trade_size_usd || r.trade_size_usd <= 0))
        .map((r) => r.bot_id);

      if (badSizeBots.length > 0) {
        const reason = `invalid_trade_size for bots: ${badSizeBots.join(', ')}`;
        console.warn(`[execution-mode POST] LIVE blocked: ${reason}`);
        return NextResponse.json(
          { ok: false, error: reason, blocking_reason: reason, bad_size_bots: badSizeBots },
          { status: 409, headers: NO_CACHE }
        );
      }

      // 2c: Note — CLOB client init and market discovery can only be validated
      // at the worker level. The worker's 7-gate check in _crypto5m_live_entry
      // will block any entry if CLOB is unavailable, even in LIVE mode.
    }

    // ── 3. Build new strategy_settings (merge, preserve all other keys) ───
    const newSS: Record<string, unknown> = {
      ...existingSS,
      crypto_execution_mode:      newMode,
      crypto_live_master_enabled: armValue,
    };

    // ── 4. Write crypto_paper shared row ──────────────────────────────────
    const ts = new Date().toISOString();

    if (accountRes.data) {
      const { error: ssErr } = await client
        .from('bot_settings')
        .update({ strategy_settings: newSS, updated_at: ts })
        .eq('bot_id', ACCOUNT_ID);

      if (ssErr) {
        const reason = `write_crypto_paper_failed: ${ssErr.message}`;
        console.error('[execution-mode POST] CRYPTO_GLOBAL_MODE_TRANSITION_FAILED:', reason);
        return NextResponse.json(
          { ok: false, error: reason },
          { status: 500, headers: NO_CACHE }
        );
      }
    } else {
      // Create shared account row if missing
      const { error: insErr } = await client.from('bot_settings').insert({
        bot_id:            ACCOUNT_ID,
        is_enabled:        false,
        mode:              'PAPER',
        arm_live:          false,
        trade_size_usd:    0,
        paper_balance_usd: 1000,
        paper_pnl_usd:     0,
        strategy_settings: newSS,
        updated_at:        ts,
      });
      if (insErr) {
        const reason = `create_crypto_paper_failed: ${insErr.message}`;
        return NextResponse.json({ ok: false, error: reason }, { status: 500, headers: NO_CACHE });
      }
    }

    // ── 5. Write arm_live for all four crypto bots, verify each write ─────────
    //
    // Using .select() so Supabase returns the affected rows.
    // data=[] means zero rows matched — the bot_settings row is missing.
    // This is a hard failure — we roll back and surface the exact bot name.
    //
    type ArmRow = { bot_id: string; arm_live: boolean };
    const armErrors:  string[] = [];
    const armedRows:  ArmRow[] = [];

    for (const botId of CRYPTO_BOT_IDS) {
      const { data: updData, error: armErr } = await client
        .from('bot_settings')
        .update({ arm_live: armValue, updated_at: ts })
        .eq('bot_id', botId)
        .select('bot_id, arm_live');

      if (armErr) {
        armErrors.push(`${botId}: ${armErr.message}`);
      } else if (!updData || updData.length === 0) {
        armErrors.push(`${botId}: row not found in bot_settings (0 rows updated)`);
      } else {
        const row = updData[0] as ArmRow;
        if (row.arm_live !== armValue) {
          armErrors.push(`${botId}: write did not persist (expected ${armValue}, got ${row.arm_live})`);
        } else {
          armedRows.push(row);
        }
      }
    }

    if (armErrors.length > 0) {
      // Hard rollback: restore crypto_paper mode AND clear all arm_live writes that succeeded
      const rollbackSS: Record<string, unknown> = {
        ...existingSS,
        crypto_execution_mode:      previousMode,
        crypto_live_master_enabled: !armValue,
      };
      await client
        .from('bot_settings')
        .update({ strategy_settings: rollbackSS, updated_at: ts })
        .eq('bot_id', ACCOUNT_ID);

      // Attempt to undo any partial arm_live changes
      for (const row of armedRows) {
        await client
          .from('bot_settings')
          .update({ arm_live: !armValue, updated_at: ts })
          .eq('bot_id', row.bot_id);
      }

      const reason = `arm_live_write_failed: ${armErrors.join('; ')}`;
      console.error('[execution-mode POST] CRYPTO_GLOBAL_MODE_TRANSITION_FAILED:', reason);
      return NextResponse.json(
        { ok: false, error: reason, failed_bots: armErrors.map((e) => e.split(':')[0].trim()), previous_mode: previousMode },
        { status: 500, headers: NO_CACHE }
      );
    }

    // ── 6. Read final state for response (all writes confirmed above) ─────
    type VerifyRow = { bot_id: string; arm_live: boolean; is_enabled: boolean };
    const { data: verifyRows } = await client
      .from('bot_settings')
      .select('bot_id, arm_live, is_enabled')
      .in('bot_id', CRYPTO_BOT_IDS);

    const verifiedRows: VerifyRow[] = (verifyRows ?? []) as VerifyRow[];
    const enabledBots = verifiedRows.filter((r) => r.is_enabled).map((r) => r.bot_id);
    const armedBots   = verifiedRows.filter((r) => r.arm_live).map((r) => r.bot_id);

    console.info(
      `[execution-mode POST] CRYPTO_GLOBAL_MODE_TRANSITION ` +
      `previous=${previousMode} current=${newMode} ` +
      `live_master=${armValue} armed_bots=${armedBots.length}`
    );

    // is_live_active = mode is LIVE AND all four bot rows confirmed arm_live=true
    const allFourArmed = CRYPTO_BOT_IDS.every((id) =>
      verifiedRows.find((r) => r.bot_id === id)?.arm_live === true
    );
    const isLiveActive = newMode === 'LIVE' && allFourArmed;

    return NextResponse.json(
      {
        ok:                       true,
        previous_mode:            previousMode,
        mode:                     newMode,
        is_live_active:           isLiveActive,
        live_master_enabled:      armValue,   // crypto-specific master
        armed_crypto_bots:        armedBots,
        enabled_crypto_bots:      enabledBots,
        existing_paper_open:      existingPaperOpen,
        existing_live_open:       existingLiveOpen,
        // Redemption status
        automatic_redemption_enabled:   false,
        pending_redeemable_positions:   existingLiveOpen,
        note_live_redemption:
          'Automatic CLOB redemption is not implemented. ' +
          'Winning LIVE positions must be redeemed manually via Polymarket UI.',
        // CLOB readiness note
        note_clob_readiness:
          'CLOB client initialization and market token discovery are validated ' +
          'at entry time by the worker (Gate 1–7 in _crypto5m_live_entry). ' +
          'If CLOB is unavailable, entries will be blocked with CRYPTO_LIVE_ENTRY_BLOCKED.',
      },
      { headers: NO_CACHE }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[execution-mode POST] unexpected error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
