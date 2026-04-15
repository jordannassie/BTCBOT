// Open-position exposure split by bot mode (LIVE vs PAPER),
// enriched with the configured exposure caps from copy_global_settings.
//
// Convention: cap = 0 means unlimited (no enforcement).
//
// Response shape:
//   live: {
//     count, exposure, avg,
//     cap,        ← live_max_exposure_usd (0 = unlimited)
//     remaining,  ← cap - exposure when cap > 0, else null
//   }
//   paper: { same, using paper_max_exposure_usd }
//
// Exposure source: copied_positions.size (the sole sizing column, displayed
// as "Size ($)" in the positions table UI — interpreted as USD).
//
// ACCURACY NOTE
// -------------
// A plain select('size').eq('status','OPEN') is capped at 1 000 rows by
// Supabase PostgREST.  This route uses rpc('copy_open_exposure_by_mode')
// instead — a PostgreSQL aggregate function that runs COUNT/SUM/AVG on the
// full table with no row limit.  The migration that creates this function
// is sql/migrations/0005-aggregate-functions.sql.
//
// This endpoint is consumed by:
//   - LiveCard + CopyPaperBankrollCard (display)
//   - /api/copy/exposure-check (pre-trade enforcement helper)

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

function buildResult(
  row: { total_count: number | string; total_exposure: number | string; avg_size: number | string } | undefined,
  cap: number,
) {
  const count    = row ? Number(row.total_count)    : 0;
  const exposure = row ? Number(row.total_exposure) : 0;
  const avg      = row ? Number(row.avg_size)       : 0;
  const remaining = cap > 0 ? Math.max(0, cap - exposure) : null;
  return { count, exposure, avg, cap, remaining };
}

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500 }
    );
  }

  try {
    // Run both reads in parallel.
    // copy_open_exposure_by_mode() uses COUNT/SUM/AVG in PostgreSQL — no row cap.
    const [modeRes, settingsRes] = await Promise.all([
      client.rpc('copy_open_exposure_by_mode'),
      client
        .from('copy_global_settings')
        .select('live_max_exposure_usd, paper_max_exposure_usd')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    if (modeRes.error) {
      console.error('[exposure] copy_open_exposure_by_mode RPC FAILED:', modeRes.error);
      throw modeRes.error;
    }
    console.log('[exposure] copy_open_exposure_by_mode RPC OK, rows:', JSON.stringify(modeRes.data));

    // Settings error is FATAL: returning cap=0 when the real cap is non-zero would show
    // "Unlimited" on the cards — which is a worse UX than showing an error. If the SELECT
    // fails the client keeps whatever cap it last knew about (loadExposure returns early
    // on !p.ok), so the operator never sees a stale "Unlimited" label.
    if (settingsRes.error) {
      console.error('[exposure] copy_global_settings SELECT FAILED:', settingsRes.error);
      return NextResponse.json(
        { ok: false, error: settingsRes.error.message ?? 'Settings read failed' },
        { status: 500 }
      );
    }

    const settings = settingsRes.data as {
      live_max_exposure_usd: number;
      paper_max_exposure_usd: number;
    } | null;

    const liveCap  = settings?.live_max_exposure_usd  ?? 0;
    const paperCap = settings?.paper_max_exposure_usd ?? 0;

    type ModeRow = { mode: string; total_count: number; total_exposure: number; avg_size: number };
    const rows = (modeRes.data ?? []) as ModeRow[];

    const liveRow  = rows.find((r) => r.mode === 'LIVE');
    const paperRow = rows.find((r) => r.mode === 'PAPER');

    return NextResponse.json(
      {
        ok: true,
        live:  buildResult(liveRow,  liveCap),
        paper: buildResult(paperRow, paperCap),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
