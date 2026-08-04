// GET /api/crypto/bots
//
// Single source of truth for all btc_5m_late statistics.
//
// CONFIRMED paper_positions columns (verified by live trade data):
//   bot_id       — string
//   status       — 'OPEN' | 'CLOSED'
//   size_usd     — number  (trade size in USD)
//   pnl_usd      — number  (realized P/L, null when OPEN)
//   market_slug  — string  (e.g. 'btc-updown-5m-1785521100')
//   side         — string  ('yes' = UP, 'no' = DOWN)
//   entry_price  — number  (entry price)
//
// INTENTIONALLY EXCLUDED (not confirmed to exist):
//   id, start_ts, slug, closed_at, updated_at, entry_yes
//
// Chronological ordering: via market_slug suffix (Unix timestamp embedded).
// Starting balance: strategy_settings.btc_paper_start ?? 100
//   (NOT paper_balance_usd which FastLoop mutates as trades settle)
//
// Side translation: 'yes' → 'UP', 'no' → 'DOWN'
// Result: OPEN → 'OPEN' | pnl_usd > 0 → 'WIN' | pnl_usd < 0 → 'LOSS' | = 0 → 'PUSH'
//
// READ-ONLY — never writes, never touches copy positions or live trading.
// Never aggregates btc_5m_ema — only btc_5m_late.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

const BOT_NAMES: Record<string, string> = {
  btc_5m_late: 'BTC 5-Min',
  eth_5m_paper: 'ETH 5-Min',
  sol_5m_paper: 'SOL 5-Min',
  xrp_5m_paper: 'XRP 5-Min',
};
// btc_5m_late + ETH/SOL/XRP — never aggregate btc_5m_ema
const SUPPORTED_BOT_IDS = ['btc_5m_late', 'eth_5m_paper', 'sol_5m_paper', 'xrp_5m_paper'];
// Stable paper starting balance per bot.
// Do NOT use paper_balance_usd from bot_settings (FastLoop mutates it as P/L flows).
const PAPER_START_DEFAULTS: Record<string, number> = {
  btc_5m_late:  100,
  eth_5m_paper: 100,
  sol_5m_paper: 100,
  xrp_5m_paper: 100,
};
const BTC_PAPER_START_DEFAULT = 100; // kept for backwards compat
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

// Extract Unix timestamp from market_slug suffix (e.g. 'btc-updown-5m-1785521100')
function slugToMs(slug: string | null | undefined): number {
  if (!slug) return 0;
  const parts = slug.split('-');
  const last = parts[parts.length - 1];
  const ts = Number(last);
  return Number.isFinite(ts) && ts > 1_000_000_000 ? ts * 1000 : 0;
}

// ── Row types ────────────────────────────────────────────────────────────────

/** Stats row: only confirmed-safe columns */
interface StatRow {
  bot_id:      string | null;
  status:      string | null;
  size_usd:    number | null;
  pnl_usd:     number | null;
  market_slug: string | null;
}

/** Detail row: confirmed columns + display fields */
interface DetailRow extends StatRow {
  side?:        string | null;
  entry_price?: number | null;
}

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const midnightMs = now.getTime();
  const fetchedAt  = new Date().toISOString();

  try {
    const [settingsRes, emaSettingsRes, statsRes, detailRes, sharedAccountRes] = await Promise.all([
      // per-bot settings (trade_size_usd, is_enabled, strategy_settings)
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

      // STATS query: ONLY confirmed columns.
      // No id, start_ts, slug, closed_at — using only what is verified to exist.
      // Order by market_slug ASC (suffix is Unix timestamp → chronological).
      client
        .from('paper_positions')
        .select('bot_id, status, size_usd, pnl_usd, market_slug')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('market_slug', { ascending: true }),

      // DETAIL query: stats columns + display-only confirmed columns.
      // side and entry_price confirmed present from live trade data.
      // Limited to RECENT_LIMIT for display — stats come from statsRes above.
      client
        .from('paper_positions')
        .select('bot_id, status, size_usd, pnl_usd, market_slug, side, entry_price')
        .in('bot_id', SUPPORTED_BOT_IDS)
        .order('market_slug', { ascending: false })
        .limit(RECENT_LIMIT),

      // Shared crypto paper account balance (single row for all 4 bots)
      client
        .from('bot_settings')
        .select('paper_balance_usd, paper_pnl_usd')
        .eq('bot_id', 'crypto_paper')
        .maybeSingle(),
    ]);

    type SettingsRow = {
      bot_id:            string;
      is_enabled:        boolean;
      mode:              string;
      arm_live:          boolean;
      trade_size_usd:    number;
      paper_balance_usd: number;
      strategy_settings: Record<string, unknown> | null;
      updated_at:        string;
    };

    const settingsRows = (settingsRes.data ?? []) as SettingsRow[];
    const emaRows      = (emaSettingsRes.data ?? []) as { is_enabled: boolean }[];
    const legacyEmaEnabled = emaRows.length > 0 ? Boolean(emaRows[0].is_enabled) : false;

    // Log query errors for diagnostics (non-fatal — return zeros rather than 500)
    if (statsRes.error) {
      console.error('[crypto/bots] statsRes error:', statsRes.error.message);
    }
    if (detailRes.error) {
      console.error('[crypto/bots] detailRes error:', detailRes.error.message);
    }

    // Shared crypto paper account balance (all 4 bots debit this row)
    type SharedAccountRow = { paper_balance_usd: number; paper_pnl_usd: number } | null;
    const sharedAccount = (sharedAccountRes.data ?? null) as SharedAccountRow;
    const sharedBalance = Number(sharedAccount?.paper_balance_usd ?? 1000);
    const sharedPnl     = Number(sharedAccount?.paper_pnl_usd     ?? 0);

    const statRows   = (statsRes.data  ?? []) as StatRow[];
    const detailRows = (detailRes.data ?? []) as DetailRow[];

    const bots = SUPPORTED_BOT_IDS.map((botId) => {
      const settings = settingsRows.find((r) => r.bot_id === botId);

      // ── Starting balance ───────────────────────────────────────────────────
      // All crypto bots share one bankroll in the crypto_paper row.
      // Starting balance = paper_start from per-bot strategy_settings, or the
      // shared balance, or the default $1000.
      const startingBalance: number =
        Number(
          (settings?.strategy_settings as Record<string, unknown> | null)
            ?.paper_start ?? sharedBalance ?? PAPER_START_DEFAULTS[botId] ?? BTC_PAPER_START_DEFAULT
        ) || (PAPER_START_DEFAULTS[botId] ?? BTC_PAPER_START_DEFAULT);

      // ── Per-bot aggregate stats (from paper_positions for this bot only) ──
      const forBot = statRows.filter((r) => r.bot_id === botId);

      let openCount      = 0;
      let closedCount    = 0;
      let wins           = 0;
      let losses         = 0;
      let pushes         = 0;
      let totalAmtTraded = 0;
      let realizedPnl    = 0;
      let openExposure   = 0;
      let todayCount     = 0;
      let todayPnl       = 0;

      for (const r of forBot) {
        const status  = (r.status ?? '').toUpperCase();
        const sizeUsd = Number(r.size_usd ?? 0) || 0;
        const pnlUsd  = Number(r.pnl_usd  ?? 0) || 0;
        // Derive "today" from market_slug embedded Unix timestamp
        const marketMs = slugToMs(r.market_slug);

        totalAmtTraded += sizeUsd;
        if (marketMs > 0 && marketMs >= midnightMs) todayCount++;

        if (status === 'OPEN') {
          openCount++;
          openExposure += sizeUsd;
        } else if (status === 'CLOSED' || status === 'SETTLED') {
          closedCount++;
          realizedPnl += pnlUsd;

          if (pnlUsd > 0)      wins++;
          else if (pnlUsd < 0) losses++;
          else                  pushes++;

          if (marketMs > 0 && marketMs >= midnightMs) todayPnl += pnlUsd;
        }
      }

      const winLossDenom  = wins + losses;
      const winRate       = winLossDenom > 0 ? parseFloat((wins / winLossDenom).toFixed(4)) : 0;
      const totalTrades   = forBot.length;
      // Balance/equity comes from the SHARED account (all bots combined).
      // Per-bot card shows the shared balance since they all share one bankroll.
      const accountEquity = startingBalance + sharedPnl;
      const availBalance  = accountEquity - openExposure;  // per-bot exposure subtracted

      // ── Equity curve (from stats rows sorted ASC by market_slug) ──────────
      // statRows are already sorted ASC (market_slug contains Unix ts → chronological)
      const closedSorted = forBot.filter((r) => {
        const st = (r.status ?? '').toUpperCase();
        return st === 'CLOSED' || st === 'SETTLED';
      });
      // Already in ASC order from the query

      let running = startingBalance;
      const equityCurve = closedSorted.map((r) => {
        const pnl       = Number(r.pnl_usd ?? 0) || 0;
        running        += pnl;
        const marketMs2 = slugToMs(r.market_slug);
        return {
          market_slug: r.market_slug ?? null,
          closed_at:   marketMs2 > 0 ? new Date(marketMs2).toISOString() : null,
          trade_pnl:   parseFloat(pnl.toFixed(4)),
          equity:      parseFloat(running.toFixed(4)),
          side:        null,   // side not in stats query
          result:      deriveResult(r.status, r.pnl_usd),
        };
      });

      // ── Recent trades (from detail query, DESC order) ─────────────────────
      const detailForBot = detailRows.filter((r) => r.bot_id === botId);

      // Build equity map for detail rows using the equity curve data
      // (match by market_slug since we have no row IDs)
      const equityBySlug = new Map<string, number>();
      equityCurve.forEach((pt) => {
        if (pt.market_slug) equityBySlug.set(pt.market_slug, pt.equity);
      });

      const recentTrades = detailForBot.map((r) => {
        const status      = (r.status ?? '').toUpperCase();
        const pnl         = r.pnl_usd ?? null;
        const marketMs3   = slugToMs(r.market_slug);
        const slugForMap  = r.market_slug ?? '';
        const equityAfter = status !== 'OPEN' && slugForMap
          ? equityBySlug.get(slugForMap) ?? null
          : null;

        return {
          status,
          start_ts:    marketMs3 > 0 ? new Date(marketMs3).toISOString() : null,
          slug:        r.market_slug,
          side:        translateSide(r.side),
          size_usd:    r.size_usd,
          entry_price: r.entry_price,
          pnl_usd:     pnl,
          result:      deriveResult(r.status, pnl),
          equity_after: equityAfter,
        };
      });

      // ── Latest trade (first detail row = most recent DESC) ────────────────
      const latestRaw = detailForBot[0] ?? null;
      const latestTrade = latestRaw
        ? {
            start_ts:    slugToMs(latestRaw.market_slug) > 0
              ? new Date(slugToMs(latestRaw.market_slug)).toISOString()
              : null,
            slug:        latestRaw.market_slug,
            side:        translateSide(latestRaw.side),
            size_usd:    latestRaw.size_usd,
            entry_price: latestRaw.entry_price,
            status:      (latestRaw.status ?? '').toUpperCase(),
            pnl_usd:     latestRaw.pnl_usd,
            result:      deriveResult(latestRaw.status, latestRaw.pnl_usd),
          }
        : null;

      return {
        bot_id:            botId,
        name:              BOT_NAMES[botId] ?? botId,
        is_enabled:        settings?.is_enabled     ?? false,
        mode:              settings?.mode           ?? 'PAPER',
        arm_live:          settings?.arm_live       ?? false,
        trade_size_usd:    settings?.trade_size_usd ?? 0,
        strategy_settings: settings?.strategy_settings ?? {},

        // ── Shared account balance (all 4 bots share one bankroll) ─────────
        // realized_pnl and balance come from the crypto_paper shared row.
        starting_balance:  parseFloat(startingBalance.toFixed(2)),
        realized_pnl:      parseFloat(sharedPnl.toFixed(4)),   // shared
        open_exposure:     parseFloat(openExposure.toFixed(4)), // per-bot
        available_balance: parseFloat(availBalance.toFixed(4)),
        account_equity:    parseFloat(accountEquity.toFixed(4)),

        // ── Per-bot stats (separately queryable) ──────────────────────────
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
          all_time_pnl:        parseFloat(realizedPnl.toFixed(4)), // per-bot cumulative
        },

        open_positions:    openCount,
        open_exposure_usd: parseFloat(openExposure.toFixed(4)),

        // ── Chart + trades ─────────────────────────────────────────────────
        equity_curve:  equityCurve,
        latest_trade:  latestTrade,
        recent_trades: recentTrades,

        // ── Legacy diagnostic ──────────────────────────────────────────────
        legacy_ema_enabled: legacyEmaEnabled,

        // ── Flat legacy fields for badge/overview compat ───────────────────
        total_trades:      totalTrades,
        total_closed:      closedCount,
        all_time_wins:     wins,
        all_time_losses:   losses,
        win_rate:          winRate,
        all_time_pnl:      parseFloat(realizedPnl.toFixed(4)), // per-bot
        today_trade_count: todayCount,
        today_pnl:         parseFloat(todayPnl.toFixed(4)),
      };
    });

    // ── Combined stats across all 4 crypto bots ────────────────────────────
    const allOpenPositions = statRows.filter((r) => (r.status ?? '').toUpperCase() === 'OPEN');
    const totalOpenExposure = allOpenPositions.reduce((s, r) => s + (Number(r.size_usd ?? 0)), 0);
    const sharedStartingBalance = Number(
      (bots[0]?.strategy_settings as Record<string, unknown> | null)?.paper_start ?? 1000
    ) || 1000;

    const shared_account = {
      account_id:        'crypto_paper',
      starting_balance:  sharedStartingBalance,
      realized_pnl:      parseFloat(sharedPnl.toFixed(4)),
      open_exposure:     parseFloat(totalOpenExposure.toFixed(4)),
      available_balance: parseFloat((sharedStartingBalance + sharedPnl - totalOpenExposure).toFixed(4)),
      account_equity:    parseFloat((sharedStartingBalance + sharedPnl).toFixed(4)),
      raw_balance:       sharedBalance,
    };

    return NextResponse.json(
      {
        ok: true,
        bots,
        shared_account,
        legacy_ema_enabled: legacyEmaEnabled,
        fetched_at: fetchedAt,
      },
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
