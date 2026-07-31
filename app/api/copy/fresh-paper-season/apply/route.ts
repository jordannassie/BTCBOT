// POST /api/copy/fresh-paper-season/apply
//
// Guarded apply endpoint for the "Replace Old Traders & Start Fresh Paper" workflow.
//
// Required body:
//   confirmation      — must equal exactly "START FRESH PAPER"
//   selected_wallets  — [{ wallet_address, display_name? }] — 1–10 entries
//   trade_amount      — fixed USD per trade (e.g. 5)
//
// Two modes (controlled by request body field `mode`):
//
//   mode = 'replace' (default)
//     Steps 1–8: safety → disable old bots → archive paper positions →
//                reset bankroll → upsert wallets → create/enable bots → verify
//     Confirmation phrase: 'START FRESH PAPER'
//
//   mode = 'add'
//     Steps 1–2, then 6–8 only: safety → upsert wallets → create/enable bots → verify
//     Does NOT disable existing bots, archive positions, or reset bankroll.
//     Confirmation phrase: 'ADD PAPER TRADERS'
//
// Never touches LIVE bots' real positions, wallet signing, or execution code.
// Never enables ARM LIVE or the global live gate.
// Never deletes historical data.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic  = 'force-dynamic';
export const revalidate = 0;

const NO_CACHE           = { 'Cache-Control': 'no-store, max-age=0' };
const CONFIRMATION       = 'START FRESH PAPER';
const ADD_CONFIRMATION   = 'ADD PAPER TRADERS';
const PAPER_BOT_ID       = 'copy_paper';

function getServiceClient() {
  let url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (url.startsWith('$')) url = '';
  if (!url.startsWith('http') || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function truncateAddr(addr: string) {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

export async function POST(request: Request) {
  const client = getServiceClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: 'Supabase credentials missing' },
      { status: 500, headers: NO_CACHE }
    );
  }

  // ── 1. Parse and validate request ─────────────────────────────────────────
  let body: { confirmation?: unknown; selected_wallets?: unknown; trade_amount?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: NO_CACHE }
    );
  }

  // mode: 'replace' (default) = full reset workflow; 'add' = add traders only
  const applyMode: 'replace' | 'add' = body.mode === 'add' ? 'add' : 'replace';
  const requiredPhrase = applyMode === 'add' ? ADD_CONFIRMATION : CONFIRMATION;

  if (body.confirmation !== requiredPhrase) {
    return NextResponse.json(
      { ok: false, error: `Confirmation phrase must be exactly "${requiredPhrase}"` },
      { status: 400, headers: NO_CACHE }
    );
  }

  if (!Array.isArray(body.selected_wallets) || body.selected_wallets.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'selected_wallets must be a non-empty array' },
      { status: 400, headers: NO_CACHE }
    );
  }

  type SelectedWallet = { wallet_address: string; display_name: string | null };
  const selectedWallets: SelectedWallet[] = [];
  const seenAddrs = new Set<string>();

  for (const w of body.selected_wallets as Record<string, unknown>[]) {
    const addr = typeof w.wallet_address === 'string' ? w.wallet_address.trim() : '';
    if (!addr || !addr.startsWith('0x') || addr.length < 10) {
      return NextResponse.json(
        { ok: false, error: `Invalid wallet address: "${addr}"` },
        { status: 400, headers: NO_CACHE }
      );
    }
    if (seenAddrs.has(addr.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: `Duplicate wallet address: "${truncateAddr(addr)}"` },
        { status: 400, headers: NO_CACHE }
      );
    }
    seenAddrs.add(addr.toLowerCase());
    selectedWallets.push({
      wallet_address: addr,
      display_name:   typeof w.display_name === 'string' ? w.display_name.trim() || null : null,
    });
  }

  const tradeAmount = Number(body.trade_amount);
  if (!Number.isFinite(tradeAmount) || tradeAmount <= 0) {
    return NextResponse.json(
      { ok: false, error: 'trade_amount must be a positive number' },
      { status: 400, headers: NO_CACHE }
    );
  }

  const now = new Date().toISOString();
  const result: Record<string, unknown> = {
    step: 'started',
    bots_disabled:         0,
    paper_positions_cleared: 0,
    paper_bankroll:        0,
    wallets_upserted:      0,
    bots_created:          0,
    bots_updated:          0,
    live_bots_created:     0,
    arm_live_bots:         0,
    started_at:            now,
  };

  try {
    // ── 2. Re-run safety checks ──────────────────────────────────────────────
    result.step = 'safety_check';

    const [settingsRes, botsRes] = await Promise.all([
      client.from('copy_global_settings').select('live_on, emergency_stop').eq('id', 1).single(),
      client.from('copy_bots').select('id, wallet_address, mode, is_enabled, arm_live'),
    ]);

    const settings = settingsRes.data;
    const allBots  = (botsRes.data ?? []) as { id: string; wallet_address: string; mode: string; is_enabled: boolean; arm_live: boolean }[];

    // Only block on bots that are genuinely live-capable: enabled LIVE bots with arm_live
    const dangerousArmLive = allBots.filter((b) => b.arm_live && b.is_enabled && b.mode === 'LIVE').length;
    const liveBotIds       = allBots.filter((b) => b.mode === 'LIVE').map((b) => b.id);

    let openLiveCount = 0;
    if (liveBotIds.length > 0) {
      const { count } = await client
        .from('copied_positions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'OPEN')
        .in('copy_bot_id', liveBotIds);
      openLiveCount = count ?? 0;
    }

    const safetyBlocks: string[] = [];
    if (settings?.live_on)         safetyBlocks.push('Global live trading gate is ON');
    if (dangerousArmLive > 0)      safetyBlocks.push(`${dangerousArmLive} enabled LIVE bot${dangerousArmLive !== 1 ? 's have' : ' has'} ARM LIVE on`);
    if (openLiveCount > 0)         safetyBlocks.push(`${openLiveCount} open LIVE position${openLiveCount !== 1 ? 's exist' : ' exists'}`);

    if (safetyBlocks.length > 0) {
      return NextResponse.json(
        { ok: false, error: 'Safety checks failed', safety_blocks: safetyBlocks, step: 'safety_check' },
        { status: 409, headers: NO_CACHE }
      );
    }

    // Check selected wallets are not PERSONAL/AVOID tagged
    const selectedAddrs = selectedWallets.map((w) => w.wallet_address);
    const { data: personalTagged } = await client
      .from('tracked_wallets')
      .select('wallet_address, tags')
      .in('wallet_address', selectedAddrs);

    for (const tw of (personalTagged ?? []) as { wallet_address: string; tags: string[] | null }[]) {
      const tags = (tw.tags ?? []).map((t) => t?.toUpperCase?.() ?? '');
      if (tags.includes('PERSONAL') || tags.includes('AVOID')) {
        return NextResponse.json(
          {
            ok: false,
            error: `Wallet ${truncateAddr(tw.wallet_address)} is tagged PERSONAL or AVOID and cannot be selected`,
            step: 'safety_check',
          },
          { status: 400, headers: NO_CACHE }
        );
      }
    }

    // ── 3–5: Replace-mode only (disable old bots, archive positions, reset bankroll) ──
    if (applyMode === 'replace') {

      // ── 3. Disable all existing bots ───────────────────────────────────────
      result.step = 'disable_old_bots';

      const allBotIds = allBots.map((b) => b.id);
      if (allBotIds.length > 0) {
        const { error: disableErr } = await client
          .from('copy_bots')
          .update({
            is_enabled:  false,
            arm_live:    false,
            opens_only:  true,
            updated_at:  now,
          })
          .in('id', allBotIds);

        if (disableErr) {
          return NextResponse.json(
            { ok: false, error: disableErr.message, step: 'disable_old_bots', partial: result },
            { status: 500, headers: NO_CACHE }
          );
        }
        result.bots_disabled = allBotIds.length;
      }

      // ── 4. Archive open PAPER positions ────────────────────────────────────
      result.step = 'archive_paper_positions';

      const paperBotIds = allBots.filter((b) => b.mode === 'PAPER').map((b) => b.id);
      if (paperBotIds.length > 0) {
        const { count: openCount } = await client
          .from('copied_positions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'OPEN')
          .in('copy_bot_id', paperBotIds);

        if (openCount && openCount > 0) {
          const { error: cancelErr } = await client
            .from('copied_positions')
            .update({ status: 'CANCELLED', closed_at: now })
            .eq('status', 'OPEN')
            .in('copy_bot_id', paperBotIds);

          if (cancelErr) {
            return NextResponse.json(
              { ok: false, error: cancelErr.message, step: 'archive_paper_positions', partial: result },
              { status: 500, headers: NO_CACHE }
            );
          }
          result.paper_positions_cleared = openCount;
        }
      }

      // ── 5. Reset paper bankroll ─────────────────────────────────────────────
      result.step = 'reset_paper_bankroll';

      const { data: currentSettings } = await client
        .from('bot_settings')
        .select('strategy_settings')
        .eq('bot_id', PAPER_BOT_ID)
        .maybeSingle();

      const paperDefault: number =
        (currentSettings?.strategy_settings as { paper_default?: number } | null)?.paper_default ?? 1000;

      const { data: bankroll, error: bankrollErr } = await client
        .from('bot_settings')
        .upsert(
          { bot_id: PAPER_BOT_ID, paper_balance_usd: paperDefault, paper_pnl_usd: 0, updated_at: now },
          { onConflict: 'bot_id' }
        )
        .select('paper_balance_usd')
        .single();

      if (bankrollErr) {
        return NextResponse.json(
          { ok: false, error: bankrollErr.message, step: 'reset_paper_bankroll', partial: result },
          { status: 500, headers: NO_CACHE }
        );
      }
      result.paper_bankroll = bankroll?.paper_balance_usd ?? paperDefault;

    } // end replace-mode steps

    // ── 6. Upsert tracked_wallets for each selected trader ───────────────────
    result.step = 'upsert_wallets';

    for (const sw of selectedWallets) {
      const { error: walletErr } = await client
        .from('tracked_wallets')
        .upsert(
          {
            wallet_address: sw.wallet_address,
            display_name:   sw.display_name,
            is_active:      true,
            source:         'fresh_paper_season',
            updated_at:     now,
          },
          { onConflict: 'wallet_address', ignoreDuplicates: false }
        );

      if (walletErr) {
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to upsert wallet ${truncateAddr(sw.wallet_address)}: ${walletErr.message}`,
            step: 'upsert_wallets',
            partial: result,
          },
          { status: 500, headers: NO_CACHE }
        );
      }
      (result.wallets_upserted as number)++;
    }

    // ── 7. Create or update exactly one PAPER bot per selected trader ─────────
    result.step = 'create_paper_bots';

    // Fetch existing bots for selected wallets (after step 3 disabled them)
    const { data: existingBots } = await client
      .from('copy_bots')
      .select('id, wallet_address, mode')
      .in('wallet_address', selectedAddrs)
      .eq('mode', 'PAPER');

    const existingPaperBotByWallet = new Map<string, string>(); // addr → id
    for (const bot of (existingBots ?? []) as { id: string; wallet_address: string; mode: string }[]) {
      existingPaperBotByWallet.set(bot.wallet_address, bot.id);
    }

    const freshBotIds: string[] = [];

    for (const sw of selectedWallets) {
      const existingId = existingPaperBotByWallet.get(sw.wallet_address) ?? null;

      if (existingId) {
        // Update the existing PAPER bot back to fresh active state
        const { error: updateErr } = await client
          .from('copy_bots')
          .update({
            is_enabled:  true,
            arm_live:    false,
            opens_only:  false,
            copy_closes: true,
            mode:        'PAPER',
            sizing_value: tradeAmount,
            max_trade_size: tradeAmount,
            updated_at:  now,
          })
          .eq('id', existingId);

        if (updateErr) {
          return NextResponse.json(
            {
              ok: false,
              error: `Failed to update bot for ${truncateAddr(sw.wallet_address)}: ${updateErr.message}`,
              step: 'create_paper_bots',
              partial: result,
            },
            { status: 500, headers: NO_CACHE }
          );
        }
        freshBotIds.push(existingId);
        (result.bots_updated as number)++;
      } else {
        // Create a brand new PAPER bot
        const botName = sw.display_name
          ? `Paper — ${sw.display_name}`
          : `Paper — ${truncateAddr(sw.wallet_address)}`;

        const { data: newBot, error: createErr } = await client
          .from('copy_bots')
          .insert({
            name:               botName,
            wallet_address:     sw.wallet_address,
            mode:               'PAPER',
            is_enabled:         true,
            arm_live:           false,
            opens_only:         false,
            copy_closes:        true,
            copy_mode:          'exact',
            sizing_value:       tradeAmount,
            max_trade_size:     tradeAmount,
            max_open_positions: 0,
            max_trades_per_hour: 0,
            max_slippage:       0.03,
            delay_seconds:      0,
            exit_mode:          'mirror_only',
          })
          .select('id')
          .single();

        if (createErr || !newBot) {
          return NextResponse.json(
            {
              ok: false,
              error: `Failed to create bot for ${truncateAddr(sw.wallet_address)}: ${createErr?.message ?? 'no data'}`,
              step: 'create_paper_bots',
              partial: result,
            },
            { status: 500, headers: NO_CACHE }
          );
        }
        freshBotIds.push(newBot.id);
        (result.bots_created as number)++;
      }
    }

    // ── 8. Verify final state ─────────────────────────────────────────────────
    result.step = 'verify';

    const { data: finalBots } = await client
      .from('copy_bots')
      .select('id, mode, is_enabled, arm_live, opens_only, copy_closes')
      .in('id', freshBotIds);

    const finalArr = (finalBots ?? []) as { id: string; mode: string; is_enabled: boolean; arm_live: boolean; opens_only: boolean; copy_closes: boolean }[];

    result.final = {
      fresh_bots_total:         finalArr.length,
      fresh_bots_enabled:       finalArr.filter((b) => b.is_enabled).length,
      fresh_bots_new_entries_on: finalArr.filter((b) => !b.opens_only).length,
      fresh_bots_exit_monitor_on: finalArr.filter((b) => b.copy_closes).length,
      fresh_bots_arm_live:      finalArr.filter((b) => b.arm_live).length,
      fresh_bots_live_mode:     finalArr.filter((b) => b.mode === 'LIVE').length,
    };

    result.step            = 'done';
    result.ok              = true;
    result.apply_mode      = applyMode;
    result.trade_amount    = tradeAmount;
    result.arm_live_bots   = 0;
    result.live_bots_created = 0;

    console.log(
      `FRESH_PAPER_SEASON disabled=${result.bots_disabled}` +
      ` positions_cleared=${result.paper_positions_cleared}` +
      ` bankroll=${result.paper_bankroll}` +
      ` bots_created=${result.bots_created}` +
      ` bots_updated=${result.bots_updated}`
    );

    return NextResponse.json(result, { headers: NO_CACHE });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: message, step: result.step, partial: result },
      { status: 500, headers: NO_CACHE }
    );
  }
}
