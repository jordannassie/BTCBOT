// GET /api/copy/fresh-paper-season/preview
//
// Read-only safety preview for the "Replace Old Traders & Start Fresh Paper" workflow.
//
// Returns:
//   safety         — live_on, arm_live_bots, open_live_positions, all_clear
//   safety_blocks  — human-readable list of what must be fixed before proceeding
//   current_state  — counts of wallets / bots / positions / paper bankroll
//   candidates     — top 50 leaderboard traders scored for paper testing
//   recommended    — top 5 wallet addresses pre-selected as defaults
//
// No writes. No mutations. No trading execution.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE     = { 'Cache-Control': 'no-store, max-age=0' };
const LB_ENDPOINT  = 'https://data-api.polymarket.com/v1/leaderboard';
const PAPER_BOT_ID = 'copy_paper';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type LbRow = { addr: string; rank: number; pnl: number | null; volume: number | null; name: string | null };

async function fetchLbPeriod(timePeriod: string): Promise<LbRow[]> {
  try {
    const url = new URL(LB_ENDPOINT);
    url.searchParams.set('category', 'OVERALL');
    url.searchParams.set('timePeriod', timePeriod);
    url.searchParams.set('orderBy', 'PNL');
    url.searchParams.set('limit', '50');
    url.searchParams.set('offset', '0');

    const res = await fetch(url.toString(), {
      signal:  AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json', 'User-Agent': 'btcbot/1.0' },
      cache:   'no-store',
    });
    if (!res.ok) return [];

    const json = await res.json();
    const items: Record<string, unknown>[] = Array.isArray(json)
      ? json : (json.data ?? json.results ?? []);

    return items
      .map((e, idx) => {
        const addr = typeof e.proxyWallet === 'string' ? e.proxyWallet : null;
        if (!addr) return null;
        const rawRank = e.rank;
        const rank =
          typeof rawRank === 'number' ? rawRank
          : typeof rawRank === 'string' && !isNaN(Number(rawRank)) ? Number(rawRank)
          : idx + 1;
        const pnl =
          typeof e.pnl === 'number' ? e.pnl
          : typeof e.pnl === 'string' && !isNaN(Number(e.pnl)) ? Number(e.pnl)
          : null;
        const volume =
          typeof e.vol === 'number' ? e.vol
          : typeof e.vol === 'string' && !isNaN(Number(e.vol)) ? Number(e.vol)
          : null;
        return { addr, rank, pnl, volume, name: typeof e.userName === 'string' ? e.userName : null };
      })
      .filter((r): r is LbRow => r !== null);
  } catch {
    return [];
  }
}

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  try {
    // ── Parallel Supabase reads ───────────────────────────────────────────────
    const [settingsRes, botsRes, trackedRes, bankrollRes] = await Promise.all([
      client.from('copy_global_settings').select('live_on, emergency_stop').eq('id', 1).single(),
      client.from('copy_bots').select('id, wallet_address, mode, is_enabled, arm_live, opens_only, copy_closes'),
      client.from('tracked_wallets').select('wallet_address, tags').eq('is_active', true),
      client.from('bot_settings')
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .eq('bot_id', PAPER_BOT_ID)
        .maybeSingle(),
    ]);

    const bots       = (botsRes.data    ?? []) as { id: string; wallet_address: string; mode: string; is_enabled: boolean; arm_live: boolean; opens_only: boolean; copy_closes: boolean }[];
    const tracked    = (trackedRes.data ?? []) as { wallet_address: string; tags: string[] }[];
    const settings   = settingsRes.data;
    const bankroll   = bankrollRes.data;

    // ── Open position counts ──────────────────────────────────────────────────
    const paperBotIds = bots.filter((b) => b.mode === 'PAPER').map((b) => b.id);
    const liveBotIds  = bots.filter((b) => b.mode === 'LIVE').map((b) => b.id);

    const [openPaperCount, openLiveCount] = await Promise.all([
      paperBotIds.length > 0
        ? client.from('copied_positions').select('id', { count: 'exact', head: true })
            .eq('status', 'OPEN').in('copy_bot_id', paperBotIds)
            .then(({ count }) => count ?? 0)
        : Promise.resolve(0),
      liveBotIds.length > 0
        ? client.from('copied_positions').select('id', { count: 'exact', head: true })
            .eq('status', 'OPEN').in('copy_bot_id', liveBotIds)
            .then(({ count }) => count ?? 0)
        : Promise.resolve(0),
    ]);

    // ── Safety checks ─────────────────────────────────────────────────────────
    // BLOCKING: only an enabled LIVE bot with arm_live=true is genuinely dangerous.
    // Disabled or PAPER bots with stale arm_live values are cleaned up by the workflow.
    const dangerousArmLive = bots.filter((b) => b.arm_live && b.is_enabled && b.mode === 'LIVE').length;
    // INFORMATIONAL: total stale arm_live flags (will be cleared by the reset)
    const staleArmLive     = bots.filter((b) => b.arm_live).length;
    const liveBots         = bots.filter((b) => b.mode === 'LIVE').length;
    const safetyBlocks: string[] = [];

    if (settings?.live_on) {
      safetyBlocks.push('Global live trading gate is ON — turn it OFF before starting a fresh paper season');
    }
    if (dangerousArmLive > 0) {
      safetyBlocks.push(`${dangerousArmLive} enabled LIVE bot${dangerousArmLive !== 1 ? 's have' : ' has'} ARM LIVE on — disarm before proceeding`);
    }
    if (openLiveCount > 0) {
      safetyBlocks.push(`${openLiveCount} open LIVE position${openLiveCount !== 1 ? 's exist' : ' exists'} — these must close naturally before a fresh paper start`);
    }

    // Informational cleanup items (not blockers)
    const cleanupNotes: string[] = [];
    if (staleArmLive > 0) {
      cleanupNotes.push(`${staleArmLive} old bot${staleArmLive !== 1 ? 's' : ''} will be disarmed automatically`);
    }
    if (openPaperCount > 0) {
      cleanupNotes.push(`${openPaperCount} old paper position${openPaperCount !== 1 ? 's' : ''} will be archived before the fresh test starts`);
    }

    // ── Paper bankroll info ───────────────────────────────────────────────────
    const paperDefault: number =
      (bankroll?.strategy_settings as { paper_default?: number } | null)?.paper_default ?? 1000;

    // ── Build "blocked" wallet set (PERSONAL / AVOID tags) ────────────────────
    const blockedAddrs = new Set(
      tracked
        .filter((w) => w.tags?.some?.((t: string) => ['PERSONAL', 'AVOID'].includes(t?.toUpperCase?.() ?? '')))
        .map((w) => w.wallet_address)
    );

    // ── Existing bot wallet set ───────────────────────────────────────────────
    const trackedAddrs = new Set(tracked.map((w) => w.wallet_address));

    // ── Fetch leaderboard (all three periods in parallel) ────────────────────
    let candidates: {
      wallet_address:  string;
      display_name:    string | null;
      periods:         string[];
      best_rank:       number;
      best_pnl:        number | null;
      best_volume:     number | null;
      is_tracked:      boolean;
      is_blocked:      boolean;
    }[] = [];

    let leaderboard_error: string | null = null;
    try {
      const [dayRows, weekRows, monthRows] = await Promise.all([
        fetchLbPeriod('DAY'),
        fetchLbPeriod('WEEK'),
        fetchLbPeriod('MONTH'),
      ]);

      // Aggregate by wallet address across all periods
      const byAddr = new Map<string, { wallet_address: string; display_name: string | null; periods: string[]; best_rank: number; best_pnl: number | null; best_volume: number | null; sort_score: number }>();

      const addRows = (rows: LbRow[], label: string) => {
        for (const row of rows) {
          if (!row.addr.startsWith('0x')) continue;          // must be valid on-chain
          if (blockedAddrs.has(row.addr)) continue;          // skip PERSONAL/AVOID
          if (!byAddr.has(row.addr)) {
            byAddr.set(row.addr, {
              wallet_address: row.addr, display_name: row.name,
              periods: [label], best_rank: row.rank,
              best_pnl: row.pnl, best_volume: row.volume, sort_score: 0,
            });
          } else {
            const e = byAddr.get(row.addr)!;
            if (!e.periods.includes(label)) e.periods.push(label);
            if (row.rank < e.best_rank) {
              e.best_rank = row.rank;
              if (row.pnl != null) e.best_pnl = row.pnl;
              if (row.volume != null) e.best_volume = row.volume;
            }
          }
        }
      };

      addRows(dayRows, 'daily');
      addRows(weekRows, 'weekly');
      addRows(monthRows, 'monthly');

      // Sort score: period breadth × 10 000 − rank + bounded PnL bonus
      for (const [, c] of byAddr) {
        c.sort_score = (c.periods.length * 10_000) - c.best_rank + Math.min(c.best_pnl ?? 0, 500);
      }

      candidates = Array.from(byAddr.values())
        .sort((a, b) => b.sort_score - a.sort_score)
        .slice(0, 50)
        .map(({ sort_score: _s, ...rest }) => ({   // strip internal sort_score
          ...rest,
          is_tracked: trackedAddrs.has(rest.wallet_address),
          is_blocked: blockedAddrs.has(rest.wallet_address),
        }));
    } catch (err) {
      leaderboard_error = err instanceof Error ? err.message : 'Leaderboard unavailable';
    }

    // Default recommended = top 5 untracked profitable candidates
    const recommended_wallets = candidates
      .filter((c) => !c.is_blocked && (c.best_pnl ?? 0) > 0)
      .slice(0, 5)
      .map((c) => c.wallet_address);

    return NextResponse.json(
      {
        ok: true,
        safety: {
          live_on:              settings?.live_on          ?? false,
          emergency_stop:       settings?.emergency_stop   ?? false,
          arm_live_bots:        dangerousArmLive,       // blocking: enabled LIVE bots with arm_live
          stale_arm_live_bots:  staleArmLive,           // informational: all stale arm_live flags
          open_live_positions:  openLiveCount,
          all_clear:            safetyBlocks.length === 0,
        },
        safety_blocks: safetyBlocks,
        cleanup_notes: cleanupNotes,
        current_state: {
          total_wallets:        trackedAddrs.size,
          total_bots:           bots.length,
          enabled_bots:         bots.filter((b) => b.is_enabled).length,
          arm_live_bots:        dangerousArmLive,       // blocking count
          stale_arm_live_bots:  staleArmLive,           // informational count
          live_bots:            liveBots,
          open_paper_positions: openPaperCount,
          open_live_positions:  openLiveCount,
          paper_balance:        bankroll?.paper_balance_usd ?? paperDefault,
          paper_default:        paperDefault,
        },
        candidates,
        recommended_wallets,
        leaderboard_error,
        fetched_at: new Date().toISOString(),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
