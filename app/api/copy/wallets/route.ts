import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BOT_DEFAULTS } from '@/lib/copy/botDefaults';

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

    const addr = wallet_address.trim();
    const name = display_name?.trim() || null;

    const { data, error } = await client
      .from('tracked_wallets')
      .insert({
        wallet_address: addr,
        display_name: name,
        source: source || 'manual',
        is_active: is_active !== false,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // ── Auto-create a default PAPER copy bot for this wallet ─────────────────
    // Idempotent: only creates a bot if none already exists for this wallet.
    let botCreated = false;
    try {
      const { data: existing } = await client
        .from('copy_bots')
        .select('id')
        .eq('wallet_address', addr)
        .limit(1);

      if (!existing || existing.length === 0) {
        const botName = name || (addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr);
        await client.from('copy_bots').insert({
          ...BOT_DEFAULTS,
          name: botName,
          wallet_address: addr,
        });
        botCreated = true;
      }
    } catch {
      // Auto-bot creation is best-effort. The wallet was created successfully;
      // if this fails, the operator can use the backfill route.
    }

    return NextResponse.json({ ok: true, row: data, bot_created: botCreated });
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
