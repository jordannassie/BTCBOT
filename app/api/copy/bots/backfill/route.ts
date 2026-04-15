// Safe, idempotent backfill: creates one default PAPER copy bot for every
// tracked_wallet that has no linked copy_bots row yet.
//
// Calling this multiple times is safe — it checks for existing bots before
// inserting. It never deletes, overwrites, or modifies existing bots.
//
// GET  → preview: returns { scanned, existing, to_create, wallets_needing_bot[] }
// POST → execute: creates the missing bots, returns { scanned, existing, created }

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { BOT_DEFAULTS } from '@/lib/copy/botDefaults';
import { getEffectiveBotDefaults } from '@/lib/copy/masterStrategy';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function defaultBotName(walletAddress: string, displayName: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  const addr = walletAddress.trim();
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

type WalletRow = { wallet_address: string; display_name: string | null };

// ─── GET: dry-run preview ──────────────────────────────────────────────────────
export async function GET() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const [walletsRes, botsRes] = await Promise.all([
      client.from('tracked_wallets').select('wallet_address, display_name'),
      client.from('copy_bots').select('wallet_address'),
    ]);

    if (walletsRes.error) throw new Error(walletsRes.error.message);

    const walletsWithBots = new Set(
      ((botsRes.data ?? []) as { wallet_address: string }[]).map((b) => b.wallet_address)
    );

    const wallets = (walletsRes.data ?? []) as WalletRow[];
    const missing = wallets.filter((w) => !walletsWithBots.has(w.wallet_address));

    return NextResponse.json({
      ok: true,
      dry_run: true,
      scanned: wallets.length,
      existing: walletsWithBots.size,
      to_create: missing.length,
      wallets_needing_bot: missing.map((w) => ({
        wallet_address: w.wallet_address,
        display_name: w.display_name,
        bot_name: defaultBotName(w.wallet_address, w.display_name),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ─── POST: execute backfill ───────────────────────────────────────────────────
export async function POST() {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase credentials missing' }, { status: 500 });
  }

  try {
    const [walletsRes, botsRes] = await Promise.all([
      client.from('tracked_wallets').select('wallet_address, display_name'),
      client.from('copy_bots').select('wallet_address'),
    ]);

    if (walletsRes.error) throw new Error(walletsRes.error.message);

    const walletsWithBots = new Set(
      ((botsRes.data ?? []) as { wallet_address: string }[]).map((b) => b.wallet_address)
    );

    const wallets = (walletsRes.data ?? []) as WalletRow[];
    const missing = wallets.filter((w) => !walletsWithBots.has(w.wallet_address));

    // Resolve effective defaults once for all bots in this backfill run.
    // If "Use for New Bots" is ON the master strategy fields are applied;
    // otherwise BOT_DEFAULTS are used as normal.
    const effectiveDefaults = await getEffectiveBotDefaults(client, { ...BOT_DEFAULTS });

    let created = 0;
    const errors: string[] = [];

    for (const w of missing) {
      const { error } = await client.from('copy_bots').insert({
        ...effectiveDefaults,
        name: defaultBotName(w.wallet_address, w.display_name),
        wallet_address: w.wallet_address,
      });

      if (error) {
        errors.push(`${w.wallet_address}: ${error.message}`);
      } else {
        created++;
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      scanned: wallets.length,
      existing: walletsWithBots.size,
      created,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
