import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const [walletsRes, metricsRes] = await Promise.all([
      client.from('tracked_wallets').select('*').order('updated_at', { ascending: false }),
      client.from('wallet_metrics').select('*'),
    ]);

    if (walletsRes.error) {
      return NextResponse.json({ ok: false, error: walletsRes.error.message }, { status: 500 });
    }

    const metricsMap = new Map(
      (metricsRes.data ?? []).map((m) => [m.wallet_address, m])
    );

    const rows = (walletsRes.data ?? []).map((w) => ({
      ...w,
      metrics: metricsMap.get(w.wallet_address) ?? null,
    }));

    return NextResponse.json({ ok: true, rows });
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
    const { wallet_address, display_name, source, is_active } = body;

    if (!wallet_address || typeof wallet_address !== 'string' || !wallet_address.trim()) {
      return NextResponse.json({ ok: false, error: 'wallet_address is required' }, { status: 400 });
    }

    const { data, error } = await client
      .from('tracked_wallets')
      .insert({
        wallet_address: wallet_address.trim(),
        display_name: display_name?.trim() || null,
        source: source || 'manual',
        is_active: is_active !== false,
      })
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

export async function PATCH(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { wallet_address, ...updates } = body;

    if (!wallet_address || typeof wallet_address !== 'string') {
      return NextResponse.json({ ok: false, error: 'wallet_address is required' }, { status: 400 });
    }

    const allowed: Record<string, unknown> = {};
    if (typeof updates.is_active === 'boolean') allowed.is_active = updates.is_active;
    if (typeof updates.display_name === 'string') allowed.display_name = updates.display_name;
    if (typeof updates.tags !== 'undefined') allowed.tags = updates.tags;

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ ok: false, error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await client
      .from('tracked_wallets')
      .update(allowed)
      .eq('wallet_address', wallet_address)
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
