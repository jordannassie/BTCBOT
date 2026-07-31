// GET + POST /api/copy/bots/paper-size
//
// Purpose-built, narrowly scoped route for bulk-updating the trade size of
// enabled PAPER bots only.
//
// GET  — returns all currently enabled PAPER bots with their current sizing values.
//        No writes. Safe to call for the confirmation preview.
//
// POST — updates sizing_value and max_trade_size for enabled PAPER bots only.
//        Accepts { amount_usd: number }.
//        Validates: positive finite number, ≤ 1000, ≤ 2 decimal places.
//        Never touches LIVE bots, ARM LIVE, is_enabled, or any other field.
//
// No trade execution, no position changes, no FastLoop interaction.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE   = { 'Cache-Control': 'no-store, max-age=0' };
const MAX_AMOUNT = 1000;

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type PaperBot = {
  id:            string;
  name:          string;
  wallet_address: string;
  sizing_value:  number | null;
  max_trade_size: number | null;
};

// ─── GET — preview active PAPER bots ──────────────────────────────────────────
export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    const { data, error } = await client
      .from('copy_bots')
      .select('id, name, wallet_address, sizing_value, max_trade_size')
      .eq('mode', 'PAPER')
      .eq('is_enabled', true)
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: NO_CACHE });
    }

    const bots = (data ?? []) as PaperBot[];

    return NextResponse.json(
      {
        ok:    true,
        count: bots.length,
        bots:  bots.map((b) => ({
          id:            b.id,
          name:          b.name,
          sizing_value:  b.sizing_value  ?? null,
          max_trade_size: b.max_trade_size ?? null,
        })),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}

// ─── POST — apply new trade size to all enabled PAPER bots ────────────────────
export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  let body: { amount_usd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400, headers: NO_CACHE });
  }

  // ── Validate amount ──────────────────────────────────────────────────────────
  const raw = Number(body.amount_usd);

  if (!Number.isFinite(raw) || raw <= 0) {
    return NextResponse.json(
      { ok: false, error: 'amount_usd must be a positive finite number' },
      { status: 400, headers: NO_CACHE }
    );
  }
  if (raw > MAX_AMOUNT) {
    return NextResponse.json(
      { ok: false, error: `amount_usd must be ≤ $${MAX_AMOUNT}` },
      { status: 400, headers: NO_CACHE }
    );
  }

  // Round to 2 decimal places and verify precision
  const amount = Math.round(raw * 100) / 100;
  if (Math.abs(amount - raw) > 0.001) {
    return NextResponse.json(
      { ok: false, error: 'amount_usd must have at most two decimal places' },
      { status: 400, headers: NO_CACHE }
    );
  }

  const now = new Date().toISOString();

  try {
    // ── Fetch current state of enabled PAPER bots ─────────────────────────────
    const { data: current, error: fetchErr } = await client
      .from('copy_bots')
      .select('id, name, wallet_address, sizing_value, max_trade_size')
      .eq('mode', 'PAPER')
      .eq('is_enabled', true);

    if (fetchErr) {
      return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500, headers: NO_CACHE });
    }

    const bots = (current ?? []) as PaperBot[];

    // No-op if no active paper bots
    if (bots.length === 0) {
      return NextResponse.json(
        {
          ok:            true,
          updated_count: 0,
          amount_usd:    amount,
          message:       'No enabled PAPER bots found — nothing updated.',
          bots:          [],
        },
        { headers: NO_CACHE }
      );
    }

    // ── Apply update — only sizing_value and max_trade_size, mode=PAPER, enabled ─
    const { error: updateErr } = await client
      .from('copy_bots')
      .update({
        sizing_value:   amount,
        max_trade_size: amount,
        updated_at:     now,
      })
      .eq('mode', 'PAPER')
      .eq('is_enabled', true);

    if (updateErr) {
      return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500, headers: NO_CACHE });
    }

    console.log(
      `PAPER_SIZE_BULK amount=${amount} updated=${bots.length} ids=${bots.map((b) => b.id).join(',')}`
    );

    return NextResponse.json(
      {
        ok:            true,
        updated_count: bots.length,
        amount_usd:    amount,
        bots: bots.map((b) => ({
          id:                b.id,
          name:              b.name,
          old_sizing_value:  b.sizing_value  ?? null,
          old_max_trade_size: b.max_trade_size ?? null,
          new_sizing_value:  amount,
          new_max_trade_size: amount,
        })),
      },
      { headers: NO_CACHE }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
