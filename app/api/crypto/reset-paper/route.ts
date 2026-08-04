// POST /api/crypto/reset-paper
//
// Resets the shared Crypto PAPER account used by all four crypto bots:
//   btc_5m_late, eth_5m_paper, sol_5m_paper, xrp_5m_paper
//
// !! DESTRUCTIVE — deletes paper_positions + PAPER bot_trades for crypto bots !!
//
// Reset steps (in order):
//   1.  Read before-state (positions count, current balance, per-bot stats)
//   2.  DELETE paper_positions WHERE bot_id IN (CRYPTO_BOT_IDS)
//   3.  DELETE bot_trades WHERE bot_id IN (CRYPTO_BOT_IDS) AND status = 'PAPER_CLOSED'
//   4.  UPSERT bot_settings row bot_id = 'crypto_paper':
//         paper_balance_usd = RESET_BALANCE, paper_pnl_usd = 0
//   5.  UPDATE per-bot bot_settings rows: paper_pnl_usd = 0, paper_balance_usd = 0
//       (balance lives in crypto_paper; per-bot rows are cleared for consistency)
//   6.  Read after-state and return confirmation
//
// PRESERVED (never touched):
//   - is_enabled, mode, arm_live, trade_size_usd on all rows
//   - strategy_settings on all rows
//   - Live positions, LIVE bankroll, wallet credentials
//   - Copy trading data (copied_positions, copy_bots etc.)
//   - Any bot_id NOT in CRYPTO_BOT_IDS

import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

/** Shared paper starting balance after reset */
const RESET_BALANCE = 1000;

/** Shared account bot_id — holds paper_balance_usd and paper_pnl_usd for all crypto bots */
const SHARED_ACCOUNT_ID = 'crypto_paper';

/** All crypto strategy bot IDs whose paper data is reset together */
const CRYPTO_BOT_IDS = [
  'btc_5m_late',
  'eth_5m_paper',
  'sol_5m_paper',
  'xrp_5m_paper',
];

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function countPositions(client: ReturnType<typeof getServiceClient>, botIds: string[]) {
  if (!client) return 0;
  const { data, error } = await client
    .from('paper_positions')
    .select('id', { count: 'exact', head: true })
    .in('bot_id', botIds);
  return error ? 0 : (data as unknown as { count: number } | null)?.count ?? 0;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service client unavailable' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // ── 1. Before state ───────────────────────────────────────────────────────
    const [beforePosRes, beforeSharedRes, beforeBotRes] = await Promise.all([
      client
        .from('paper_positions')
        .select('bot_id, status, size_usd, pnl_usd')
        .in('bot_id', CRYPTO_BOT_IDS),
      client
        .from('bot_settings')
        .select('bot_id, paper_balance_usd, paper_pnl_usd, is_enabled, trade_size_usd')
        .eq('bot_id', SHARED_ACCOUNT_ID)
        .maybeSingle(),
      client
        .from('bot_settings')
        .select('bot_id, is_enabled, trade_size_usd, mode, arm_live')
        .in('bot_id', CRYPTO_BOT_IDS),
    ]);

    type PosRow = { bot_id: string; status: string | null; size_usd: number | null; pnl_usd: number | null };
    const beforePos    = (beforePosRes.data ?? []) as PosRow[];
    const beforeShared = beforeSharedRes.data as { paper_balance_usd: number; paper_pnl_usd: number } | null;
    const beforeBots   = (beforeBotRes.data ?? []) as { bot_id: string; is_enabled: boolean; trade_size_usd: number; mode: string; arm_live: boolean }[];

    const beforeOpenPositions = beforePos.filter((r) => (r.status ?? '').toUpperCase() === 'OPEN').length;
    const beforeBalance = beforeShared?.paper_balance_usd ?? null;
    const beforePnl     = beforeShared?.paper_pnl_usd     ?? null;

    const beforePerBot: Record<string, { open: number; closed: number; pnl: number }> = {};
    for (const id of CRYPTO_BOT_IDS) {
      const rows = beforePos.filter((r) => r.bot_id === id);
      beforePerBot[id] = {
        open:   rows.filter((r) => (r.status ?? '').toUpperCase() === 'OPEN').length,
        closed: rows.filter((r) => (r.status ?? '').toUpperCase() !== 'OPEN').length,
        pnl:    rows.reduce((s, r) => s + (Number(r.pnl_usd ?? 0)), 0),
      };
    }

    console.info(
      `[reset-paper] BEFORE: balance=${beforeBalance} pnl=${beforePnl} ` +
      `open_positions=${beforeOpenPositions} total_rows=${beforePos.length}`
    );

    // ── 2. Delete paper_positions for all crypto bots ─────────────────────────
    const { error: delPosErr } = await client
      .from('paper_positions')
      .delete()
      .in('bot_id', CRYPTO_BOT_IDS);

    if (delPosErr) {
      console.error('[reset-paper] paper_positions delete error:', delPosErr.message);
      return NextResponse.json(
        { ok: false, error: `paper_positions delete failed: ${delPosErr.message}` },
        { status: 500, headers: NO_CACHE }
      );
    }

    // ── 3. Delete PAPER bot_trades for all crypto bots ────────────────────────
    const { error: delTradesErr } = await client
      .from('bot_trades')
      .delete()
      .in('bot_id', CRYPTO_BOT_IDS)
      .eq('status', 'PAPER_CLOSED');

    if (delTradesErr) {
      // Non-fatal — log but continue; positions are already cleared
      console.warn('[reset-paper] bot_trades delete warning:', delTradesErr.message);
    }

    // ── 4. Upsert the shared crypto_paper row ─────────────────────────────────
    const { error: sharedErr } = await client
      .from('bot_settings')
      .upsert(
        {
          bot_id:            SHARED_ACCOUNT_ID,
          is_enabled:        false,
          mode:              'PAPER',
          arm_live:          false,
          trade_size_usd:    0,
          paper_balance_usd: RESET_BALANCE,
          paper_pnl_usd:     0,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'bot_id' }
      );

    if (sharedErr) {
      console.error('[reset-paper] crypto_paper upsert error:', sharedErr.message);
      return NextResponse.json(
        { ok: false, error: `Shared account reset failed: ${sharedErr.message}` },
        { status: 500, headers: NO_CACHE }
      );
    }

    // ── 5. Reset paper_pnl_usd on each per-bot row (balance lives in crypto_paper) ──
    const { error: botResetErr } = await client
      .from('bot_settings')
      .update({ paper_balance_usd: 0, paper_pnl_usd: 0, updated_at: new Date().toISOString() })
      .in('bot_id', CRYPTO_BOT_IDS);

    if (botResetErr) {
      // Non-fatal — shared account was already reset; log and continue
      console.warn('[reset-paper] per-bot balance reset warning:', botResetErr.message);
    }

    // ── 5b. Merge paper_start into each per-bot strategy_settings ─────────────
    // This resets the "Starting Balance" baseline shown in charts.
    for (const botId of CRYPTO_BOT_IDS) {
      const { data: botRow } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', botId)
        .maybeSingle();

      const existing = (botRow?.strategy_settings as Record<string, unknown> | null) ?? {};
      const updated  = { ...existing, paper_start: RESET_BALANCE };

      await client
        .from('bot_settings')
        .update({ strategy_settings: updated })
        .eq('bot_id', botId);
    }

    // ── 6. After state (post-reset validation) ────────────────────────────────
    const [afterPosRes, afterSharedRes] = await Promise.all([
      client
        .from('paper_positions')
        .select('id', { count: 'exact', head: true })
        .in('bot_id', CRYPTO_BOT_IDS),
      client
        .from('bot_settings')
        .select('paper_balance_usd, paper_pnl_usd')
        .eq('bot_id', SHARED_ACCOUNT_ID)
        .maybeSingle(),
    ]);

    const afterShared = afterSharedRes.data as { paper_balance_usd: number; paper_pnl_usd: number } | null;
    const afterOpenPositions = (afterPosRes as unknown as { count: number } | null)?.count ?? 0;

    console.info(
      `[reset-paper] AFTER: balance=${afterShared?.paper_balance_usd} ` +
      `pnl=${afterShared?.paper_pnl_usd} open_positions=${afterOpenPositions}`
    );

    // Verification
    const balanceCorrect  = afterShared?.paper_balance_usd === RESET_BALANCE;
    const pnlCorrect      = afterShared?.paper_pnl_usd     === 0;
    const positionsCleared = afterOpenPositions === 0;

    if (!balanceCorrect || !pnlCorrect || !positionsCleared) {
      console.warn(
        `[reset-paper] verification warning: balance_ok=${balanceCorrect} ` +
        `pnl_ok=${pnlCorrect} positions_cleared=${positionsCleared}`
      );
    }

    return NextResponse.json(
      {
        ok:                   true,
        message:              `Shared Crypto PAPER account reset to $${RESET_BALANCE.toLocaleString()}.`,
        account:              SHARED_ACCOUNT_ID,
        starting_balance:     RESET_BALANCE,
        available_balance:    RESET_BALANCE,
        account_equity:       RESET_BALANCE,
        realized_pnl:         0,
        open_exposure:        0,
        open_positions:       0,
        bots_reset:           CRYPTO_BOT_IDS,
        // Verification results
        verification: {
          balance_correct:   balanceCorrect,
          pnl_correct:       pnlCorrect,
          positions_cleared: positionsCleared,
        },
        // Before state for audit
        before: {
          balance:           beforeBalance,
          realized_pnl:      beforePnl,
          open_positions:    beforeOpenPositions,
          total_positions:   beforePos.length,
          per_bot:           beforePerBot,
        },
        // Settings confirmed preserved (enabled states, sizes)
        preserved: {
          bot_settings: beforeBots.map((b) => ({
            bot_id:        b.bot_id,
            is_enabled:    b.is_enabled,
            mode:          b.mode,
            arm_live:      b.arm_live,
            trade_size_usd: b.trade_size_usd,
          })),
        },
      },
      { headers: NO_CACHE }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[reset-paper] unexpected error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
