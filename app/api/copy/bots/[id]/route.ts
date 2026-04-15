import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Bot id is required' }, { status: 400 });
  }

  try {
    const { error } = await client.from('copy_bots').delete().eq('id', id);

    if (error) {
      // Foreign-key violation (code 23503): this bot has linked copy_attempts or
      // copied_positions rows. Return a clear operator message instead of a raw DB error.
      const isFkViolation =
        error.code === '23503' || error.message?.includes('foreign key');

      if (isFkViolation) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'This bot has linked copy history (attempts or positions). ' +
              'Disable it instead of deleting to preserve your records.',
            fk_violation: true,
          },
          { status: 409 }
        );
      }

      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Bot id is required' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    const VALID_MODES = new Set(['PAPER', 'LIVE']);
    const VALID_COPY_MODES = new Set(['exact', 'scaled', 'percent']);

    if (typeof body.is_enabled === 'boolean') updates.is_enabled = body.is_enabled;
    if (typeof body.arm_live === 'boolean') updates.arm_live = body.arm_live;
    if (typeof body.opens_only === 'boolean') updates.opens_only = body.opens_only;
    if (typeof body.copy_closes === 'boolean') updates.copy_closes = body.copy_closes;
    if (typeof body.notes === 'string') updates.notes = body.notes.trim() || null;
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();

    if (body.mode != null && VALID_MODES.has(body.mode)) updates.mode = body.mode;
    if (body.copy_mode != null && VALID_COPY_MODES.has(body.copy_mode)) updates.copy_mode = body.copy_mode;

    const numericFields = [
      'sizing_value', 'max_trade_size', 'max_open_positions',
      'max_trades_per_hour', 'max_slippage', 'min_liquidity', 'delay_seconds',
    ] as const;

    for (const field of numericFields) {
      if (body[field] != null) {
        const parsed = Number(body[field]);
        if (Number.isFinite(parsed)) updates[field] = parsed;
      }
    }

    if (Array.isArray(body.category_filter)) updates.category_filter = body.category_filter;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await client
      .from('copy_bots')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'Copy bot not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
