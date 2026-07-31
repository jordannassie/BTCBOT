// GET /api/copy/rotation-review
//
// Read-only. Returns the FastLoop trader rotation snapshot from Supabase.
//
// Table  : trader_rotation_snapshots
// Key    : snapshot_key = 'CURRENT'
// Writer : FastLoop worker — publish_trader_rotation_snapshot()
//
// This route does NOT recalculate recommendations, does NOT call the Polymarket
// leaderboard API, and does NOT query tracked_wallets, wallet_metrics,
// copy_bots, or copied_positions to rebuild logic.  It only reads the single
// pre-computed snapshot row and maps it into the shape the UI expects.
//
// No writes. No mutations. No trading execution.
//
// Stale threshold: 12 hours (43 200 seconds).

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE       = { 'Cache-Control': 'no-store, max-age=0' };
const STALE_SECONDS  = 12 * 60 * 60; // 12 hours

// ─── Type aliases (UI shapes) ─────────────────────────────────────────────────

type BotStatus   = 'ACTIVE' | 'EXIT_MONITOR_ONLY' | 'OFF' | 'NO_BOT';
type RotationRec = 'paper_test' | 'keep_active' | 'exit_monitor' | 'turn_off';

// ─── Field mappings from FastLoop → BTCBOT UI ─────────────────────────────────

// FastLoop recommended_status (uppercase)  →  UI RotationRec (snake_case)
const REC_MAP: Record<string, RotationRec> = {
  PAPER_TEST:        'paper_test',
  KEEP_ACTIVE:       'keep_active',
  EXIT_MONITOR_ONLY: 'exit_monitor',
  OFF:               'turn_off',
};

// FastLoop current_status  →  UI BotStatus
const STATUS_MAP: Record<string, BotStatus> = {
  ACTIVE:            'ACTIVE',
  EXIT_MONITOR_ONLY: 'EXIT_MONITOR_ONLY',
  OFF:               'OFF',
  NOT_TRACKED:       'NO_BOT',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type RawEntry = Record<string, unknown>;

/** Map a single FastLoop recommendation entry into the UI RotationRow shape. */
function mapEntry(entry: RawEntry, rec: RotationRec): Record<string, unknown> {
  const rawStatus = typeof entry.current_status === 'string' ? entry.current_status : 'OFF';
  return {
    wallet_address:      entry.wallet_address      ?? null,
    display_name:        entry.display_name        ?? null,
    username:            entry.username            ?? null, // FastLoop does not include xUsername
    recommendation:      rec,
    current_status:      STATUS_MAP[rawStatus]     ?? 'OFF',
    leaderboard_rank:    entry.leaderboard_rank    ?? null,
    leaderboard_pnl:     entry.daily_profit        ?? null, // FastLoop field name for period PnL
    copy_score:          entry.copy_score          ?? null,
    pnl_30d:             entry.pnl_30d             ?? null,
    median_hold_minutes: entry.median_hold_minutes ?? null,
    last_trade_at:       entry.last_trade_at       ?? null,
    open_positions:      entry.open_position_count ?? 0,   // FastLoop field name
    reason:              entry.reason              ?? null,
  };
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
    // ── Single read from trader_rotation_snapshots ────────────────────────────
    const { data, error } = await client
      .from('trader_rotation_snapshots')
      .select('recommendations, generated_at, updated_at, source, version')
      .eq('snapshot_key', 'CURRENT')
      .single();

    // ── No snapshot yet ───────────────────────────────────────────────────────
    if (error || !data) {
      return NextResponse.json(
        {
          ok:          true,
          rows:        [],
          summary:     { paper_test: 0, keep_active: 0, exit_monitor: 0, turn_off: 0 },
          no_snapshot: true,
          message:     'FastLoop has not published a rotation review yet.',
          fetched_at:  new Date().toISOString(),
        },
        { headers: NO_CACHE }
      );
    }

    // ── Staleness ─────────────────────────────────────────────────────────────
    const generatedAt  = data.generated_at as string;
    const ageSeconds   = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000);
    const stale        = ageSeconds > STALE_SECONDS;

    // ── Flatten recommendation groups into rows[] ─────────────────────────────
    const recs = data.recommendations as Record<string, unknown>;

    const groups: { key: string; rec: RotationRec }[] = [
      { key: 'paper_test',        rec: 'paper_test'   },
      { key: 'keep_active',       rec: 'keep_active'  },
      { key: 'exit_monitor_only', rec: 'exit_monitor' },
      { key: 'off',               rec: 'turn_off'     },
    ];

    const rows: ReturnType<typeof mapEntry>[] = [];
    for (const { key, rec } of groups) {
      const group = recs[key];
      if (Array.isArray(group)) {
        for (const entry of group as RawEntry[]) {
          rows.push(mapEntry(entry, rec));
        }
      }
    }

    // ── Summary (prefer FastLoop counts; recount as fallback) ─────────────────
    const rawSummary = recs.summary as Record<string, number> | undefined;
    const summary = {
      paper_test:   rawSummary?.paper_test_count        ?? rows.filter((r) => r.recommendation === 'paper_test').length,
      keep_active:  rawSummary?.keep_active_count       ?? rows.filter((r) => r.recommendation === 'keep_active').length,
      exit_monitor: rawSummary?.exit_monitor_only_count ?? rows.filter((r) => r.recommendation === 'exit_monitor').length,
      turn_off:     rawSummary?.off_count               ?? rows.filter((r) => r.recommendation === 'turn_off').length,
    };

    console.log(
      `ROTATION_REVIEW_READ source=${data.source ?? 'FASTLOOP'} ` +
      `v=${data.version} age=${ageSeconds}s stale=${stale} ` +
      `paper=${summary.paper_test} keep=${summary.keep_active} ` +
      `exit=${summary.exit_monitor} off=${summary.turn_off}`
    );

    return NextResponse.json(
      {
        ok:           true,
        rows,
        summary,
        generated_at: generatedAt,
        updated_at:   data.updated_at,
        source:       data.source ?? 'FASTLOOP',
        version:      data.version,
        age_seconds:  ageSeconds,
        stale,
        fetched_at:   new Date().toISOString(),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
