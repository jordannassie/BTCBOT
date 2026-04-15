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
const ROUTE_VERSION = 'v5-mode-split';

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
      openStatsRes,   // overall totals (PAPER + LIVE combined)
      modeStatsRes,   // per-mode split — drives the labelled overview cards
      attemptsTodayRes,
      settingsRes,
    ] = await Promise.all([
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }).eq('is_active', true),
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }),
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true),
      client.from('copy_bots').select('*', { count: 'exact', head: true }),

      // Overall totals — COUNT/SUM/AVG/MAX with INNER JOIN copy_bots (no orphans).
      // Result = SUM(PAPER) + SUM(LIVE), no row cap.
      client.rpc('copy_open_position_stats'),

      // Per-mode split — same INNER JOIN, grouped by copy_bots.mode.
      // Returns one row per mode (LIVE / PAPER) for clearly labelled UI cards.
      client.rpc('copy_open_exposure_by_mode'),

      client.from('copy_attempts').select('*', { count: 'exact', head: true }).gte('created_at', todayUTC.toISOString()),
      client.from('copy_global_settings')
        .select('live_on, emergency_stop, max_total_live_exposure, default_slippage_cap, default_position_size, default_max_positions')
        .eq('id', 1)
        .maybeSingle(),
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

    // ── Response ───────────────────────────────────────────────────────────────
    return NextResponse.json(
      {
        ok: true,
        route_version: ROUTE_VERSION,  // remove once confirmed working

        // Wallets
        walletsActive: activeWalletsRes.count ?? 0,
        walletsTotal:  totalWalletsRes.count  ?? 0,
        walletCount:   activeWalletsRes.count ?? 0,  // legacy alias

        // Bots
        activeBotCount: enabledBotsRes.count ?? 0,
        botsTotal:      totalBotsRes.count   ?? 0,

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
