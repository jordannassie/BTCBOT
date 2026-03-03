import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAPER_BOT_IDS = new Set(['default', 'paper_fastloop', 'paper_sniper']);

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
  if (!payload || !payload.bot_id || !PAPER_BOT_IDS.has(payload.bot_id)) {
    return NextResponse.json({ ok: false, error: 'Invalid payload: bot_id must be a paper bot' }, { status: 400 });
  }

  const botId: string = payload.bot_id;
  const balance = typeof payload.paper_balance_usd === 'number' ? payload.paper_balance_usd : 0;
  const roundedBalance = Math.round(balance * 100) / 100;
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: updatedSettings, error: updateError } = await client
      .from('bot_settings')
      .update({
        paper_balance_usd: roundedBalance,
        paper_pnl_usd: 0,
        updated_at: new Date().toISOString()
      })
      .eq('bot_id', botId)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      ...updatedSettings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
