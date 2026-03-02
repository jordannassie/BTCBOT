import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBotSettings } from '@/lib/botData';

const BOT_ID = 'default';

export async function GET() {
  try {
    const settings = await getBotSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let supabaseUrl =
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (supabaseUrl.startsWith('$')) {
      supabaseUrl = '';
    }

    if (!supabaseUrl.startsWith('http')) {
      return NextResponse.json(
        { ok: false, error: `SUPABASE_URL missing/invalid: "${supabaseUrl}"` },
        { status: 500 }
      );
    }

    if (!serviceKey) {
      return NextResponse.json(
        { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY missing' },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { ok: false, error: 'Supabase service credentials are missing.' },
        { status: 500 }
      );
    }

    const payload = await request.json();
    const {
      bot_id,
      is_enabled,
      mode,
      edge_threshold,
      trade_size,
      max_trades_per_hour
    } = payload;

    if (bot_id !== BOT_ID) {
      return NextResponse.json({ ok: false, error: 'Invalid bot_id.' }, { status: 400 });
    }

    if (mode !== 'PAPER' && mode !== 'LIVE') {
      return NextResponse.json({ ok: false, error: 'Mode must be PAPER or LIVE.' }, { status: 400 });
    }

    const client = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false }
    });

    const { error } = await client
      .from('bot_settings')
      .update({
        is_enabled,
        mode,
        edge_threshold,
        trade_size_usd: trade_size,
        max_trades_per_hour,
        updated_at: new Date().toISOString()
      })
      .eq('bot_id', BOT_ID);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
