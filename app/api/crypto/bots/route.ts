// GET /api/crypto/bots
//
// Returns a summary of all tracked crypto strategy bots — only btc_5m_late.
//
// paper_positions confirmed column names:
//   start_ts        — trade opening timestamp
//   size_usd        — trade size in USD
//   pnl_usd         — realized P/L (null when OPEN)
//   status          — 'OPEN' | 'CLOSED'
//   slug            — market slug
//   side            — stored as 'yes' (UP) or 'no' (DOWN) — translated here
//   entry_price     — entry price (may also be entry_yes)
//   closed_at       — close timestamp
//
// Side translation: 'yes' → 'UP', 'no' → 'DOWN'
// Result: OPEN → 'OPEN' | pnl_usd > 0 → 'WIN' | pnl_usd < 0 → 'LOSS' | = 0 → 'PUSH'
//
// READ-ONLY reporting — never writes, never touches copy positions or live trading.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

const BOT_NAMES: Record<string, string> = { btc_5m_late: 'BTC 5-Min' };
const SUPPORTED_BOT_IDS = ['btc_5m_late'];  // Only btc_5m_late — never aggregate btc_5m_ema
const RECENT_LIMIT = 20;

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function translateSide(raw: string | null | undefined): string {
  if (!raw) return '—';
  const s = raw.toLowerCase().trim();
  if (s === 'yes' || s === 'up')   return 'UP';
  if (s === 'no'  || s === 'down') return 'DOWN';
  return raw.toUpperCase();
}

function deriveResult(status: string | null, pnl: number | null): string {
  const st = (status ?? '').toUpperCase();
  if (st === 'OPEN') return 'OPEN';
  const p = Number(pnl ?? 0);
  if (p > 0) return 'WIN';
  if (p < 0) return 'LOSS';
  return 'PUSH';
}

interface PaperPosRow {
  bot_id:       string | null;
  status:       string | null;
  start_ts:     string | null;
  size_usd:     number | null;
  pnl_usd:      number | null;
  slug?:        string | null;
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
  const midnightMs = midnightUTC.getTime();
  const fetchedAt  = new Date().toISOString();

  try {
    const [settingsRes, emaSettingsRes, allPosRes, recentRes] = await Promise.all([
      // btc_5m_late settings — the only active BTC strategy
      client
        .from('bot_settings')
        .select('bot_id, is_enabled, mode, arm_live, trade_size_usd, paper_balance_usd, strategy_settings, updated_at')
        .in('bot_id', SUPPORTED_BOT_IDS),

      // btc_5m_ema enabled check — for legacy diagnostic warning only
      client
        .from('bot_settings')
        .select('is_enabled')
        .eq('bot_id', 'btc_5m_ema')
        .limit(1),

      // All btc_5m_late positions for stats + equity curve
      client
        .from('paper_positions')
        .select('id, bot_id, status, start_ts, size_usd, pnl_usd, slug, market_slug, side, closed_at')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('start_ts', { ascending: false }),

      // Most recent RECENT_LIMIT rows for detail display
      client
        .from('paper_positions')
        .select('id, bot_id, status, start_ts, size_usd, pnl_usd, slug, market_slug, side, entry_price, entry_yes, closed_at, updated_at')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('start_ts', { ascending: false })
        .limit(RECENT_LIMIT),
    ]);

    type SettingsRow = {
      bot_id:           string;
      is_enabled:       boolean;
      mode:             string;
      arm_live:         boolean;
      trade_size_usd:   number;
      paper_balance_usd: number;
      strategy_settings: Record<string, unknown> | null;
      updated_at:       string;
    };

    const settingsRows = (settingsRes.data ?? []) as SettingsRow[];
    const allPosRows   = (allPosRes.data  ?? []) as PaperPosRow[];
    const recentRows   = (recentRes.data  ?? []) as PaperPosRow[];

    // Legacy EMA diagnostic: is btc_5m_ema still enabled?
    const emaRows = (emaSettingsRes.data ?? []) as { is_enabled: boolean }[];
    const legacyEmaEnabled = emaRows.length > 0 ? Boolean(emaRows[0].is_enabled) : false;

    const bots = SUPPORTED_BOT_IDS.map((botId) => {
      const settings  = settingsRows.find((r) => r.bot_id === botId);
      const posForBot = allPosRows.filter((r) => r.bot_id === botId);

      // Starting balance from bot_settings.paper_balance_usd (default 100)
      const startingBalance = Number(settings?.paper_balance_usd ?? 100) || 100;

      // ── Aggregate stats ───────────────────────────────────────────────────────
      let openCount      = 0;
      let closedCount    = 0;
      let wins           = 0;
      let losses         = 0;
      let pushes         = 0;
      let totalAmtTraded = 0;
      let realizedPnl    = 0;   // SUM(pnl_usd) for CLOSED only
      let openExposure   = 0;   // SUM(size_usd) for OPEN only
      let todayCount     = 0;
      let todayPnl       = 0;

      for (const r of posForBot) {
        const status  = (r.status ?? '').toUpperCase();
        const sizeUsd = Number(r.size_usd ?? 0) || 0;
        const pnlUsd  = Number(r.pnl_usd  ?? 0) || 0;
        const startMs = r.start_ts ? new Date(r.start_ts).getTime() : 0;

        totalAmtTraded += sizeUsd;
        if (startMs >= midnightMs) todayCount++;

        if (status === 'OPEN') {
          openCount++;
          openExposure += sizeUsd;
        } else if (status === 'CLOSED' || status === 'SETTLED') {
          closedCount++;
          realizedPnl += pnlUsd;

          if (pnlUsd > 0)      wins++;
          else if (pnlUsd < 0) losses++;
          else                  pushes++;

          const settledMs = r.closed_at
            ? new Date(r.closed_at).getTime()
            : startMs;
          if (settledMs >= midnightMs) todayPnl += pnlUsd;
        }
      }

      const winLossDenom    = wins + losses;
      const winRate         = winLossDenom > 0 ? parseFloat((wins / winLossDenom).toFixed(4)) : 0;
      const totalTrades     = posForBot.length;
      const availableBalance = startingBalance + realizedPnl - openExposure;
      const accountEquity   = startingBalance + realizedPnl;

      // ── Equity curve: CLOSED positions sorted ASC for chart ──────────────────
      const closedSorted = posForBot
        .filter((r) => {
          const st = (r.status ?? '').toUpperCase();
          return st === 'CLOSED' || st === 'SETTLED';
        })
        .sort((a, b) => {
          const aMs = new Date(a.closed_at ?? a.start_ts ?? '').getTime() || 0;
          const bMs = new Date(b.closed_at ?? b.start_ts ?? '').getTime() || 0;
          return aMs - bMs;
        });

      let running = startingBalance;
      const equityCurve = closedSorted.map((r) => {
        const pnl = Number(r.pnl_usd ?? 0) || 0;
        running += pnl;
        return {
          position_id: r.id,
          market_slug: r.slug ?? r.market_slug ?? null,
          closed_at:   r.closed_at ?? r.start_ts ?? null,
          trade_pnl:   parseFloat(pnl.toFixed(4)),
          equity:      parseFloat(running.toFixed(4)),
          side:        translateSide(r.side),
          result:      deriveResult(r.status, r.pnl_usd),
        };
      });

      // ── Latest trade ──────────────────────────────────────────────────────────
      const latestRaw = posForBot[0] ?? null;  // already sorted DESC
      const latestTrade = latestRaw
        ? {
            start_ts:  latestRaw.start_ts,
            slug:      latestRaw.slug ?? latestRaw.market_slug,
            side:      translateSide(latestRaw.side),
            size_usd:  latestRaw.size_usd,
            status:    (latestRaw.status ?? '').toUpperCase(),
            pnl_usd:   latestRaw.pnl_usd,
            result:    deriveResult(latestRaw.status, latestRaw.pnl_usd),
          }
        : null;

      // ── Recent trades (20) with running equity ────────────────────────────────
      // Compute running equity for each row in the recent display set
      // We rebuild the running equity per-trade from the full sorted list
      const recentForBot = (recentRes.data ?? []).filter((r: PaperPosRow) => r.bot_id === botId) as PaperPosRow[];

      const equityMap = new Map<string, number>();
      equityCurve.forEach((pt) => {
        if (pt.position_id) equityMap.set(String(pt.position_id), pt.equity);
      });

      const recentTrades = recentForBot.map((r) => {
        const equityAfter = r.id ? equityMap.get(String(r.id)) : undefined;
        return {
          id:           r.id,
          status:       (r.status ?? '').toUpperCase(),
          start_ts:     r.start_ts,
          closed_at:    r.closed_at ?? r.updated_at,
          slug:         r.slug ?? r.market_slug,
          side:         translateSide(r.side),
          size_usd:     r.size_usd,
          entry_price:  r.entry_price ?? r.entry_yes,
          pnl_usd:      r.pnl_usd,
          result:       deriveResult(r.status, r.pnl_usd),
          equity_after: equityAfter != null ? parseFloat(equityAfter.toFixed(4)) : null,
        };
      });

      return {
        bot_id:            botId,
        name:              BOT_NAMES[botId] ?? botId,
        is_enabled:        settings?.is_enabled     ?? false,
        mode:              settings?.mode           ?? 'PAPER',
        arm_live:          settings?.arm_live       ?? false,
        trade_size_usd:    settings?.trade_size_usd ?? 0,  // actual stored setting
        strategy_settings: settings?.strategy_settings ?? {},

        // ── Balance summary ──────────────────────────────────────────────────────
        starting_balance:  parseFloat(startingBalance.toFixed(2)),
        realized_pnl:      parseFloat(realizedPnl.toFixed(4)),
        open_exposure:     parseFloat(openExposure.toFixed(4)),
        available_balance: parseFloat(availableBalance.toFixed(4)),
        account_equity:    parseFloat(accountEquity.toFixed(4)),

        // ── Stats ────────────────────────────────────────────────────────────────
        stats: {
          total_trades:        totalTrades,
          trades_today:        todayCount,
          open_trades:         openCount,
          closed_trades:       closedCount,
          wins,
          losses,
          pushes,
          win_rate:            winRate,
          open_exposure_usd:   parseFloat(openExposure.toFixed(4)),
          total_amount_traded: parseFloat(totalAmtTraded.toFixed(4)),
          today_pnl:           parseFloat(todayPnl.toFixed(4)),
          all_time_pnl:        parseFloat(realizedPnl.toFixed(4)),
        },

        open_positions:    openCount,
        open_exposure_usd: parseFloat(openExposure.toFixed(4)),

        // ── Chart + trades ───────────────────────────────────────────────────────
        equity_curve:  equityCurve,
        latest_trade:  latestTrade,
        recent_trades: recentTrades,

        // ── Legacy diagnostic ────────────────────────────────────────────────────
        legacy_ema_enabled: legacyEmaEnabled,

        // ── Flat legacy fields for badge/overview compat ─────────────────────────
        total_trades:      totalTrades,
        total_closed:      closedCount,
        all_time_wins:     wins,
        all_time_losses:   losses,
        win_rate:          winRate,
        all_time_pnl:      parseFloat(realizedPnl.toFixed(4)),
        today_trade_count: todayCount,
        today_pnl:         parseFloat(todayPnl.toFixed(4)),
      };
    });

    return NextResponse.json(
      { ok: true, bots, legacy_ema_enabled: legacyEmaEnabled, fetched_at: fetchedAt },
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
