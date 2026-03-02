import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'default';

export async function GET() {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing or invalid' }, { status: 500 });
  }

  try {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await client
      .from('paper_positions')
      .select('pnl_usd, closed_at')
      .eq('bot_id', BOT_ID)
      .eq('status', 'CLOSED');

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as { pnl_usd: number | null; closed_at: string | null }[];
    const totalPnl = rows.reduce((sum, row) => sum + (row.pnl_usd ?? 0), 0);
    const pnl24h = rows.reduce((sum, row) => {
      if (row.closed_at && new Date(row.closed_at) >= new Date(since24h)) {
        return sum + (row.pnl_usd ?? 0);
      }
      return sum;
    }, 0);

    return NextResponse.json({
      ok: true,
      total_pnl_usd: totalPnl,
      pnl_24h_usd: pnl24h
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
