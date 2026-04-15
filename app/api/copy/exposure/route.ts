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

function computeExposure(
  sizes: number[],
  cap: number,
) {
  const count    = sizes.length;
  const exposure = sizes.reduce((s, v) => s + v, 0);
  const avg      = count > 0 ? exposure / count : 0;
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
    // Run all three reads in parallel
    const [botsRes, positionsRes, settingsRes] = await Promise.all([
      client.from('copy_bots').select('id, mode'),
      client.from('copied_positions').select('size, copy_bot_id').eq('status', 'OPEN'),
      client
        .from('copy_global_settings')
        .select('live_max_exposure_usd, paper_max_exposure_usd')
        .eq('id', 1)
        .maybeSingle(),
    ]);

    if (botsRes.error)     throw botsRes.error;
    if (positionsRes.error) throw positionsRes.error;
    // settings error is non-fatal — fall back to 0 (unlimited)

    const settings = settingsRes.data as {
      live_max_exposure_usd: number;
      paper_max_exposure_usd: number;
    } | null;

    const liveCap  = settings?.live_max_exposure_usd  ?? 0;
    const paperCap = settings?.paper_max_exposure_usd ?? 0;

    const botMode = new Map<string, string>(
      (botsRes.data ?? []).map((b) => [b.id as string, b.mode as string])
    );

    const liveSizes: number[]  = [];
    const paperSizes: number[] = [];

    for (const p of positionsRes.data ?? []) {
      const mode = botMode.get(p.copy_bot_id as string);
      const size = (p.size as number | null) ?? 0;
      if (mode === 'LIVE')  liveSizes.push(size);
      if (mode === 'PAPER') paperSizes.push(size);
    }

    return NextResponse.json(
      {
        ok: true,
        live:  computeExposure(liveSizes,  liveCap),
        paper: computeExposure(paperSizes, paperCap),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
