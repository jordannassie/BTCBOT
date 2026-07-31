// GET /api/crypto/bots
//
// Returns a summary of all tracked crypto strategy bots.
// Currently: btc_5m_late only.
//
// Fields per bot:
//   bot_id, name, is_enabled, mode, arm_live, trade_size_usd
//   open_positions, open_exposure_usd
//   today_trade_count, today_wins, today_losses, today_pnl
//   strategy_settings
//
// Data sources:
//   bot_settings        — settings / enabled state
//   paper_positions     — open positions (status=OPEN) and today's closed trades
//
// NEVER touches copy_bots, copied_positions, or any live-trading fields.
// NEVER accepts write payloads — this is GET only.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

// Display name map — bot_id → human label shown in UI
const BOT_NAMES: Record<string, string> = {
  btc_5m_late: 'BTC 5-Min',
};

// Only these bot_ids are surfaced by this endpoint
const SUPPORTED_BOT_IDS = ['btc_5m_late'];

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  // Start of UTC today
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  try {
    const [settingsRes, openPosRes, allClosedRes] = await Promise.all([
      // Bot settings for all supported crypto bots
      client
        .from('bot_settings')
        .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, strategy_settings, updated_at')
        .in('bot_id', SUPPORTED_BOT_IDS),

      // Open paper positions — for exposure count
      client
        .from('paper_positions')
        .select('bot_id, trade_size_usd')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .eq('status', 'OPEN'),

      // All closed paper positions — compute today + all-time stats in-process
      client
        .from('paper_positions')
        .select('bot_id, trade_size_usd, pnl, outcome, closed_at, opened_at, created_at')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .in('status', ['CLOSED', 'SETTLED']),
    ]);

    type SettingsRow = {
      bot_id: string;
      is_enabled: boolean;
      mode: string;
      arm_live: boolean;
      trade_size_usd: number;
      strategy_settings: Record<string, unknown> | null;
      updated_at: string;
    };

    type OpenPosRow = {
      bot_id: string;
      trade_size_usd?: number | null;
    };

    type ClosedPosRow = {
      bot_id:     string;
      trade_size_usd?: number | null;
      pnl?:       number | null;
      outcome?:   string | null;
      closed_at?: string | null;
      opened_at?: string | null;
      created_at?: string | null;
    };

    // Midnight UTC for "today" calculations
    const midnightUTC = new Date(todayUTC);
    const midnightMs  = midnightUTC.getTime();

    const settingsRows  = (settingsRes.data  ?? []) as SettingsRow[];
    const openPosRows   = (openPosRes.data   ?? []) as OpenPosRow[];
    const allClosedRows = (allClosedRes.data ?? []) as ClosedPosRow[];

    const bots = SUPPORTED_BOT_IDS.map((botId) => {
      const settings = settingsRows.find((r) => r.bot_id === botId);

      // Open position stats
      const openForBot    = openPosRows.filter((r) => r.bot_id === botId);
      const openPositions = openForBot.length;
      const openExposure  = openForBot.reduce((s, r) => s + (Number(r.trade_size_usd ?? 0) || 0), 0);

      // All-time closed stats
      const closedForBot = allClosedRows.filter((r) => r.bot_id === botId);
      const totalClosed  = closedForBot.length;

      let todayTradeCount = 0;
      let todayWins       = 0;
      let todayLosses     = 0;
      let todayPnl        = 0;
      let allTimeWins     = 0;
      let allTimeLosses   = 0;
      let allTimePnl      = 0;

      for (const r of closedForBot) {
        const pnl     = Number(r.pnl     ?? 0) || 0;
        const outcome = (r.outcome ?? '').toUpperCase();
        const isWin   = outcome === 'WIN'  || (outcome === '' && pnl > 0);
        const isLoss  = outcome === 'LOSS' || (outcome === '' && pnl < 0);

        allTimePnl += pnl;
        if (isWin)  allTimeWins++;
        if (isLoss) allTimeLosses++;

        // Today: closed today
        const closedMs = r.closed_at ? new Date(r.closed_at).getTime() : 0;
        if (closedMs >= midnightMs) {
          todayTradeCount++;
          todayPnl += pnl;
          if (isWin)  todayWins++;
          if (isLoss) todayLosses++;
        }
      }

      const winLossDenom = allTimeWins + allTimeLosses;
      const winRate      = winLossDenom > 0 ? parseFloat((allTimeWins / winLossDenom).toFixed(4)) : 0;

      // Total trade count = open + closed
      const totalTrades = openPositions + totalClosed;

      return {
        bot_id:            botId,
        name:              BOT_NAMES[botId] ?? botId,
        is_enabled:        settings?.is_enabled        ?? false,
        mode:              settings?.mode              ?? 'PAPER',
        arm_live:          settings?.arm_live          ?? false,
        trade_size_usd:    settings?.trade_size_usd    ?? 0,
        open_positions:    openPositions,
        open_exposure_usd: openExposure,
        total_trades:      totalTrades,
        total_closed:      totalClosed,
        all_time_wins:     allTimeWins,
        all_time_losses:   allTimeLosses,
        win_rate:          winRate,
        all_time_pnl:      parseFloat(allTimePnl.toFixed(4)),
        today_trade_count: todayTradeCount,
        today_wins:        todayWins,
        today_losses:      todayLosses,
        today_pnl:         parseFloat(todayPnl.toFixed(4)),
        strategy_settings: settings?.strategy_settings ?? {},
      };
    });

    return NextResponse.json(
      { ok: true, bots },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[crypto/bots] error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
