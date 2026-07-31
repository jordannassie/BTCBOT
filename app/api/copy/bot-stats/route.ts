// GET /api/copy/bot-stats
//
// Returns aggregated trade statistics grouped by bot — one server query per
// table so the browser never needs per-bot round-trips.
//
// Response shape:
// {
//   ok: true,
//   copy_bot_stats: {                    // keyed by copy_bots.id (UUID)
//     "<uuid>": {
//       today: number,    // copied_positions opened since midnight UTC
//       total: number,    // all positions for this bot
//       open:  number,    // status = OPEN
//       closed: number,   // status = CLOSED
//       wins:  number,    // closed with pnl > 0
//       losses: number,   // closed with pnl < 0
//       pushes: number,   // closed with pnl = 0
//       pnl:   number,    // sum(pnl) for closed positions
//     }
//   },
//   crypto_bot_stats: {                  // keyed by bot_settings.bot_id
//     "btc_5m_late": {
//       today:        number,
//       total:        number,
//       open:         number,
//       closed:       number,
//       wins:         number,
//       losses:       number,
//       win_rate:     number,   // wins / (wins + losses), 0 when no closed trades
//       today_pnl:    number,   // sum(pnl) for positions closed today
//       all_time_pnl: number,   // sum(pnl) for all closed positions
//     }
//   },
//   copy_trades_today:  number,   // total copy positions opened since midnight UTC
//   crypto_trades_today: number,  // paper_positions (btc_5m_late) opened since midnight UTC
// }
//
// Data sources:
//   copied_positions — copy bot trades (keyed by copy_bot_id)
//   paper_positions  — crypto strategy trades (keyed by bot_id)
//
// This route is read-only reporting. It does NOT write, update, or delete.
// It does NOT touch copy_bots, execution settings, or live trading state.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };
const CRYPTO_BOT_IDS = ['btc_5m_late'] as const;
// Max rows fetched from copied_positions to keep response fast.
// 10 000 covers large deployments while bounding memory usage.
const MAX_COPY_ROWS = 10_000;

function getClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CopyPosRow {
  copy_bot_id: string | null;
  status:      string | null;
  opened_at:   string | null;
  pnl:         number | string | null;
}

interface CryptoPosRow {
  bot_id:    string | null;
  status:    string | null;
  start_ts:  string | null;  // paper_positions uses start_ts for opening time
  closed_at: string | null;
  pnl_usd:   number | string | null;  // paper_positions uses pnl_usd (NOT pnl)
  size_usd:  number | string | null;  // paper_positions uses size_usd (NOT trade_size_usd)
}

export interface CopyBotStat {
  today:   number;
  total:   number;
  open:    number;
  closed:  number;
  wins:    number;
  losses:  number;
  pushes:  number;
  pnl:     number;
}

export interface CryptoBotStat {
  today:        number;
  total:        number;
  open:         number;
  closed:       number;
  wins:         number;
  losses:       number;
  win_rate:     number;
  today_pnl:    number;
  all_time_pnl: number;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  // Midnight UTC today (for "today" filters)
  const midnightUTC = new Date();
  midnightUTC.setUTCHours(0, 0, 0, 0);
  const midnightISO = midnightUTC.toISOString();

  try {
    // ── Run both table queries in parallel ────────────────────────────────────
    const [copyPosRes, cryptoPosRes] = await Promise.all([
      // All copied_positions — narrowest possible column selection for performance
      client
        .from('copied_positions')
        .select('copy_bot_id, status, opened_at, pnl')
        .limit(MAX_COPY_ROWS),

      // All paper_positions for supported crypto bots
      // Correct column names: start_ts, size_usd, pnl_usd (NOT opened_at, trade_size_usd, pnl)
      client
        .from('paper_positions')
        .select('bot_id, status, start_ts, closed_at, pnl_usd, size_usd')
        .in('bot_id', CRYPTO_BOT_IDS as unknown as string[]),
    ]);

    // ── Aggregate copy-bot stats ──────────────────────────────────────────────
    const copyRows = (copyPosRes.data ?? []) as CopyPosRow[];
    const copyBotStats: Record<string, CopyBotStat> = {};

    let copyTradesToday = 0;

    for (const row of copyRows) {
      const botId = row.copy_bot_id;
      if (!botId) continue;

      if (!copyBotStats[botId]) {
        copyBotStats[botId] = { today: 0, total: 0, open: 0, closed: 0, wins: 0, losses: 0, pushes: 0, pnl: 0 };
      }

      const stat   = copyBotStats[botId];
      const status = (row.status ?? '').toUpperCase();
      const pnl    = Number(row.pnl ?? 0);

      stat.total++;

      // Today: opened since midnight UTC
      if (row.opened_at && new Date(row.opened_at).getTime() >= midnightUTC.getTime()) {
        stat.today++;
        copyTradesToday++;
      }

      if (status === 'OPEN') {
        stat.open++;
      } else if (status === 'CLOSED') {
        stat.closed++;
        if (pnl > 0)      stat.wins++;
        else if (pnl < 0) stat.losses++;
        else               stat.pushes++;
        stat.pnl = parseFloat((stat.pnl + pnl).toFixed(4));
      }
    }

    // ── Aggregate crypto-bot stats ────────────────────────────────────────────
    const cryptoRows = (cryptoPosRes.data ?? []) as CryptoPosRow[];
    const cryptoBotStats: Record<string, CryptoBotStat> = {};

    // Initialize all supported bots with zeroes (so missing bots still appear)
    for (const botId of CRYPTO_BOT_IDS) {
      cryptoBotStats[botId] = {
        today: 0, total: 0, open: 0, closed: 0,
        wins: 0, losses: 0, win_rate: 0,
        today_pnl: 0, all_time_pnl: 0,
      };
    }

    let cryptoTradesToday = 0;

    for (const row of cryptoRows) {
      const botId = row.bot_id;
      if (!botId || !cryptoBotStats[botId]) continue;

      const stat    = cryptoBotStats[botId];
      const status  = (row.status ?? '').toUpperCase();
      // paper_positions uses start_ts for opening time (NOT opened_at/created_at)
      const openTs = row.start_ts ?? null;
      // paper_positions uses pnl_usd (NOT pnl)
      const pnlUsd = Number(row.pnl_usd ?? 0);

      stat.total++;

      // Today: opened since midnight UTC
      if (openTs && new Date(openTs).getTime() >= midnightUTC.getTime()) {
        stat.today++;
        cryptoTradesToday++;
      }

      if (status === 'OPEN') {
        stat.open++;
      } else if (status === 'CLOSED' || status === 'SETTLED') {
        stat.closed++;

        // Derive win/loss from pnl_usd sign (no separate outcome column in paper_positions)
        const isWin  = pnlUsd > 0;
        const isLoss = pnlUsd < 0;
        if (isWin)       stat.wins++;
        else if (isLoss) stat.losses++;

        // Today P/L: positions closed today
        if (row.closed_at && new Date(row.closed_at).getTime() >= midnightUTC.getTime()) {
          stat.today_pnl = parseFloat((stat.today_pnl + pnlUsd).toFixed(4));
        }
        stat.all_time_pnl = parseFloat((stat.all_time_pnl + pnlUsd).toFixed(4));
      }
    }

    // Compute win rate
    for (const botId of CRYPTO_BOT_IDS) {
      const s = cryptoBotStats[botId];
      const denominator = s.wins + s.losses;
      s.win_rate = denominator > 0 ? parseFloat((s.wins / denominator).toFixed(4)) : 0;
    }

    return NextResponse.json(
      {
        ok: true,
        copy_bot_stats:     copyBotStats,
        crypto_bot_stats:   cryptoBotStats,
        copy_trades_today:  copyTradesToday,
        crypto_trades_today: cryptoTradesToday,
        midnight_utc:       midnightISO,   // for debugging
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[copy/bot-stats] error:', message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: NO_CACHE }
    );
  }
}
