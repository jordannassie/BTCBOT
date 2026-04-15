// /api/copy/summary  —  copy-trading dashboard summary
//
// ROUTE_VERSION is returned in every response.  If you see "v3-rpc" in the
// JSON then this build is running.  If you see anything else (or the field is
// absent) then Netlify is still serving a cached older build.
//
// Counts / aggregates:
//   walletsActive      → tracked_wallets WHERE is_active = true
//   walletsTotal       → tracked_wallets (all)
//   activeBotCount     → copy_bots WHERE is_enabled = true
//   botsTotal          → copy_bots (all)
//   openPositionCount  → copy_open_position_stats() RPC  ← DB aggregate, no row cap
//   openExposure       → copy_open_position_stats() RPC  ← SUM(size), no row cap
//   avgOpenSize        → copy_open_position_stats() RPC  ← AVG(size), no row cap
//   largestOpenPosition→ copy_open_position_stats() RPC  ← MAX(size), no row cap
//   attemptsTodayCount → copy_attempts since midnight UTC
//
// The RPC function must exist in Supabase and GRANT EXECUTE must have been
// run for service_role (see sql/migrations/0005-aggregate-functions.sql).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Bumped on every fix to this route — visible in response JSON.
const ROUTE_VERSION = 'v3-rpc';

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
      openStatsRes,        // ← DB aggregate function: no 1000-row cap
      attemptsTodayRes,
      settingsRes,
    ] = await Promise.all([
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }).eq('is_active', true),
      client.from('tracked_wallets').select('*', { count: 'exact', head: true }),
      client.from('copy_bots').select('*', { count: 'exact', head: true }).eq('is_enabled', true),
      client.from('copy_bots').select('*', { count: 'exact', head: true }),

      // copy_open_position_stats() runs COUNT/SUM/AVG/MAX inside PostgreSQL.
      // It is completely unbounded — it will return the true total for any number
      // of OPEN rows, whether there are 100 or 100 000.
      // Created by sql/migrations/0005-aggregate-functions.sql.
      client.rpc('copy_open_position_stats'),

      client.from('copy_attempts').select('*', { count: 'exact', head: true }).gte('created_at', todayUTC.toISOString()),
      client.from('copy_global_settings')
        .select('live_on, emergency_stop, max_total_live_exposure, default_slippage_cap, default_position_size, default_max_positions')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    // ── Surface RPC result ─────────────────────────────────────────────────────
    const rpcError = openStatsRes.error ?? null;
    const rpcRaw   = openStatsRes.data ?? null;

    if (rpcError) {
      console.error(`[summary ${ROUTE_VERSION}] copy_open_position_stats FAILED:`, rpcError);
    } else {
      console.log(`[summary ${ROUTE_VERSION}] copy_open_position_stats OK:`, JSON.stringify(rpcRaw));
    }

    // The function returns one row.  Supabase wraps RETURNS TABLE results in an
    // array, so index [0].  All four columns are numeric; Number() handles both
    // numeric-as-string (Postgres JSON) and native number.
    type StatsRow = { total_count: unknown; total_exposure: unknown; avg_size: unknown; max_size: unknown };
    const row = (rpcRaw as StatsRow[] | null)?.[0] ?? null;

    const openPositionCount   = row ? Number(row.total_count)    : 0;
    const openExposure        = row ? Number(row.total_exposure)  : 0;
    const avgOpenSize         = row ? Number(row.avg_size)        : 0;
    const largestOpenPosition = row ? Number(row.max_size)        : 0;

    console.log(`[summary ${ROUTE_VERSION}] resolved: count=${openPositionCount} exposure=${openExposure}`);

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

        // OPEN positions — true totals from DB aggregate, no row cap
        openPositionCount,
        openExposure,
        avgOpenSize,
        largestOpenPosition,

        // Attempts
        attemptsTodayCount: attemptsTodayRes.count ?? 0,

        // Settings
        settings: settingsRes.data ?? null,

        // Server timestamp
        fetchedAt: new Date().toISOString(),

        // _debug — visible in DevTools Network tab without Netlify log access.
        // Shows exactly what the RPC returned so you can diagnose any mismatch.
        _debug: {
          route_version: ROUTE_VERSION,
          rpc_called:    'copy_open_position_stats',
          rpc_error:     rpcError,
          rpc_raw:       rpcRaw,
          resolved: { openPositionCount, openExposure, avgOpenSize, largestOpenPosition },
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
