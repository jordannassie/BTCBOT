// Clean copy-trading summary endpoint.
// All counts are sourced exclusively from copy-trading tables — no legacy
// bot_settings, paper-pnl, or BTC strategy data is referenced here.
//
// Counts:
//   wallets_active   → tracked_wallets WHERE is_active = true
//   wallets_total    → tracked_wallets (all)
//   bots_enabled     → copy_bots WHERE is_enabled = true
//   positions_open   → copied_positions WHERE status = 'OPEN'
//   attempts_today   → copy_attempts created since midnight UTC today
//
// Settings (live_on, emergency_stop) come from copy_global_settings id=1.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
      openPositionsRes,
      attemptsTodayRes,
      settingsRes,
    ] = await Promise.all([
      // Only count wallets the operator has marked active — these are the wallets
      // actually being monitored by the worker right now.
      client
        .from('tracked_wallets')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true),

      // Total tracked (including inactive) so the UI can show "X of Y active"
      client
        .from('tracked_wallets')
        .select('*', { count: 'exact', head: true }),

      // Enabled copy bots
      client
        .from('copy_bots')
        .select('*', { count: 'exact', head: true })
        .eq('is_enabled', true),

      // Open copied positions from copy-trading table only
      client
        .from('copied_positions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'OPEN'),

      // Copy decisions made since midnight UTC today
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

    return NextResponse.json({
      ok: true,
      // Active vs total wallets
      walletsActive: activeWalletsRes.count ?? 0,
      walletsTotal: totalWalletsRes.count ?? 0,
      // Legacy field name kept for CopyOverviewCards compatibility
      walletCount: activeWalletsRes.count ?? 0,
      activeBotCount: enabledBotsRes.count ?? 0,
      openPositionCount: openPositionsRes.count ?? 0,
      attemptsTodayCount: attemptsTodayRes.count ?? 0,
      settings: settingsRes.data ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
