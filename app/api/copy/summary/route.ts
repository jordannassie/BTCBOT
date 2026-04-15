// Clean copy-trading summary endpoint.
// All counts are sourced exclusively from copy-trading tables — no legacy
// bot_settings, paper-pnl, or BTC strategy data is referenced here.
//
// Counts:
//   walletsActive    → tracked_wallets WHERE is_active = true
//   walletsTotal     → tracked_wallets (all)
//   activeBotCount   → copy_bots WHERE is_enabled = true
//   botsTotal        → copy_bots (all, regardless of is_enabled)
//   openPositionCount→ copied_positions WHERE status = 'OPEN'
//   attemptsTodayCount → copy_attempts created since midnight UTC today
//
// Settings (live_on, emergency_stop) come from copy_global_settings id=1.
//
// force-dynamic: opt this route out of any static/incremental caching so
// every request hits Supabase and reflects the latest worker writes.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    // Start of today in UTC
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);

    const [
      activeWalletsRes,
      totalWalletsRes,
      enabledBotsRes,
      totalBotsRes,
      openPositionsRes,
      attemptsTodayRes,
      settingsRes,
    ] = await Promise.all([
      // Wallets the operator has marked active — monitored by the worker
      client
        .from('tracked_wallets')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),

      // All tracked wallets (including inactive) → shows "X of Y active"
      client
        .from('tracked_wallets')
        .select('*', { count: 'exact', head: true }),

      // Enabled copy bots (is_enabled = true)
      client
        .from('copy_bots')
        .select('*', { count: 'exact', head: true })
        .eq('is_enabled', true),

      // ALL copy bots regardless of enabled state → shows "X enabled / Y total"
      client
        .from('copy_bots')
        .select('*', { count: 'exact', head: true }),

      // OPEN copied positions only — never closed/cancelled
      client
        .from('copied_positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'OPEN'),

      // Copy decisions (attempts) made since midnight UTC today
      client
        .from('copy_attempts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayUTC.toISOString()),

      // Master safety settings
      client
        .from('copy_global_settings')
        .select('live_on, emergency_stop, max_total_live_exposure, default_slippage_cap, default_position_size, default_max_positions')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        // Wallets
        walletsActive: activeWalletsRes.count ?? 0,
        walletsTotal: totalWalletsRes.count ?? 0,
        walletCount: activeWalletsRes.count ?? 0,  // legacy alias
        // Bots — both enabled and total so UI can show "22 enabled / 24 total"
        activeBotCount: enabledBotsRes.count ?? 0,
        botsTotal: totalBotsRes.count ?? 0,
        // Positions — OPEN only; label must say "open" in the UI
        openPositionCount: openPositionsRes.count ?? 0,
        // Attempts — today only; refreshes at midnight UTC automatically
        attemptsTodayCount: attemptsTodayRes.count ?? 0,
        settings: settingsRes.data ?? null,
        // Server timestamp so the client can show "last updated X seconds ago"
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
