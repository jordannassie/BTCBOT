// Bulk update for copy bots.
//
// POST /api/copy/bots/bulk
//   Body:
//     target: 'all' | string[]   — bot IDs to update, or 'all'
//     fields: Record<string, unknown>   — only the fields to overwrite
//
//   The caller is responsible for sending only the fields that should change.
//   Any field not in `fields` is left untouched on each bot.
//
//   Returns: { ok, updated: number, errors?: string[] }

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Whitelist of fields that may be bulk-updated.
// This prevents arbitrary column injection.
const ALLOWED_FIELDS = new Set([
  'mode', 'copy_mode', 'sizing_value', 'max_trade_size',
  'max_open_positions', 'max_trades_per_hour', 'max_slippage',
  'delay_seconds', 'is_enabled', 'arm_live', 'opens_only',
  'copy_closes', 'notes',
]);

const VALID_MODES = new Set(['PAPER', 'LIVE']);
const VALID_COPY_MODES = new Set(['exact', 'scaled', 'percent']);
const NUMERIC_FIELDS = new Set([
  'sizing_value', 'max_trade_size', 'max_open_positions',
  'max_trades_per_hour', 'max_slippage', 'delay_seconds',
]);
const BOOLEAN_FIELDS = new Set(['is_enabled', 'arm_live', 'opens_only', 'copy_closes']);

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  let body: { target?: unknown; fields?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { target, fields } = body;

  // ── Validate target ──────────────────────────────────────────────────────────
  if (target !== 'all' && (!Array.isArray(target) || target.length === 0)) {
    return NextResponse.json(
      { ok: false, error: 'target must be "all" or a non-empty array of bot IDs' },
      { status: 400 }
    );
  }

  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return NextResponse.json({ ok: false, error: 'fields must be a non-null object' }, { status: 400 });
  }

  // ── Validate and sanitise fields ─────────────────────────────────────────────
  const updates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (!ALLOWED_FIELDS.has(key)) continue;

    if (key === 'mode') {
      if (!VALID_MODES.has(value as string)) continue;
      updates.mode = value;
    } else if (key === 'copy_mode') {
      if (!VALID_COPY_MODES.has(value as string)) continue;
      updates.copy_mode = value;
    } else if (key === 'notes') {
      updates.notes = typeof value === 'string' ? value.trim() || null : null;
    } else if (NUMERIC_FIELDS.has(key)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) updates[key] = parsed;
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value === 'boolean') updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No valid fields to apply after sanitisation' },
      { status: 400 }
    );
  }

  updates.updated_at = new Date().toISOString();

  // ── Resolve bot IDs ──────────────────────────────────────────────────────────
  let ids: string[];

  if (target === 'all') {
    const { data, error } = await client.from('copy_bots').select('id');
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    ids = (data ?? []).map((r: { id: string }) => r.id);
  } else {
    ids = (target as string[]).filter((id) => typeof id === 'string' && id.length > 0);
  }

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // ── Apply update ─────────────────────────────────────────────────────────────
  try {
    const { error } = await client
      .from('copy_bots')
      .update(updates)
      .in('id', ids);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
