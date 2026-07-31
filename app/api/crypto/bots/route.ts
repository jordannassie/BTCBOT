// GET /api/crypto/bots
//
// Returns a summary of all tracked crypto strategy bots.
// Currently: btc_5m_late only.
//
// Data source: paper_positions table — correct column names confirmed:
//   start_ts   — trade opening timestamp (NOT opened_at or created_at)
//   size_usd   — trade size in USD      (NOT trade_size_usd)
//   pnl_usd    — realized P/L           (NOT pnl)
//   status     — 'OPEN' | 'CLOSED'
//   slug / market_slug — market identifier
//   side       — 'UP' | 'DOWN' or similar
//
// Response shape:
// {
//   ok: true,
//   bots: [{
//     bot_id, name, is_enabled, mode, arm_live, trade_size_usd,
//     open_positions, open_exposure_usd,
//     stats: { today, total, open, closed, wins, losses, pushes,
//              win_rate, total_amount_traded, today_pnl, all_time_pnl },
//     recent_trades: [{ ... }]   // latest 10 paper_positions rows
//   }]
// }
//
// NEVER touches copy_bots, copied_positions, or live-trading fields.
// This route is read-only reporting.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

const BOT_NAMES: Record<string, string> = {
  btc_5m_late: 'BTC 5-Min',
};

const SUPPORTED_BOT_IDS = ['btc_5m_late'];

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single row from paper_positions — only columns we know exist. */
interface PaperPosRow {
  bot_id:       string | null;
  status:       string | null;
  start_ts:     string | null;   // opening timestamp
  size_usd:     number | null;   // trade size
  pnl_usd:      number | null;   // realized P/L (null when OPEN)
  slug?:        string | null;   // market slug (may be market_slug)
  market_slug?: string | null;
  side?:        string | null;
  entry_price?: number | null;
  entry_yes?:   number | null;
  closed_at?:   string | null;
  updated_at?:  string | null;
  id?:          string | null;
}

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  const midnightUTC = new Date();
  midnightUTC.setUTCHours(0, 0, 0, 0);
  const midnightMs  = midnightUTC.getTime();

  try {
    const [settingsRes, allPosRes, recentRes] = await Promise.all([
      // Bot settings — trade_size_usd here is the SAVED setting (may differ from FastLoop override)
      client
        .from('bot_settings')
        .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, strategy_settings, updated_at')
        .in('bot_id', SUPPORTED_BOT_IDS),

      // ALL paper_positions for stats aggregation
      // Columns confirmed: start_ts, size_usd, pnl_usd, status
      client
        .from('paper_positions')
        .select('bot_id, status, start_ts, size_usd, pnl_usd, closed_at')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('start_ts', { ascending: false }),

      // Latest 10 rows for the recent-trades display
      client
        .from('paper_positions')
        .select('id, bot_id, status, start_ts, size_usd, pnl_usd, slug, market_slug, side, entry_price, entry_yes, closed_at, updated_at')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('start_ts', { ascending: false })
        .limit(10),
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

    const settingsRows = (settingsRes.data ?? []) as SettingsRow[];
    const allPosRows   = (allPosRes.data  ?? []) as PaperPosRow[];
    const recentRows   = (recentRes.data  ?? []) as PaperPosRow[];

    const bots = SUPPORTED_BOT_IDS.map((botId) => {
      const settings = settingsRows.find((r) => r.bot_id === botId);
      const posForBot = allPosRows.filter((r) => r.bot_id === botId);

      // ── Aggregate stats ──────────────────────────────────────────────────────
      let openCount    = 0;
      let closedCount  = 0;
      let wins         = 0;
      let losses       = 0;
      let pushes       = 0;
      let totalAmtTraded = 0;
      let allTimePnl   = 0;
      let todayCount   = 0;
      let todayPnl     = 0;
      let openExposure = 0;

      for (const r of posForBot) {
        const status  = (r.status ?? '').toUpperCase();
        const sizeUsd = Number(r.size_usd ?? 0) || 0;
        const pnlUsd  = Number(r.pnl_usd  ?? 0) || 0;
        const startMs = r.start_ts ? new Date(r.start_ts).getTime() : 0;

        totalAmtTraded += sizeUsd;

        // Today: trade started since midnight UTC
        if (startMs >= midnightMs) {
          todayCount++;
        }

        if (status === 'OPEN') {
          openCount++;
          openExposure += sizeUsd;
        } else if (status === 'CLOSED' || status === 'SETTLED') {
          closedCount++;
          allTimePnl += pnlUsd;

          if (pnlUsd > 0)       wins++;
          else if (pnlUsd < 0)  losses++;
          else                  pushes++;

          // Today P/L: settled today (use closed_at when available, else start_ts)
          const closedMs = r.closed_at
            ? new Date(r.closed_at).getTime()
            : startMs;
          if (closedMs >= midnightMs) {
            todayPnl += pnlUsd;
          }
        }
      }

      const winLossDenom = wins + losses;
      const winRate = winLossDenom > 0 ? parseFloat((wins / winLossDenom).toFixed(4)) : 0;
      const totalTrades = posForBot.length;

      // Latest trade fields
      const latestPos = posForBot[0] ?? null; // already ordered DESC by start_ts
      const latestTradeTime   = latestPos?.start_ts ?? null;
      const latestTradeSide   = latestPos?.side ?? null;
      const latestTradeStatus = latestPos?.status ?? null;
      const latestTradePnl    = latestPos?.pnl_usd ?? null;

      return {
        bot_id:         botId,
        name:           BOT_NAMES[botId] ?? botId,
        is_enabled:     settings?.is_enabled     ?? false,
        mode:           settings?.mode           ?? 'PAPER',
        arm_live:       settings?.arm_live       ?? false,
        trade_size_usd: settings?.trade_size_usd ?? 0,  // DB-stored setting
        strategy_settings: settings?.strategy_settings ?? {},

        // Stats — sourced from paper_positions with correct column names
        stats: {
          today:               todayCount,
          total:               totalTrades,
          open:                openCount,
          closed:              closedCount,
          wins,
          losses,
          pushes,
          win_rate:            winRate,
          total_amount_traded: parseFloat(totalAmtTraded.toFixed(4)),
          today_pnl:           parseFloat(todayPnl.toFixed(4)),
          all_time_pnl:        parseFloat(allTimePnl.toFixed(4)),
        },

        // Exposure — from OPEN positions
        open_positions:    openCount,
        open_exposure_usd: parseFloat(openExposure.toFixed(4)),

        // Latest trade summary
        latest_trade_time:   latestTradeTime,
        latest_trade_side:   latestTradeSide,
        latest_trade_status: latestTradeStatus,
        latest_trade_pnl:    latestTradePnl,

        // Recent trades for detailed display
        recent_trades: recentRows
          .filter((r) => r.bot_id === botId)
          .map((r) => ({
            id:          r.id,
            status:      r.status,
            start_ts:    r.start_ts,
            closed_at:   r.closed_at ?? r.updated_at,
            slug:        r.slug ?? r.market_slug,
            side:        r.side,
            size_usd:    r.size_usd,
            entry_price: r.entry_price ?? r.entry_yes,
            pnl_usd:     r.pnl_usd,
          })),

        // Legacy fields kept for CopyTradingTabs badge compatibility
        total_trades:    totalTrades,
        total_closed:    closedCount,
        all_time_wins:   wins,
        all_time_losses: losses,
        win_rate:        winRate,
        all_time_pnl:    parseFloat(allTimePnl.toFixed(4)),
        today_trade_count: todayCount,
        today_wins:      0,   // not tracked separately (use stats.wins for all-time)
        today_losses:    0,
        today_pnl:       parseFloat(todayPnl.toFixed(4)),
      };
    });

    return NextResponse.json({ ok: true, bots }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[crypto/bots] error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
