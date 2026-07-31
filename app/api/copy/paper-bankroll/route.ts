// Shared copy-trading paper bankroll.
//
// Stored as a single row in bot_settings with bot_id = 'copy_paper':
//   paper_balance_usd  → current running paper balance for copy trades
//   paper_pnl_usd      → running P&L (for display)
//   strategy_settings  → { paper_default: number }  ← operator-saved default amount
//
// This is completely separate from the BTC strategy paper bots.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BOT_ID = 'copy_paper';
const FALLBACK_DEFAULT = 1000;

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── GET ─────────────────────────────────────────────────────────────────────
// Returns current balance, saved default amount, and combined BTC + copy accounting.
// BTC source: paper_positions WHERE bot_id = 'btc_5m_late' — never includes btc_5m_ema.
// Copy source: copied_positions for open exposure; paper_pnl_usd for realized P/L.
export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

  try {
    const [bankrollRes, copyOpenRes, btcPosRes, botCountRes, cryptoBotRes] = await Promise.all([
      // Existing: copy_paper bankroll row
      client
        .from('bot_settings')
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle(),

      // Copy open exposure: copied_positions OPEN — field is `size` (not size_usd)
      client
        .from('copied_positions')
        .select('status, size')
        .eq('status', 'OPEN'),

      // BTC 5-Min: all btc_5m_late positions for realized P/L + open exposure
      // Never includes btc_5m_ema.
      client
        .from('paper_positions')
        .select('status, size_usd, pnl_usd')
        .eq('bot_id', 'btc_5m_late'),

      // Active copy-trader bots
      client
        .from('copy_bots')
        .select('id', { count: 'exact', head: true })
        .eq('is_enabled', true),

      // Active crypto strategy bots (btc_5m_late only)
      client
        .from('bot_settings')
        .select('is_enabled')
        .eq('bot_id', 'btc_5m_late')
        .eq('is_enabled', true)
        .limit(1),
    ]);

    // ── Copy bankroll ─────────────────────────────────────────────────────────
    const bankrollData = bankrollRes.data;
    const defaultAmount: number =
      (bankrollData?.strategy_settings as { paper_default?: number } | null)?.paper_default ??
      FALLBACK_DEFAULT;
    const startingBalance = defaultAmount;
    // copy_realized_pnl = what FastLoop has tracked via paper_pnl_usd
    const copyRealizedPnl = Number(bankrollData?.paper_pnl_usd ?? 0) || 0;

    // ── Copy open exposure ─────────────────────────────────────────────────────
    type CopyOpenRow = { status: string; size?: number | null };
    const copyOpenRows = (copyOpenRes.data ?? []) as CopyOpenRow[];
    const copyOpenPositions = copyOpenRows.length;
    const copyOpenExposure  = copyOpenRows.reduce(
      (s, r) => s + (Number(r.size ?? 0) || 0), 0
    );

    // ── BTC 5-Min stats (btc_5m_late only) ────────────────────────────────────
    type BtcPosRow = { status: string; size_usd?: number | null; pnl_usd?: number | null };
    const btcRows = (btcPosRes.data ?? []) as BtcPosRow[];

    let btcOpenPositions = 0;
    let btcOpenExposure  = 0;
    let btcRealizedPnl   = 0;
    let btcTotalTrades   = btcRows.length;

    for (const r of btcRows) {
      const st   = (r.status ?? '').toUpperCase();
      const size = Number(r.size_usd ?? 0) || 0;
      const pnl  = Number(r.pnl_usd  ?? 0) || 0;
      if (st === 'OPEN') {
        btcOpenPositions++;
        btcOpenExposure += size;
      } else if (st === 'CLOSED' || st === 'SETTLED') {
        btcRealizedPnl += pnl;
      }
    }

    // ── Combined accounting ────────────────────────────────────────────────────
    const totalOpenExposure    = copyOpenExposure + btcOpenExposure;
    const combinedRealizedPnl  = copyRealizedPnl  + btcRealizedPnl;
    const accountEquity        = startingBalance  + combinedRealizedPnl;
    const availableBalance     = accountEquity    - totalOpenExposure;

    // ── Bot counts ─────────────────────────────────────────────────────────────
    const activeCopyBots   = botCountRes.count ?? 0;
    const activeCryptoBots = (cryptoBotRes.data ?? []).length > 0 ? 1 : 0;

    return NextResponse.json(
      {
        ok: true,
        // Legacy fields (preserved for backward compat)
        balance:        bankrollData?.paper_balance_usd ?? defaultAmount,
        pnl:            copyRealizedPnl,
        default_amount: defaultAmount,

        // ── New combined accounting fields ──────────────────────────────────────
        starting_balance:       parseFloat(startingBalance.toFixed(2)),
        copy_open_exposure:     parseFloat(copyOpenExposure.toFixed(4)),
        copy_open_positions:    copyOpenPositions,
        copy_realized_pnl:      parseFloat(copyRealizedPnl.toFixed(4)),
        btc_open_exposure:      parseFloat(btcOpenExposure.toFixed(4)),
        btc_open_positions:     btcOpenPositions,
        btc_realized_pnl:       parseFloat(btcRealizedPnl.toFixed(4)),
        btc_total_trades:       btcTotalTrades,
        total_open_exposure:    parseFloat(totalOpenExposure.toFixed(4)),
        combined_realized_pnl:  parseFloat(combinedRealizedPnl.toFixed(4)),
        account_equity:         parseFloat(accountEquity.toFixed(4)),
        available_balance:      parseFloat(availableBalance.toFixed(4)),
        active_copy_bots:       activeCopyBots,
        active_crypto_bots:     activeCryptoBots,
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
// Two actions:
//   { action: 'save_default', amount: number }  → persists a new default reset amount
//   { action: 'reset' }                         → restores balance to saved default
export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  let body: { action?: string; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const now = new Date().toISOString();

  // ── save_default ──────────────────────────────────────────────────────────
  if (body.action === 'save_default') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: 'amount must be a positive number' },
        { status: 400 }
      );
    }
    const rounded = Math.round(amount * 100) / 100;

    try {
      // Read current row first so we can merge strategy_settings safely
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle();

      const existingSettings = (current?.strategy_settings ?? {}) as Record<string, unknown>;
      const newSettings = { ...existingSettings, paper_default: rounded };

      const { data, error } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: BOT_ID, strategy_settings: newSettings, updated_at: now },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: 'save_default',
        default_amount: rounded,
        balance: data?.paper_balance_usd ?? rounded,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── reset ─────────────────────────────────────────────────────────────────
  if (body.action === 'reset') {
    try {
      // Fetch the saved default first
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle();

      const defaultAmount: number =
        (current?.strategy_settings as { paper_default?: number } | null)?.paper_default ??
        FALLBACK_DEFAULT;

      const { data, error } = await client
        .from('bot_settings')
        .upsert(
          {
            bot_id: BOT_ID,
            paper_balance_usd: defaultAmount,
            paper_pnl_usd: 0,
            updated_at: now,
          },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: 'reset',
        balance: data?.paper_balance_usd ?? defaultAmount,
        default_amount: defaultAmount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── fresh_start ───────────────────────────────────────────────────────────
  // Full paper season reset:
  //   1. Archives all OPEN paper positions (status → CANCELLED, closed_at = now)
  //   2. Resets paper_balance_usd + paper_pnl_usd in bot_settings
  //   3. Syncs paper_max_exposure_usd in copy_global_settings to the balance default
  //
  // LIVE positions, bots, wallets, and bot settings are never touched.
  if (body.action === 'fresh_start') {
    try {
      // 1. Read saved paper default
      const { data: currentSettings } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle();

      const defaultAmount: number =
        (currentSettings?.strategy_settings as { paper_default?: number } | null)
          ?.paper_default ?? FALLBACK_DEFAULT;

      // 2. Collect all PAPER bot IDs
      const { data: paperBots, error: botsErr } = await client
        .from('copy_bots')
        .select('id')
        .eq('mode', 'PAPER');

      if (botsErr) {
        return NextResponse.json({ ok: false, error: botsErr.message }, { status: 500 });
      }

      let positionsArchived = 0;

      if (paperBots && paperBots.length > 0) {
        const paperBotIds = (paperBots as Array<{ id: string }>).map((b) => b.id);

        // Count OPEN paper positions (head:true bypasses the 1000-row response cap)
        const { count } = await client
          .from('copied_positions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'OPEN')
          .in('copy_bot_id', paperBotIds);

        positionsArchived = count ?? 0;

        if (positionsArchived > 0) {
          // Archive without .select() so the UPDATE applies to all rows, not just 1000
          const { error: cancelErr } = await client
            .from('copied_positions')
            .update({ status: 'CANCELLED', closed_at: now })
            .eq('status', 'OPEN')
            .in('copy_bot_id', paperBotIds);

          if (cancelErr) {
            return NextResponse.json({ ok: false, error: cancelErr.message }, { status: 500 });
          }
        }
      }

      // 3. Reset paper bankroll
      const { data: bankroll, error: bankrollErr } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: BOT_ID, paper_balance_usd: defaultAmount, paper_pnl_usd: 0, updated_at: now },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .single();

      if (bankrollErr) {
        return NextResponse.json({ ok: false, error: bankrollErr.message }, { status: 500 });
      }

      // 4. Sync paper max exposure cap to match the new starting balance
      //    (operator may adjust this in GlobalSettingsPanel afterwards)
      await client
        .from('copy_global_settings')
        .update({ paper_max_exposure_usd: defaultAmount })
        .eq('id', 1);

      return NextResponse.json({
        ok: true,
        action: 'fresh_start',
        balance: bankroll?.paper_balance_usd ?? defaultAmount,
        default_amount: defaultAmount,
        positions_archived: positionsArchived,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: false, error: 'action must be "save_default", "reset", or "fresh_start"' },
    { status: 400 }
  );
}
