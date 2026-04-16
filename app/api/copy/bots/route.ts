import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BOT_DEFAULTS } from '@/lib/copy/botDefaults';
import { getEffectiveBotDefaults } from '@/lib/copy/masterStrategy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const { data, error } = await client
      .from('copy_bots')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rows: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { name, wallet_address } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
    }
    if (!wallet_address || typeof wallet_address !== 'string' || !wallet_address.trim()) {
      return NextResponse.json({ ok: false, error: 'wallet_address is required' }, { status: 400 });
    }

    const VALID_MODES = new Set(['PAPER', 'LIVE']);
    const VALID_COPY_MODES = new Set(['exact', 'scaled', 'percent']);

    const mode = body.mode ?? 'PAPER';
    const copy_mode = body.copy_mode ?? 'scaled';

    if (!VALID_MODES.has(mode)) {
      return NextResponse.json({ ok: false, error: 'mode must be PAPER or LIVE' }, { status: 400 });
    }
    if (!VALID_COPY_MODES.has(copy_mode)) {
      return NextResponse.json({ ok: false, error: 'copy_mode must be exact, scaled, or percent' }, { status: 400 });
    }

    // Start with effective defaults (master strategy if "Use for New Bots" is ON,
    // otherwise BOT_DEFAULTS), then overlay any values explicitly provided in the request body.
    const effectiveDefaults = await getEffectiveBotDefaults(client, { ...BOT_DEFAULTS });
    const row: Record<string, unknown> = {
      ...effectiveDefaults,
      name: name.trim(),
      wallet_address: wallet_address.trim(),
      mode,
      copy_mode,
      // is_enabled defaults true unless explicitly false
      is_enabled: body.is_enabled !== false,
      arm_live: body.arm_live === true,
    };

    const numericFields = [
      'sizing_value', 'max_trade_size', 'max_open_positions',
      'max_trades_per_hour', 'max_slippage', 'min_liquidity', 'delay_seconds',
    ] as const;

    for (const field of numericFields) {
      if (body[field] != null) {
        const parsed = Number(body[field]);
        // Allow 0 (unlimited) as a valid value for position/rate limits
        if (Number.isFinite(parsed) && parsed >= 0) row[field] = parsed;
      }
    }

    if (typeof body.opens_only === 'boolean') row.opens_only = body.opens_only;
    if (typeof body.copy_closes === 'boolean') row.copy_closes = body.copy_closes;
    if (typeof body.notes === 'string') row.notes = body.notes.trim() || null;
    if (Array.isArray(body.category_filter)) row.category_filter = body.category_filter;

    const { data, error } = await client
      .from('copy_bots')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
