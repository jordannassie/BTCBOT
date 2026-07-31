// GET + POST /api/copy/bots/paper-off
//
// Paper copy-bot master on/off control.
//
// State stored in bot_settings table under bot_id = 'paper_off_state'.
// No schema migration required.
//
// GET — returns current state + counts.
//
// POST { action: 'off' }
//   1. Reads all mode=PAPER, is_enabled=true bots → saves their IDs.
//   2. Sets is_enabled=false, opens_only=true, arm_live=false for ALL mode=PAPER bots.
//   → Only paper bots affected. LIVE bots and live execution untouched.
//
// POST { action: 'on' }
//   1. Reads saved previously-enabled IDs.
//   2. Restores is_enabled=true, opens_only=false ONLY for those bots.
//   3. All other paper bots remain off.
//   4. Clears state.
//
// NEVER touches mode=LIVE bots.
// NEVER touches arm_live on LIVE bots.
// NEVER modifies wallets, historical records, or positions.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic   = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE      = { 'Cache-Control': 'no-store, max-age=0' };
const STATE_BOT_ID  = 'paper_off_state';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type OffState = {
  paper_off:          boolean;
  turned_off_at:      string | null;
  prev_enabled_ids:   string[];
};

function parseOffState(data: unknown): OffState {
  const raw = data as Record<string, unknown> | null;
  const ss  = (raw?.strategy_settings ?? {}) as Record<string, unknown>;
  return {
    paper_off:        Boolean(ss.paper_off),
    turned_off_at:    typeof ss.turned_off_at === 'string' ? ss.turned_off_at : null,
    prev_enabled_ids: Array.isArray(ss.prev_enabled_ids) ? (ss.prev_enabled_ids as string[]) : [],
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500, headers: NO_CACHE });
  }

  try {
    const [stateRes, allPaperRes, enabledPaperRes] = await Promise.all([
      client.from('bot_settings').select('strategy_settings').eq('bot_id', STATE_BOT_ID).maybeSingle(),
      client.from('copy_bots').select('id', { count: 'exact', head: true }).eq('mode', 'PAPER'),
      client.from('copy_bots').select('id', { count: 'exact', head: true }).eq('mode', 'PAPER').eq('is_enabled', true),
    ]);

    const state = parseOffState(stateRes.data);

    return NextResponse.json({
      ok:                   true,
      paper_off:            state.paper_off,
      turned_off_at:        state.turned_off_at,
      prev_enabled_count:   state.prev_enabled_ids.length,
      total_paper_bots:     allPaperRes.count     ?? 0,
      enabled_paper_bots:   enabledPaperRes.count ?? 0,
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
  if (action !== 'off' && action !== 'on') {
    return NextResponse.json({ ok: false, error: 'action must be "off" or "on"' }, { status: 400, headers: NO_CACHE });
  }

  const now = new Date().toISOString();

  try {
    // ── TURN OFF ──────────────────────────────────────────────────────────────
    if (action === 'off') {
      // 1. Find currently-enabled PAPER bots
      const { data: enabledBots, error: fetchErr } = await client
        .from('copy_bots')
        .select('id')
        .eq('mode', 'PAPER')
        .eq('is_enabled', true);

      if (fetchErr) {
        return NextResponse.json({ ok: false, error: fetchErr.message, step: 'fetch_enabled' }, { status: 500, headers: NO_CACHE });
      }

      const prevIds = (enabledBots ?? []).map((b: { id: string }) => b.id);

      // 2. Save state
      const { error: saveErr } = await client
        .from('bot_settings')
        .upsert(
          {
            bot_id:            STATE_BOT_ID,
            strategy_settings: { paper_off: true, turned_off_at: now, prev_enabled_ids: prevIds },
            updated_at:        now,
          },
          { onConflict: 'bot_id' }
        );

      if (saveErr) {
        return NextResponse.json({ ok: false, error: saveErr.message, step: 'save_state' }, { status: 500, headers: NO_CACHE });
      }

      // 3. Disable ALL mode=PAPER bots (enabled or not — fully clean slate)
      const { error: offErr } = await client
        .from('copy_bots')
        .update({ is_enabled: false, opens_only: true, arm_live: false, updated_at: now })
        .eq('mode', 'PAPER');

      if (offErr) {
        return NextResponse.json({ ok: false, error: offErr.message, step: 'disable_bots' }, { status: 500, headers: NO_CACHE });
      }

      return NextResponse.json({
        ok:           true,
        action:       'off',
        disabled:     prevIds.length,
        turned_off_at: now,
      }, { headers: NO_CACHE });
    }

    // ── TURN ON ───────────────────────────────────────────────────────────────
    if (action === 'on') {
      const { data: stateRow } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', STATE_BOT_ID)
        .maybeSingle();

      const state = parseOffState(stateRow);

      if (!state.paper_off) {
        return NextResponse.json({ ok: true, action: 'on', restored: 0, message: 'Not currently off' }, { headers: NO_CACHE });
      }

      const idsToRestore = state.prev_enabled_ids;
      let restored = 0;

      if (idsToRestore.length > 0) {
        const { error: onErr } = await client
          .from('copy_bots')
          .update({ is_enabled: true, opens_only: false, updated_at: now })
          .in('id', idsToRestore)
          .eq('mode', 'PAPER'); // safety guard: only restore PAPER bots

        if (onErr) {
          return NextResponse.json({ ok: false, error: onErr.message, step: 'restore_bots' }, { status: 500, headers: NO_CACHE });
        }
        restored = idsToRestore.length;
      }

      // Clear state
      await client
        .from('bot_settings')
        .upsert(
          {
            bot_id:            STATE_BOT_ID,
            strategy_settings: { paper_off: false, turned_off_at: null, prev_enabled_ids: [] },
            updated_at:        now,
          },
          { onConflict: 'bot_id' }
        );

      return NextResponse.json({
        ok:       true,
        action:   'on',
        restored,
      }, { headers: NO_CACHE });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: NO_CACHE });
  }
}
