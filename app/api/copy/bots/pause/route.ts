// GET + POST /api/copy/bots/pause
//
// Master copy-trading entry pause control.
//
// Pause state is stored as a JSONB value in the existing bot_settings table
// under bot_id = 'copy_pause_state'.  No schema migration needed.
//
// GET — returns current pause status + counts.
//
// POST { action: 'pause' }
//   1. Reads all enabled copy bots where opens_only = false (New Entries ON).
//   2. Saves their IDs to bot_settings.strategy_settings.active_bot_ids.
//   3. Sets opens_only = true, copy_closes = true, is_enabled = true for ALL
//      currently-enabled copy bots.
//   → New Entries OFF, Exit Monitor ON, bots remain enabled.
//
// POST { action: 'resume' }
//   1. Reads the saved active_bot_ids list.
//   2. Restores opens_only = false ONLY for those bots.
//   3. All other bots remain at their current opens_only value (unchanged).
//   4. Clears pause state.
//
// Never disables any bot.
// Never touches LIVE or ARM LIVE.
// Never closes or archives positions.
// Never resets paper bankroll.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE       = { 'Cache-Control': 'no-store, max-age=0' };
const PAUSE_BOT_ID   = 'copy_pause_state';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type PauseState = {
  paused:         boolean;
  paused_at:      string | null;
  active_bot_ids: string[];
};

function parsePauseState(data: unknown): PauseState {
  const raw = (data as Record<string, unknown> | null);
  const ss = (raw?.strategy_settings ?? {}) as Record<string, unknown>;
  return {
    paused:         Boolean(ss.paused),
    paused_at:      typeof ss.paused_at === 'string' ? ss.paused_at : null,
    active_bot_ids: Array.isArray(ss.active_bot_ids) ? (ss.active_bot_ids as string[]) : [],
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    const [pauseRes, botsRes, posRes] = await Promise.all([
      client.from('bot_settings').select('strategy_settings').eq('bot_id', PAUSE_BOT_ID).maybeSingle(),
      client.from('copy_bots').select('id, is_enabled, opens_only, mode').eq('is_enabled', true),
      client.from('copied_positions').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
    ]);
    const pauseState = parsePauseState(pauseRes.data);

    const enabledBots = (botsRes.data ?? []) as { id: string; is_enabled: boolean; opens_only: boolean; mode: string }[];
    const activeCount = enabledBots.filter((b) => !b.opens_only).length;

    return NextResponse.json({
      ok:                  true,
      paused:              pauseState.paused,
      paused_at:           pauseState.paused_at,
      active_before_pause: pauseState.active_bot_ids,
      enabled_bots:        enabledBots.length,
      active_bots:         activeCount,
      open_positions:      posRes.count ?? 0,
    }, { headers: NO_CACHE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  let body: { action?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: NO_CACHE }); }

  const action = body.action;
  if (action !== 'pause' && action !== 'resume') {
    return NextResponse.json({ ok: false, error: 'action must be "pause" or "resume"' }, { status: 400, headers: NO_CACHE });
  }

  const now = new Date().toISOString();

  try {
    // ── PAUSE ────────────────────────────────────────────────────────────────
    if (action === 'pause') {
      // 1. Find all enabled bots with New Entries ON (opens_only = false)
      const { data: activeBots, error: fetchErr } = await client
        .from('copy_bots')
        .select('id, name')
        .eq('is_enabled', true)
        .eq('opens_only', false);

      if (fetchErr) {
        return NextResponse.json({ ok: false, error: fetchErr.message, step: 'fetch_active_bots' }, { status: 500, headers: NO_CACHE });
      }

      const activeIds = (activeBots ?? []).map((b: { id: string }) => b.id);

      // 2. Save active bot IDs to pause state (no-migration: uses existing bot_settings table)
      const { error: saveErr } = await client
        .from('bot_settings')
        .upsert(
          {
            bot_id:            PAUSE_BOT_ID,
            strategy_settings: { paused: true, paused_at: now, active_bot_ids: activeIds },
            updated_at:        now,
          },
          { onConflict: 'bot_id' }
        );

      if (saveErr) {
        return NextResponse.json({ ok: false, error: saveErr.message, step: 'save_pause_state' }, { status: 500, headers: NO_CACHE });
      }

      // 3. Set opens_only=true, copy_closes=true for ALL currently enabled bots
      //    (is_enabled stays true — exit monitoring must remain active)
      const { error: updateErr } = await client
        .from('copy_bots')
        .update({ opens_only: true, copy_closes: true, updated_at: now })
        .eq('is_enabled', true);

      if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message, step: 'pause_bots' }, { status: 500, headers: NO_CACHE });
      }

      return NextResponse.json({
        ok:            true,
        action:        'pause',
        active_before: activeIds.length,
        paused_at:     now,
      }, { headers: NO_CACHE });
    }

    // ── RESUME ───────────────────────────────────────────────────────────────
    if (action === 'resume') {
      const { data: pauseRow } = await client.from('bot_settings').select('strategy_settings').eq('bot_id', PAUSE_BOT_ID).maybeSingle();
      const pauseState = parsePauseState(pauseRow);

      if (!pauseState.paused) {
        return NextResponse.json({ ok: true, action: 'resume', restored: 0, message: 'Not currently paused' }, { headers: NO_CACHE });
      }

      const idsToRestore = pauseState.active_bot_ids;
      let restored = 0;

      if (idsToRestore.length > 0) {
        const { error: restoreErr } = await client
          .from('copy_bots')
          .update({ opens_only: false, copy_closes: true, updated_at: now })
          .in('id', idsToRestore);

        if (restoreErr) {
          return NextResponse.json({ ok: false, error: restoreErr.message, step: 'restore_bots' }, { status: 500, headers: NO_CACHE });
        }
        restored = idsToRestore.length;
      }

      // Clear pause state
      await client
        .from('bot_settings')
        .upsert(
          {
            bot_id:            PAUSE_BOT_ID,
            strategy_settings: { paused: false, paused_at: null, active_bot_ids: [] },
            updated_at:        now,
          },
          { onConflict: 'bot_id' }
        );

      return NextResponse.json({
        ok:       true,
        action:   'resume',
        restored,
      }, { headers: NO_CACHE });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
