// Open-position exposure split by bot mode (LIVE vs PAPER).
//
// Uses two explicit queries instead of a PostgREST FK join to guarantee
// reliability regardless of how Supabase has named the FK constraint.
//
// Response shape:
//   live:  { count, exposure, avg }  — OPEN positions where copy_bots.mode = 'LIVE'
//   paper: { count, exposure, avg }  — OPEN positions where copy_bots.mode = 'PAPER'
//
// Exposure source: copied_positions.size (the sole sizing column, displayed
// as "Size ($)" in the positions table UI — interpreted as USD).

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

function computeExposure(sizes: number[]) {
  const count    = sizes.length;
  const exposure = sizes.reduce((s, v) => s + v, 0);
  const avg      = count > 0 ? exposure / count : 0;
  return { count, exposure, avg };
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
    // Query 1: all bots → build id→mode map
    const { data: bots, error: botsErr } = await client
      .from('copy_bots')
      .select('id, mode');

    if (botsErr) throw botsErr;

    const botMode = new Map<string, string>(
      (bots ?? []).map((b) => [b.id as string, b.mode as string])
    );

    // Query 2: all OPEN positions → join mode client-side
    const { data: positions, error: posErr } = await client
      .from('copied_positions')
      .select('size, copy_bot_id')
      .eq('status', 'OPEN');

    if (posErr) throw posErr;

    const liveSizes: number[]  = [];
    const paperSizes: number[] = [];

    for (const p of positions ?? []) {
      const mode = botMode.get(p.copy_bot_id as string);
      const size = (p.size as number | null) ?? 0;
      if (mode === 'LIVE')  liveSizes.push(size);
      if (mode === 'PAPER') paperSizes.push(size);
    }

    return NextResponse.json(
      {
        ok: true,
        live:  computeExposure(liveSizes),
        paper: computeExposure(paperSizes),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
