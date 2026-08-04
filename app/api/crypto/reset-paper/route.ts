// POST /api/crypto/reset-paper
//
// Resets the shared crypto PAPER account for all supported strategy bots.
//
// !! DESTRUCTIVE — deletes all paper_positions rows for crypto bots !!
//
// Safe: does NOT touch:
//   - LIVE positions, LIVE bankroll, LIVE history
//   - is_enabled, arm_live, trade_size_usd, mode
//   - Copy trading data (copied_positions, copy_bots, tracked_wallets)
//   - bot_settings fields other than paper_balance_usd and strategy_settings.btc_paper_start
//   - Supabase schema
//
// Reset effect:
//   1. DELETE FROM paper_positions WHERE bot_id IN (CRYPTO_BOT_IDS)
//   2. UPDATE bot_settings SET paper_balance_usd = RESET_BALANCE
//      WHERE bot_id IN (CRYPTO_BOT_IDS)
//   3. Merge btc_paper_start = RESET_BALANCE into btc_5m_late.strategy_settings
//      so the "Starting Balance" display reflects the new baseline
//
// Expected clean state:
//   - Starting balance: $1,000
//   - Current equity:   $1,000
//   - Realized P/L:     $0
//   - Open positions:   0
//   - Total trades:     0
//
// Server-side only — service role key is never exposed to the browser.

import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';

export const dynamic    = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

/** Paper starting balance after reset */
const RESET_BALANCE = 1000;

/**
 * All crypto strategy bot IDs whose paper data is reset together.
 * Add ETH/SOL/XRP bot IDs here when those strategies become active.
 */
const CRYPTO_BOT_IDS = [
  'btc_5m_late',
  // 'eth_5m_paper',  // add when ETH strategy is active
  // 'sol_5m_paper',  // add when SOL strategy is active
  // 'xrp_5m_paper',  // add when XRP strategy is active
];

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase service client unavailable' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // ── 1. Delete all paper positions for crypto bots ────────────────────────
    const { error: deleteErr } = await client
      .from('paper_positions')
      .delete()
      .in('bot_id', CRYPTO_BOT_IDS);

    if (deleteErr) {
      console.error('[reset-paper] delete error:', deleteErr.message);
      return NextResponse.json(
        { ok: false, error: `Delete failed: ${deleteErr.message}` },
        { status: 500, headers: NO_CACHE }
      );
    }

    // ── 2. Fetch current strategy_settings for btc_5m_late ──────────────────
    //    We merge btc_paper_start into it rather than overwriting the whole object.
    const { data: currentRow } = await client
      .from('bot_settings')
      .select('strategy_settings')
      .eq('bot_id', 'btc_5m_late')
      .maybeSingle();

    const existingStrategySettings =
      (currentRow?.strategy_settings as Record<string, unknown> | null) ?? {};

    const newStrategySettings = {
      ...existingStrategySettings,
      btc_paper_start: RESET_BALANCE,
    };

    // ── 3. Reset paper_balance_usd for all crypto bots ───────────────────────
    const { error: updateErr } = await client
      .from('bot_settings')
      .update({ paper_balance_usd: RESET_BALANCE })
      .in('bot_id', CRYPTO_BOT_IDS);

    if (updateErr) {
      console.error('[reset-paper] balance update error:', updateErr.message);
      return NextResponse.json(
        { ok: false, error: `Balance update failed: ${updateErr.message}` },
        { status: 500, headers: NO_CACHE }
      );
    }

    // ── 4. Persist btc_paper_start in strategy_settings for btc_5m_late ─────
    const { error: ssErr } = await client
      .from('bot_settings')
      .update({ strategy_settings: newStrategySettings })
      .eq('bot_id', 'btc_5m_late');

    if (ssErr) {
      // Non-fatal — balance was already reset; just log and continue
      console.warn('[reset-paper] strategy_settings update warning:', ssErr.message);
    }

    return NextResponse.json(
      {
        ok:              true,
        message:         `Crypto paper account reset. Starting balance: $${RESET_BALANCE.toLocaleString()}.`,
        reset_balance:   RESET_BALANCE,
        bots_reset:      CRYPTO_BOT_IDS,
        positions_cleared: true,
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
