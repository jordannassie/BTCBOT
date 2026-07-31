import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE = { 'Cache-Control': 'no-store, max-age=0' };

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200);

    const { data, error } = await client
      .from('copy_attempts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    const rows = data ?? [];

    // Enrich rows with display_name from tracked_wallets (best-effort, non-fatal)
    try {
      const addrs = [...new Set(rows.map((r: Record<string, unknown>) => r.wallet_address as string).filter(Boolean))];
      if (addrs.length > 0) {
        const { data: wallets } = await client
          .from('tracked_wallets')
          .select('wallet_address, display_name')
          .in('wallet_address', addrs);

        const nameMap = new Map<string, string | null>();
        for (const w of (wallets ?? []) as { wallet_address: string; display_name: string | null }[]) {
          nameMap.set(w.wallet_address.toLowerCase(), w.display_name);
        }

        const enriched = rows.map((r: Record<string, unknown>) => ({
          ...r,
          display_name: nameMap.get((r.wallet_address as string)?.toLowerCase() ?? '') ?? null,
        }));
        return NextResponse.json({ ok: true, rows: enriched }, { headers: NO_CACHE });
      }
    } catch { /* enrichment is non-fatal */ }

    return NextResponse.json({ ok: true, rows }, { headers: NO_CACHE });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
