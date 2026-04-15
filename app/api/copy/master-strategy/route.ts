// Master Strategy API
//
// GET  → { ok, strategy: MasterStrategy|null, use_for_new_bots, saved_at }
// POST → actions:
//   { action: 'save',                strategy: MasterStrategy }
//   { action: 'set_use_for_new_bots', value: boolean }
//   { action: 'apply',               target: 'all' | string[] }
//
// Storage: bot_settings, bot_id = 'copy_master_strategy', strategy_settings JSONB
//   { master: MasterStrategy, use_for_new_bots: boolean }

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  MASTER_STRATEGY_BOT_ID,
  getMasterStrategyRow,
  type MasterStrategy,
} from '@/lib/copy/masterStrategy';

const VALID_MODES      = new Set(['PAPER', 'LIVE']);
const VALID_COPY_MODES = new Set(['exact', 'scaled', 'percent']);

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sanitiseStrategy(raw: unknown): MasterStrategy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (!VALID_MODES.has(s.mode as string))      return null;
  if (!VALID_COPY_MODES.has(s.copy_mode as string)) return null;

  return {
    mode:                s.mode as 'PAPER' | 'LIVE',
    copy_mode:           s.copy_mode as 'exact' | 'scaled' | 'percent',
    sizing_value:        num(s.sizing_value,        1),
    max_trade_size:      num(s.max_trade_size,      25),
    max_open_positions:  num(s.max_open_positions,  0),
    max_trades_per_hour: num(s.max_trades_per_hour, 0),
    max_slippage:        num(s.max_slippage,        0.03),
    delay_seconds:       num(s.delay_seconds,       0),
    opens_only:          s.opens_only  === true,
    copy_closes:         s.copy_closes !== false,
    is_enabled:          s.is_enabled  !== false,
    arm_live:            s.arm_live    === true,
    notes: typeof s.notes === 'string' ? s.notes.trim() || null : null,
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const { data } = await client
      .from('bot_settings')
      .select('strategy_settings, updated_at')
      .eq('bot_id', MASTER_STRATEGY_BOT_ID)
      .maybeSingle();

    const s = (data?.strategy_settings ?? {}) as {
      master?: unknown;
      use_for_new_bots?: boolean;
    };

    return NextResponse.json(
      {
        ok: true,
        strategy:          s.master ?? null,
        use_for_new_bots:  s.use_for_new_bots ?? false,
        saved_at:          data?.updated_at ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500 }
    );
  }

  let body: { action?: string; strategy?: unknown; value?: unknown; target?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const now = new Date().toISOString();

  // ── save ────────────────────────────────────────────────────────────────────
  if (body.action === 'save') {
    const strategy = sanitiseStrategy(body.strategy);
    if (!strategy) {
      return NextResponse.json({ ok: false, error: 'Invalid strategy payload' }, { status: 400 });
    }

    try {
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', MASTER_STRATEGY_BOT_ID)
        .maybeSingle();

      const existing    = (current?.strategy_settings ?? {}) as Record<string, unknown>;
      const newSettings = { ...existing, master: strategy };

      const { error } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: MASTER_STRATEGY_BOT_ID, strategy_settings: newSettings, updated_at: now },
          { onConflict: 'bot_id' }
        );

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, action: 'save', strategy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── set_use_for_new_bots ────────────────────────────────────────────────────
  if (body.action === 'set_use_for_new_bots') {
    if (typeof body.value !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'value must be boolean' }, { status: 400 });
    }

    try {
      const { data: current } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', MASTER_STRATEGY_BOT_ID)
        .maybeSingle();

      const existing    = (current?.strategy_settings ?? {}) as Record<string, unknown>;
      const newSettings = { ...existing, use_for_new_bots: body.value };

      const { error } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: MASTER_STRATEGY_BOT_ID, strategy_settings: newSettings, updated_at: now },
          { onConflict: 'bot_id' }
        );

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, action: 'set_use_for_new_bots', value: body.value });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  // ── apply ────────────────────────────────────────────────────────────────────
  // Reads the currently saved master strategy and pushes all its fields to bots.
  if (body.action === 'apply') {
    const target = body.target;
    if (target !== 'all' && (!Array.isArray(target) || (target as unknown[]).length === 0)) {
      return NextResponse.json(
        { ok: false, error: 'target must be "all" or a non-empty array of bot IDs' },
        { status: 400 }
      );
    }

    const { strategy } = await getMasterStrategyRow(client);
    if (!strategy) {
      return NextResponse.json(
        { ok: false, error: 'No master strategy saved yet. Save a strategy first.' },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {
      mode:                strategy.mode,
      copy_mode:           strategy.copy_mode,
      sizing_value:        strategy.sizing_value,
      max_trade_size:      strategy.max_trade_size,
      max_open_positions:  strategy.max_open_positions,
      max_trades_per_hour: strategy.max_trades_per_hour,
      max_slippage:        strategy.max_slippage,
      delay_seconds:       strategy.delay_seconds,
      opens_only:          strategy.opens_only,
      copy_closes:         strategy.copy_closes,
      is_enabled:          strategy.is_enabled,
      arm_live:            strategy.arm_live,
      updated_at:          now,
    };
    if (strategy.notes !== null) updates.notes = strategy.notes;

    let ids: string[];
    if (target === 'all') {
      const { data, error } = await client.from('copy_bots').select('id');
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      ids = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      ids = (target as string[]).filter((id) => typeof id === 'string' && id.length > 0);
    }

    if (ids.length === 0) {
      return NextResponse.json({ ok: true, action: 'apply', updated: 0 });
    }

    const { error } = await client.from('copy_bots').update(updates).in('id', ids);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, action: 'apply', updated: ids.length });
  }

  return NextResponse.json(
    { ok: false, error: 'action must be "save", "set_use_for_new_bots", or "apply"' },
    { status: 400 }
  );
}
