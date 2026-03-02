'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'default';

export async function POST(request: Request) {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing or invalid' },
      { status: 500 }
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload || payload.bot_id !== BOT_ID) {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
  }

  const balance = typeof payload.paper_balance_usd === 'number' ? payload.paper_balance_usd : 0;
  const roundedBalance = Math.round(balance * 100) / 100;
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { error: updateError } = await client
      .from('bot_settings')
      .update({
        paper_balance_usd: roundedBalance,
        paper_pnl_usd: 0,
        updated_at: new Date().toISOString()
      })
      .eq('bot_id', BOT_ID);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    await client
      .from('paper_positions')
      .update({
        status: 'CLOSED',
        closed_at: new Date().toISOString(),
        pnl_usd: 0
      })
      .eq('bot_id', BOT_ID)
      .eq('status', 'OPEN');

    return NextResponse.json({
      ok: true,
      paper_balance_usd: roundedBalance,
      paper_pnl_usd: 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
