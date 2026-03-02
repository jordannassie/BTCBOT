'use server';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'default';

export async function GET() {
  const supabaseUrl =
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl.startsWith('http') || !serviceKey) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data, error } = await client
      .from('bot_settings')
      .select('live_balance_usd, live_updated_at')
      .eq('bot_id', BOT_ID)
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const response = NextResponse.json({
      ok: true,
      live_balance_usd: data?.live_balance_usd ?? null,
      live_updated_at: data?.live_updated_at ?? null
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
