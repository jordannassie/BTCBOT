// /api/copy/live-pnl
//
// Returns realized P/L aggregates for LIVE copy bots.
//
// Strategy:
//   1. Fetch all copy_bots rows where mode = 'LIVE' (there are typically very
//      few — single digits — so the full set fits in one PostgREST response).
//   2. Fetch CLOSED copied_positions whose copy_bot_id is in that live-bot set.
//      We select only the two columns we need (pnl, closed_at) and cap at 1 000
//      rows.  This is an intentional trade-off:  if >1 000 live positions have
//      ever been CLOSED the all-time figure will be a lower-bound estimate.  At
//      that scale a proper SQL aggregate function (RPC migration) should replace
//      this route.  For now the system is small enough that this is safe.
//   3. Aggregate in-process: sum pnl for all rows (all-time) and for rows whose
//      closed_at falls on or after UTC midnight today (today's P/L).
//
// Response shape:
//   {
//     ok: true,
//     live_all_time_pnl_usd: number,   // sum of pnl from all CLOSED live positions
//     live_today_pnl_usd:    number,   // sum of pnl from positions closed today (UTC)
//     closed_count:          number,   // total CLOSED live positions included
//     today_closed_count:    number,   // positions closed today
//     capped:                boolean,  // true if row limit was hit (P/L is a lower bound)
//     fetchedAt:             string,
//   }
//
// This route is READ-ONLY and does NOT write to any table.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };
const ROW_LIMIT = 1000;

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
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE },
    );
  }

  try {
    // ── Step 1: Get all LIVE bot IDs ──────────────────────────────────────────
    const { data: liveBots, error: botsErr } = await client
      .from('copy_bots')
      .select('id')
      .eq('mode', 'LIVE');

    if (botsErr) {
      return NextResponse.json(
        { ok: false, error: botsErr.message },
        { status: 500, headers: NO_CACHE },
      );
    }

    const liveBotIds = (liveBots ?? []).map((b: { id: string }) => b.id);

    // No live bots → return zeros immediately.
    if (liveBotIds.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          live_all_time_pnl_usd: 0,
          live_today_pnl_usd: 0,
          closed_count: 0,
          today_closed_count: 0,
          capped: false,
          fetchedAt: new Date().toISOString(),
        },
        { headers: NO_CACHE },
      );
    }

    // ── Step 2: Fetch CLOSED positions for those bots ─────────────────────────
    const { data: positions, error: posErr } = await client
      .from('copied_positions')
      .select('pnl, closed_at')
      .in('copy_bot_id', liveBotIds)
      .eq('status', 'CLOSED')
      .order('closed_at', { ascending: false })
      .limit(ROW_LIMIT);

    if (posErr) {
      return NextResponse.json(
        { ok: false, error: posErr.message },
        { status: 500, headers: NO_CACHE },
      );
    }

    const rows = (positions ?? []) as { pnl: number | string | null; closed_at: string | null }[];
    const capped = rows.length >= ROW_LIMIT;

    // ── Step 3: Aggregate ─────────────────────────────────────────────────────
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const todayMs = todayUTC.getTime();

    let allTimePnl = 0;
    let todayPnl = 0;
    let todayCount = 0;

    for (const row of rows) {
      const pnl = Number(row.pnl ?? 0);
      allTimePnl += pnl;

      if (row.closed_at) {
        const closedMs = new Date(row.closed_at).getTime();
        if (closedMs >= todayMs) {
          todayPnl += pnl;
          todayCount += 1;
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        live_all_time_pnl_usd: Number(allTimePnl.toFixed(4)),
        live_today_pnl_usd:    Number(todayPnl.toFixed(4)),
        closed_count:          rows.length,
        today_closed_count:    todayCount,
        capped,
        fetchedAt: new Date().toISOString(),
      },
      { headers: NO_CACHE },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
