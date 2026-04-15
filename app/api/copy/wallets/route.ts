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

// ── GET /api/copy/wallets ────────────────────────────────────────────────────
// Returns all tracked wallets joined with wallet_metrics.
// Also fetches copy_bots so each row includes bot_count and bots_enabled_count,
// which the UI uses to:
//   1. Display a "Bots" column showing enabled/total
//   2. Populate the confirmation dialog when disabling a wallet

export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const [walletsRes, metricsRes, botsRes] = await Promise.all([
      client.from('tracked_wallets').select('*').order('updated_at', { ascending: false }),
      client.from('wallet_metrics').select('*'),
      // Only need wallet_address and is_enabled — keep payload small
      client.from('copy_bots').select('wallet_address, is_enabled'),
    ]);

    if (walletsRes.error) {
      return NextResponse.json({ ok: false, error: walletsRes.error.message }, { status: 500 });
    }

    const metricsMap = new Map(
      (metricsRes.data ?? []).map((m) => [m.wallet_address, m])
    );

    // Build bot summary map: wallet_address → { total, enabled }
    type BotSummary = { total: number; enabled: number };
    const botMap = new Map<string, BotSummary>();
    for (const bot of (botsRes.data ?? []) as { wallet_address: string; is_enabled: boolean }[]) {
      const existing = botMap.get(bot.wallet_address) ?? { total: 0, enabled: 0 };
      existing.total += 1;
      if (bot.is_enabled) existing.enabled += 1;
      botMap.set(bot.wallet_address, existing);
    }

    const rows = (walletsRes.data ?? []).map((w) => {
      const bots = botMap.get(w.wallet_address);
      return {
        ...w,
        metrics: metricsMap.get(w.wallet_address) ?? null,
        bot_count: bots?.total ?? 0,
        bots_enabled_count: bots?.enabled ?? 0,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ── POST /api/copy/wallets ───────────────────────────────────────────────────
// Create a new tracked wallet and auto-create a default PAPER copy bot.

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

    // ── Auto-create a default PAPER copy bot (idempotent) ───────────────────
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
      // Auto-bot creation is best-effort — wallet was created successfully.
      // The operator can use the backfill route if this fails.
    }

    return NextResponse.json({ ok: true, row: data, bot_created: botCreated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ── PATCH /api/copy/wallets ──────────────────────────────────────────────────
// Update a tracked wallet.
//
// Special behaviour when is_active = false:
//   If the request includes disable_linked_bots: true, all copy_bots rows with
//   the matching wallet_address are set is_enabled = false in the same request.
//   History (copy_attempts, copied_positions) is never touched.
//
// When is_active = true (re-enabling):
//   Linked bots are NOT automatically re-enabled. The operator must do that
//   manually from the Bots tab. This is the safe default.
//
// Returns:
//   { ok, row, bots_disabled? }   (bots_disabled present only when > 0)

export async function PATCH(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { wallet_address, disable_linked_bots, ...updates } = body;

    if (!wallet_address || typeof wallet_address !== 'string') {
      return NextResponse.json({ ok: false, error: 'wallet_address is required' }, { status: 400 });
    }

    // Build the allowed wallet field updates
    const allowed: Record<string, unknown> = {};
    if (typeof updates.is_active     === 'boolean') allowed.is_active     = updates.is_active;
    if (typeof updates.display_name  === 'string')  allowed.display_name  = updates.display_name;
    if (typeof updates.tags          !== 'undefined') allowed.tags         = updates.tags;

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

    // ── Disable linked bots when wallet is turned off ────────────────────────
    // Only fires when:
    //   (a) the wallet is being deactivated  (is_active → false), AND
    //   (b) the caller explicitly requested  (disable_linked_bots: true)
    //
    // Re-enabling a wallet never auto-enables bots (safe default).
    let botsDisabled = 0;
    if (allowed.is_active === false && disable_linked_bots === true) {
      try {
        const { data: disabledBots, error: botError } = await client
          .from('copy_bots')
          .update({ is_enabled: false })
          .eq('wallet_address', wallet_address)
          .eq('is_enabled', true)   // only touch bots that are currently ON
          .select('id');

        if (!botError) {
          botsDisabled = disabledBots?.length ?? 0;
        }
      } catch {
        // Best-effort — wallet was updated successfully even if bot disable fails
      }
    }

    const response: Record<string, unknown> = { ok: true, row: data };
    if (botsDisabled > 0) response.bots_disabled = botsDisabled;

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
