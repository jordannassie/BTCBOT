// Shared copy-trading paper bankroll.
//
// Stored as a single row in bot_settings with bot_id = 'copy_paper':
//   paper_balance_usd  → current running paper balance for copy trades
//   paper_pnl_usd      → running P&L (for display)
//   strategy_settings  → { paper_default: number }  ← operator-saved default amount
//
// This is completely separate from the BTC strategy paper bots.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_ID = 'copy_paper';
const FALLBACK_DEFAULT = 1000;

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── GET ─────────────────────────────────────────────────────────────────────
// Returns current balance and saved default amount.
export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const { data, error } = await client
      .from('bot_settings')
      .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
      .eq('bot_id', BOT_ID)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const defaultAmount: number =
      (data?.strategy_settings as { paper_default?: number } | null)?.paper_default ??
      FALLBACK_DEFAULT;

    return NextResponse.json({
      ok: true,
      balance: data?.paper_balance_usd ?? defaultAmount,
      pnl: data?.paper_pnl_usd ?? 0,
      default_amount: defaultAmount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
// Two actions:
//   { action: 'save_default', amount: number }  → persists a new default reset amount
//   { action: 'reset' }                         → restores balance to saved default
export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  let body: { action?: string; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const now = new Date().toISOString();

  // ── save_default ──────────────────────────────────────────────────────────
  if (body.action === 'save_default') {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: 'amount must be a positive number' },
        { status: 400 }
      );
    }
    const rounded = Math.round(amount * 100) / 100;

    try {
      // Read current row first so we can merge strategy_settings safely
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle();

      const existingSettings = (current?.strategy_settings ?? {}) as Record<string, unknown>;
      const newSettings = { ...existingSettings, paper_default: rounded };

      const { data, error } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: BOT_ID, strategy_settings: newSettings, updated_at: now },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: 'save_default',
        default_amount: rounded,
        balance: data?.paper_balance_usd ?? rounded,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── reset ─────────────────────────────────────────────────────────────────
  if (body.action === 'reset') {
    try {
      // Fetch the saved default first
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', BOT_ID)
        .maybeSingle();

      const defaultAmount: number =
        (current?.strategy_settings as { paper_default?: number } | null)?.paper_default ??
        FALLBACK_DEFAULT;

      const { data, error } = await client
        .from('bot_settings')
        .upsert(
          {
            bot_id: BOT_ID,
            paper_balance_usd: defaultAmount,
            paper_pnl_usd: 0,
            updated_at: now,
          },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd, paper_pnl_usd, strategy_settings')
        .single();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        action: 'reset',
        balance: data?.paper_balance_usd ?? defaultAmount,
        default_amount: defaultAmount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { ok: false, error: 'action must be "save_default" or "reset"' },
    { status: 400 }
  );
}
