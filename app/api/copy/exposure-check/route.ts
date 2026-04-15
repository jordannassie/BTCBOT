// Pre-trade exposure check for the copy worker.
//
// The worker calls this endpoint BEFORE opening any new copied position.
// It answers: "Is there enough remaining cap to add `proposed_size` right now?"
//
// ── Request (POST JSON) ──────────────────────────────────────────────────────
//   {
//     mode:          "LIVE" | "PAPER",
//     proposed_size: number,          // USD size of the trade being considered
//     copy_bot_id?:  string,          // optional — for richer log context
//   }
//
// ── Response ─────────────────────────────────────────────────────────────────
//   {
//     ok:               true,
//     allowed:          boolean,
//     skip_reason?:     "exposure_cap_exceeded",  // only when allowed = false
//     current_exposure: number,   // SUM(size) across OPEN positions for this mode
//     cap:              number,   // configured cap (0 = unlimited)
//     remaining:        number | null,  // cap - exposure (null when unlimited)
//     would_be:         number,   // current_exposure + proposed_size (projected)
//   }
//
// ── Skip reason written to copy_attempts.skip_reason ─────────────────────────
//   "exposure_cap_exceeded"  — current_exposure + proposed_size > cap
//
// ── Safety rule ──────────────────────────────────────────────────────────────
//   Caps only block NEW opens.  The worker should NEVER call this endpoint
//   for close/sell orders — those must always be allowed regardless of exposure.
//
// ── Enforcement logic ────────────────────────────────────────────────────────
//   cap = 0                           → unlimited, always allowed
//   current_exposure + proposed_size > cap → NOT allowed
//   current_exposure + proposed_size ≤ cap → allowed

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

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500 }
    );
  }

  let body: { mode?: string; proposed_size?: number; copy_bot_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const mode = (body.mode ?? '').toUpperCase();
  if (mode !== 'LIVE' && mode !== 'PAPER') {
    return NextResponse.json(
      { ok: false, error: 'mode must be "LIVE" or "PAPER"' },
      { status: 400 }
    );
  }

  const proposedSize = Number(body.proposed_size ?? 0);
  if (!Number.isFinite(proposedSize) || proposedSize < 0) {
    return NextResponse.json(
      { ok: false, error: 'proposed_size must be a non-negative number' },
      { status: 400 }
    );
  }

  try {
    // Fetch settings cap + all open positions in parallel
    const capField = mode === 'LIVE' ? 'live_max_exposure_usd' : 'paper_max_exposure_usd';

    const [settingsRes, botsRes, positionsRes] = await Promise.all([
      client
        .from('copy_global_settings')
        .select(`${capField}`)
        .eq('id', 1)
        .maybeSingle(),

      client.from('copy_bots').select('id, mode'),

      client
        .from('copied_positions')
        .select('size, copy_bot_id')
        .eq('status', 'OPEN'),
    ]);

    if (settingsRes.error) throw settingsRes.error;
    if (botsRes.error)     throw botsRes.error;
    if (positionsRes.error) throw positionsRes.error;

    const cap: number = (settingsRes.data as Record<string, number> | null)?.[capField] ?? 0;

    // Build bot → mode map and sum exposure for the requested mode only
    const botMode = new Map<string, string>(
      (botsRes.data ?? []).map((b) => [b.id as string, b.mode as string])
    );

    let currentExposure = 0;
    for (const p of positionsRes.data ?? []) {
      if (botMode.get(p.copy_bot_id as string) === mode) {
        currentExposure += (p.size as number | null) ?? 0;
      }
    }

    const wouldBe  = currentExposure + proposedSize;
    const remaining = cap > 0 ? Math.max(0, cap - currentExposure) : null;

    // cap = 0 means unlimited — always allow
    const allowed = cap === 0 || wouldBe <= cap;

    const response: Record<string, unknown> = {
      ok:               true,
      allowed,
      current_exposure: currentExposure,
      proposed_size:    proposedSize,
      would_be:         wouldBe,
      cap,
      remaining,
      mode,
    };

    if (!allowed) {
      // This string is the value the worker should write to copy_attempts.skip_reason
      response.skip_reason = 'exposure_cap_exceeded';
    }

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
