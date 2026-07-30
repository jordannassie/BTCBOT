// GET /api/copy/rotation-review
//
// Read-only. Computes trader rotation recommendations from:
//   - tracked_wallets + wallet_metrics (Supabase)
//   - copy_bots (Supabase) — current per-bot status
//   - copied_positions WHERE status=OPEN (Supabase) — open position counts
//   - Polymarket monthly leaderboard (public read-only API)
//
// No writes. No mutations. No trading execution.
//
// Recommendation rules:
//   paper_test    — on monthly leaderboard, not yet tracked, PNL > 0
//   keep_active   — tracked + on monthly leaderboard
//   exit_monitor  — tracked + active bot + not on leaderboard + has open positions
//   turn_off      — tracked + active bot + not on leaderboard + no open positions

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };
const LB_ENDPOINT = 'https://data-api.polymarket.com/v1/leaderboard';

// ─── Types ────────────────────────────────────────────────────────────────────

type BotStatus   = 'ACTIVE' | 'EXIT_MONITOR_ONLY' | 'OFF' | 'NO_BOT';
type RotationRec = 'paper_test' | 'keep_active' | 'exit_monitor' | 'turn_off';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getBotStatus(
  bot: { is_enabled: boolean; opens_only: boolean; copy_closes: boolean } | null
): BotStatus {
  if (!bot)               return 'NO_BOT';
  if (!bot.is_enabled)    return 'OFF';
  if (bot.opens_only && bot.copy_closes) return 'EXIT_MONITOR_ONLY';
  return 'ACTIVE';
}

// ─── Leaderboard fetch (monthly, read-only) ───────────────────────────────────

type LbEntry = { rank: number; pnl: number | null; name: string | null; username: string | null };

async function fetchMonthlyLeaderboard(): Promise<Map<string, LbEntry>> {
  const url = new URL(LB_ENDPOINT);
  url.searchParams.set('category', 'OVERALL');
  url.searchParams.set('timePeriod', 'MONTH');
  url.searchParams.set('orderBy', 'PNL');
  url.searchParams.set('limit', '50');
  url.searchParams.set('offset', '0');

  const res = await fetch(url.toString(), {
    signal:  AbortSignal.timeout(8_000),
    headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
    cache:   'no-store',
  });

  if (!res.ok) throw new Error(`Leaderboard HTTP ${res.status}`);

  const json = await res.json();
  const items: Record<string, unknown>[] = Array.isArray(json)
    ? json
    : (json.data ?? json.results ?? []);

  const map = new Map<string, LbEntry>();
  for (const [idx, e] of items.entries()) {
    const addr = typeof e.proxyWallet === 'string' ? e.proxyWallet : null;
    if (!addr) continue;
    const rawRank = e.rank;
    const rank =
      typeof rawRank === 'number'                               ? rawRank
      : typeof rawRank === 'string' && !isNaN(Number(rawRank)) ? Number(rawRank)
      : idx + 1;
    const pnl =
      typeof e.pnl === 'number'                               ? e.pnl
      : typeof e.pnl === 'string' && !isNaN(Number(e.pnl))   ? Number(e.pnl)
      : null;
    map.set(addr, {
      rank,
      pnl,
      name:     typeof e.userName  === 'string' ? e.userName  : null,
      username: typeof e.xUsername === 'string' ? e.xUsername : null,
    });
  }
  return map;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // Fetch all Supabase data in parallel (read-only selects only)
    const [walletsRes, botsRes, openPosRes] = await Promise.all([
      client.from('tracked_wallets').select('wallet_address, display_name, is_active'),
      client.from('copy_bots').select('id, wallet_address, is_enabled, opens_only, copy_closes, mode'),
      client.from('copied_positions').select('copy_bot_id').eq('status', 'OPEN'),
    ]);

    // Metrics are best-effort (may not exist for every wallet)
    const { data: metricsData } = await client
      .from('wallet_metrics')
      .select('wallet_address, copy_score, pnl_30d, median_hold_minutes, last_trade_at');

    // Fetch monthly leaderboard (best-effort — degrade gracefully on failure)
    let lbMap  = new Map<string, LbEntry>();
    let lbError: string | null = null;
    try {
      lbMap = await fetchMonthlyLeaderboard();
    } catch (err) {
      lbError = err instanceof Error ? err.message : 'Leaderboard unavailable';
    }

    if (walletsRes.error) {
      return NextResponse.json(
        { ok: false, error: walletsRes.error.message },
        { status: 500, headers: NO_CACHE }
      );
    }

    // Typed row helpers
    const wallets  = (walletsRes.data ?? []) as { wallet_address: string; display_name: string | null; is_active: boolean }[];
    const bots     = (botsRes.data  ?? []) as { id: string; wallet_address: string; is_enabled: boolean; opens_only: boolean; copy_closes: boolean; mode: string }[];
    const openPos  = (openPosRes.data ?? []) as { copy_bot_id: string }[];
    const metrics  = (metricsData ?? []) as { wallet_address: string; copy_score: number | null; pnl_30d: number | null; median_hold_minutes: number | null; last_trade_at: string | null }[];

    // Build lookup maps
    const metricsMap = new Map(metrics.map((m) => [m.wallet_address, m]));

    // Per-wallet bot map: when a wallet has multiple bots, prefer LIVE over PAPER
    const botMap = new Map<string, typeof bots[0]>();
    for (const bot of bots) {
      const existing = botMap.get(bot.wallet_address);
      if (!existing || bot.mode === 'LIVE') botMap.set(bot.wallet_address, bot);
    }

    // Open position counts: copy_bot_id → count, then aggregate by wallet_address
    const openByBotId = new Map<string, number>();
    for (const pos of openPos) {
      openByBotId.set(pos.copy_bot_id, (openByBotId.get(pos.copy_bot_id) ?? 0) + 1);
    }
    const openByWallet = new Map<string, number>();
    for (const bot of bots) {
      const n = openByBotId.get(bot.id) ?? 0;
      if (n > 0) openByWallet.set(bot.wallet_address, (openByWallet.get(bot.wallet_address) ?? 0) + n);
    }

    const trackedSet = new Set(wallets.map((w) => w.wallet_address));

    type RotRow = {
      wallet_address:      string;
      display_name:        string | null;
      username:            string | null;
      recommendation:      RotationRec;
      current_status:      BotStatus;
      leaderboard_rank:    number | null;
      leaderboard_pnl:     number | null;
      copy_score:          number | null;
      pnl_30d:             number | null;
      median_hold_minutes: number | null;
      last_trade_at:       string | null;
      open_positions:      number;
      reason:              string;
    };

    const rows: RotRow[] = [];

    // ── Tracked wallets → compute recommendation ──────────────────────────────
    for (const w of wallets) {
      const bot       = botMap.get(w.wallet_address) ?? null;
      const status    = getBotStatus(bot);
      const lb        = lbMap.get(w.wallet_address)  ?? null;
      const m         = metricsMap.get(w.wallet_address) ?? null;
      const openCount = openByWallet.get(w.wallet_address) ?? 0;

      // Skip OFF/NO_BOT wallets not on the leaderboard — nothing actionable to show
      if (status === 'OFF'    && !lb) continue;
      if (status === 'NO_BOT' && !lb) continue;

      let recommendation: RotationRec;
      let reason: string;

      if (lb) {
        recommendation = 'keep_active';
        reason = `Rank #${lb.rank} on monthly leaderboard`;
      } else if (status === 'ACTIVE') {
        if (openCount > 0) {
          recommendation = 'exit_monitor';
          reason = `Not on leaderboard · ${openCount} open position${openCount !== 1 ? 's' : ''}`;
        } else {
          recommendation = 'turn_off';
          reason = 'Not on monthly leaderboard · no open positions';
        }
      } else if (status === 'EXIT_MONITOR_ONLY') {
        if (openCount > 0) {
          recommendation = 'exit_monitor';
          reason = `On exit monitor · ${openCount} open position${openCount !== 1 ? 's' : ''}`;
        } else {
          recommendation = 'turn_off';
          reason = 'Not on leaderboard · exit monitor mode · no open positions';
        }
      } else {
        // OFF or NO_BOT but IS on the leaderboard → suggest reactivating
        recommendation = 'keep_active';
        reason = `Rank #${lb!.rank} — consider reactivating`;
      }

      rows.push({
        wallet_address:      w.wallet_address,
        display_name:        w.display_name ?? lb?.name ?? null,
        username:            lb?.username ?? null,
        recommendation,
        current_status:      status,
        leaderboard_rank:    lb?.rank ?? null,
        leaderboard_pnl:     lb?.pnl  ?? null,
        copy_score:          m?.copy_score          ?? null,
        pnl_30d:             m?.pnl_30d             ?? null,
        median_hold_minutes: m?.median_hold_minutes  ?? null,
        last_trade_at:       m?.last_trade_at        ?? null,
        open_positions:      openCount,
        reason,
      });
    }

    // ── Untracked leaderboard traders → suggest Paper Test ────────────────────
    for (const [addr, lb] of lbMap.entries()) {
      if (trackedSet.has(addr)) continue;
      if (lb.pnl == null || lb.pnl <= 0) continue; // profitable only
      rows.push({
        wallet_address:      addr,
        display_name:        lb.name,
        username:            lb.username,
        recommendation:      'paper_test',
        current_status:      'NO_BOT',
        leaderboard_rank:    lb.rank,
        leaderboard_pnl:     lb.pnl,
        copy_score:          null,
        pnl_30d:             null,
        median_hold_minutes: null,
        last_trade_at:       null,
        open_positions:      0,
        reason:              `Rank #${lb.rank} by monthly PNL — not yet tracked`,
      });
    }

    // Sort: paper_test → keep_active → exit_monitor → turn_off; within each group by lb rank
    const ORDER: Record<RotationRec, number> = {
      paper_test: 0, keep_active: 1, exit_monitor: 2, turn_off: 3,
    };
    rows.sort((a, b) => {
      const od = ORDER[a.recommendation] - ORDER[b.recommendation];
      if (od !== 0) return od;
      return (a.leaderboard_rank ?? 999) - (b.leaderboard_rank ?? 999);
    });

    const summary = {
      paper_test:   rows.filter((r) => r.recommendation === 'paper_test').length,
      keep_active:  rows.filter((r) => r.recommendation === 'keep_active').length,
      exit_monitor: rows.filter((r) => r.recommendation === 'exit_monitor').length,
      turn_off:     rows.filter((r) => r.recommendation === 'turn_off').length,
    };

    console.log(
      `ROTATION_REVIEW paper_test=${summary.paper_test} keep=${summary.keep_active}` +
      ` exit=${summary.exit_monitor} off=${summary.turn_off} lb_error=${lbError ?? 'none'}`
    );

    return NextResponse.json(
      {
        ok: true,
        rows,
        summary,
        leaderboard_error: lbError,
        fetched_at: new Date().toISOString(),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
