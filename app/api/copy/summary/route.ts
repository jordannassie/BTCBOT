// /api/copy/summary  —  copy-trading dashboard summary
//
// ROUTE_VERSION is returned in every response.  Check this field in DevTools
// to confirm the deployed build is running the latest code.
//
// Counts / aggregates:
//   walletsActive       → tracked_wallets WHERE is_active = true
//   walletsTotal        → tracked_wallets (all)
//   activeBotCount      → copy_bots WHERE is_enabled = true
//   botsTotal           → copy_bots (all)
//   openPositionCount   → copy_open_position_stats() RPC  ← total (PAPER + LIVE)
//   openExposure        → copy_open_position_stats() RPC  ← SUM(size) total
//   avgOpenSize         → copy_open_position_stats() RPC  ← AVG(size) total
//   largestOpenPosition → copy_open_position_stats() RPC  ← MAX(size) total
//   paperPositionCount  → copy_open_exposure_by_mode() RPC  ← PAPER mode only
//   paperExposure       → copy_open_exposure_by_mode() RPC  ← PAPER SUM(size)
//   paperAvgSize        → copy_open_exposure_by_mode() RPC  ← PAPER AVG(size)
//   livePositionCount   → copy_open_exposure_by_mode() RPC  ← LIVE mode only
//   liveExposure        → copy_open_exposure_by_mode() RPC  ← LIVE SUM(size)
//   liveAvgSize         → copy_open_exposure_by_mode() RPC  ← LIVE AVG(size)
//   attemptsTodayCount  → copy_attempts since midnight UTC
//
// Both RPC functions must exist in Supabase with GRANT EXECUTE for service_role
// (see sql/migrations/0005-aggregate-functions.sql).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Bumped on every fix to this route — visible in response JSON.
const ROUTE_VERSION = 'v8-crypto-exposure';

// Crypto strategy bot IDs tracked by this dashboard
const CRYPTO_BOT_IDS = ['btc_5m_late'] as const;

function makeClient() {
  let url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (url.startsWith('$') || !url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const client = makeClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing', route_version: ROUTE_VERSION },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  try {
    // ── Run all queries in parallel ────────────────────────────────────────────
    const [
      activeWalletsRes,
      totalWalletsRes,
      enabledBotsRes,
      totalBotsRes,
      paperBotsRes,         // enabled bots in PAPER mode → "Active Trading Bots (paper)"
      armLiveBotsRes,       // enabled bots with arm_live = true → "ARM LIVE Bots"
      openStatsRes,         // overall totals (PAPER + LIVE combined)
      modeStatsRes,         // per-mode split — drives the labelled overview cards
      attemptsTodayRes,
      recentClosedRes,      // CLOSED positions last 24 h — for overview perf card
      settingsRes,
      cryptoBotsRes,        // enabled crypto strategy bots (btc_5m_late etc.)
      cryptoPaperPosRes,    // open paper_positions for btc_5m_late — crypto paper exposure
      copyTradesTodayRes,   // copied_positions opened since midnight UTC
      cryptoTradesTodayRes, // paper_positions (btc_5m_late) opened since midnight UTC
    ] = await Promise.all([
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }).eq('is_active', true),
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }),
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true),
      client.from('copy_bots').select('*', { count: 'exact', head: true }),
      // Enabled bots in PAPER mode — shown on the Paper Bankroll card.
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true).eq('mode', 'PAPER'),
      // Enabled bots with arm_live = true — shown on the Live Bankroll card.
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true).eq('arm_live', true),

      // Overall totals — COUNT/SUM/AVG/MAX with INNER JOIN copy_bots (no orphans).
      // Result = SUM(PAPER) + SUM(LIVE), no row cap.
      client.rpc('copy_open_position_stats'),

      // Per-mode split — same INNER JOIN, grouped by copy_bots.mode.
      // Returns one row per mode (LIVE / PAPER) for clearly labelled UI cards.
      client.rpc('copy_open_exposure_by_mode'),

      client.from('copy_attempts').select('*', { count: 'exact', head: true }).gte('created_at', todayUTC.toISOString()),
      // Recent closed positions (last 24 h) — cheap: max 50 rows, pnl only.
      // Used for the "Closed Today" overview card.
      client.from('copied_positions')
        .select('pnl')
        .eq('status', 'CLOSED')
        .gte('closed_at', new Date(Date.now() - 86_400_000).toISOString())
        .limit(50),
      client.from('copy_global_settings')
        .select('live_on, emergency_stop, max_total_live_exposure, default_slippage_cap, default_position_size, default_max_positions')
        .eq('id', 1)
        .maybeSingle(),
      // Crypto strategy bots — separate count for tab badge
      client.from('bot_settings').select('*', { count: 'exact', head: true })
        .eq('is_enabled', true)
        .in('bot_id', CRYPTO_BOT_IDS as unknown as string[]),
      // Crypto paper positions (btc_5m_late strategy) — for Crypto Paper Exposure card
      client.from('paper_positions')
        .select('trade_size_usd')
        .eq('bot_id', 'btc_5m_late')
        .eq('status', 'OPEN'),
      // Copy Trades Today — copied_positions opened since midnight UTC
      client.from('copied_positions')
        .select('*', { count: 'exact', head: true })
        .gte('opened_at', todayUTC.toISOString()),
      // Crypto Trades Today — paper_positions for btc_5m_late opened since midnight UTC
      client.from('paper_positions')
        .select('*', { count: 'exact', head: true })
        .eq('bot_id', 'btc_5m_late')
        .gte('opened_at', todayUTC.toISOString()),
    ]);

    // ── Surface overall totals ─────────────────────────────────────────────────
    const rpcError = openStatsRes.error ?? null;
    const rpcRaw   = openStatsRes.data ?? null;

    if (rpcError) {
      console.error(`[summary ${ROUTE_VERSION}] copy_open_position_stats FAILED:`, rpcError);
    }

    type StatsRow = { total_count: unknown; total_exposure: unknown; avg_size: unknown; max_size: unknown };
    const statsRow = (rpcRaw as StatsRow[] | null)?.[0] ?? null;

    const openPositionCount   = statsRow ? Number(statsRow.total_count)    : 0;
    const openExposure        = statsRow ? Number(statsRow.total_exposure)  : 0;
    const avgOpenSize         = statsRow ? Number(statsRow.avg_size)        : 0;
    const largestOpenPosition = statsRow ? Number(statsRow.max_size)        : 0;

    // ── Surface per-mode split ─────────────────────────────────────────────────
    if (modeStatsRes.error) {
      console.error(`[summary ${ROUTE_VERSION}] copy_open_exposure_by_mode FAILED:`, modeStatsRes.error);
    }

    type ModeRow = { mode: string; total_count: unknown; total_exposure: unknown; avg_size: unknown };
    const modeRows  = (modeStatsRes.data ?? []) as ModeRow[];
    const paperRow  = modeRows.find((r) => r.mode === 'PAPER');
    const liveRow   = modeRows.find((r) => r.mode === 'LIVE');

    const paperPositionCount = paperRow ? Number(paperRow.total_count)    : 0;
    const paperExposure      = paperRow ? Number(paperRow.total_exposure)  : 0;
    const paperAvgSize       = paperRow ? Number(paperRow.avg_size)        : 0;
    const livePositionCount  = liveRow  ? Number(liveRow.total_count)     : 0;
    const liveExposure       = liveRow  ? Number(liveRow.total_exposure)   : 0;
    const liveAvgSize        = liveRow  ? Number(liveRow.avg_size)         : 0;

    console.log(`[summary ${ROUTE_VERSION}] total: count=${openPositionCount} exposure=${openExposure} | paper: count=${paperPositionCount} exposure=${paperExposure} | live: count=${livePositionCount} exposure=${liveExposure}`);

    // ── Recent closed positions (last 24 h) ───────────────────────────────────
    const recentClosedRows   = (recentClosedRes.data ?? []) as { pnl: number }[];
    const recentClosedCount  = recentClosedRows.length;
    const recentAvgPnl       = recentClosedCount > 0
      ? recentClosedRows.reduce((s, r) => s + (Number(r.pnl) || 0), 0) / recentClosedCount
      : null;

    // ── Crypto paper exposure (btc_5m_late open paper_positions) ──────────────
    const cryptoPaperRows = (cryptoPaperPosRes.data ?? []) as { trade_size_usd?: unknown }[];
    const cryptoPaperPositionCount = cryptoPaperRows.length;
    const cryptoPaperExposure = cryptoPaperRows.reduce((sum, r) => {
      const v = Number(r.trade_size_usd ?? 0);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);

    // ── Bot-mode counts ────────────────────────────────────────────────────────
    const paperBotsEnabled  = paperBotsRes.count   ?? 0;
    const armLiveBotsCount  = armLiveBotsRes.count ?? 0;
    // "Live Active Now" = ARM LIVE bots that can actually fire: requires master
    // live_on gate to be open.  Computed here so the client has a single truth.
    const liveOn            = (settingsRes.data as { live_on?: boolean } | null)?.live_on ?? false;
    const liveActiveNow     = liveOn ? armLiveBotsCount : 0;

    // ── Response ───────────────────────────────────────────────────────────────
    return NextResponse.json(
      {
        ok: true,
        route_version: ROUTE_VERSION,

        // Wallets
        walletsActive: activeWalletsRes.count ?? 0,
        walletsTotal:  totalWalletsRes.count  ?? 0,
        walletCount:   activeWalletsRes.count ?? 0,  // legacy alias

        // Copy-trader bots
        activeBotCount: enabledBotsRes.count ?? 0,
        botsTotal:      totalBotsRes.count   ?? 0,
        // Bots — mode-specific counts for bankroll card status lines
        paperBotsEnabled,   // enabled bots in PAPER mode
        armLiveBotsCount,   // enabled bots with arm_live = true
        liveActiveNow,      // armLiveBotsCount when live_on is true, else 0

        // Crypto strategy bots (btc_5m_late etc.) — separate count for Crypto Bots tab badge
        activeCryptoBotCount: cryptoBotsRes.count ?? 0,

        // Crypto paper exposure — open paper_positions for btc_5m_late
        cryptoPaperPositionCount,
        cryptoPaperExposure,

        // Trade counts today (separate from attemptsTodayCount)
        copyTradesToday:  copyTradesTodayRes.count  ?? 0,
        cryptoTradesToday: cryptoTradesTodayRes.count ?? 0,

        // OPEN positions — overall totals (PAPER + LIVE combined)
        openPositionCount,
        openExposure,
        avgOpenSize,
        largestOpenPosition,

        // OPEN positions — per-mode split (drives labelled overview cards)
        paperPositionCount,
        paperExposure,
        paperAvgSize,
        livePositionCount,
        liveExposure,
        liveAvgSize,

        // Attempts
        attemptsTodayCount: attemptsTodayRes.count ?? 0,

        // Recent closed positions (last 24 h) — for overview perf card
        recentClosedCount,
        recentAvgPnl,

        // Settings
        settings: settingsRes.data ?? null,

        // Server timestamp
        fetchedAt: new Date().toISOString(),

        // _debug — visible in DevTools Network tab without Netlify log access.
        _debug: {
          route_version: ROUTE_VERSION,
          stats_rpc_error: rpcError,
          stats_rpc_raw:   rpcRaw,
          mode_rpc_error:  modeStatsRes.error ?? null,
          mode_rpc_raw:    modeStatsRes.data  ?? null,
          resolved: {
            total:  { openPositionCount, openExposure, avgOpenSize, largestOpenPosition },
            paper:  { paperPositionCount, paperExposure, paperAvgSize },
            live:   { livePositionCount,  liveExposure,  liveAvgSize },
          },
        },
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[summary ${ROUTE_VERSION}] uncaught error:`, message);
    return NextResponse.json(
      { ok: false, error: message, route_version: ROUTE_VERSION },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
