// ─────────────────────────────────────────────────────────────────────────────
// lib/config.ts — Centralised frontend constants
//
// This file is the single source of truth for product labels, bot IDs, market
// display strings, and strategy filter options.
//
// Before evolving this codebase into a new product (e.g. copy-trading):
//   • Update APP_NAME / APP_TITLE / APP_DESCRIPTION for the new brand.
//   • Update MARKET_DISPLAY to change the market name prefix and icon colour.
//   • Update BOT_IDS / STRATEGY_FILTER_OPTIONS when adding/removing strategies.
//   • The ALLOWED_BOT_IDS Set is derived automatically — no manual sync needed.
// ─────────────────────────────────────────────────────────────────────────────

// ─── App Branding ─────────────────────────────────────────────────────────────

export const APP_NAME = 'BTCBOT';
export const APP_TITLE = 'BTCBOT · Trading Dashboard';
export const APP_DESCRIPTION =
  'Professional crypto trading bot dashboard powered by Supabase';

// ─── Market Display ───────────────────────────────────────────────────────────
// Controls the market name prefix and icon colour shown in the activity feed
// and positions panel. Swap these when moving to a different market type
// (e.g. a Polymarket copy-trading product with wallet-attributed markets).

export const MARKET_DISPLAY = {
  /** Prefix prepended to every market slug in the activity feed / positions panel. */
  titlePrefix: 'Bitcoin Up or Down - ',
  /** Fill colour for the market icon SVG circle. */
  iconColor: '#F7931A',
} as const;

// ─── Bot IDs ──────────────────────────────────────────────────────────────────
// All bot_id values known to this frontend.
// Referenced by:
//   • /api/bot-settings route allowlist (ALLOWED_BOT_IDS, derived below)
//   • PaperStrategyCard, PaperCandleBiasCard, LiveCard props
//   • app/dashboard/page.tsx strategy grid

export const BOT_IDS = {
  DEFAULT: 'default',
  LIVE: 'live',
  PAPER_FASTLOOP: 'paper_fastloop',
  PAPER_SNIPER: 'paper_sniper',
  PAPER_CANDLE_BIAS: 'paper_candle_bias',
  PAPER_SWEEP_RECLAIM: 'paper_sweep_reclaim',
  PAPER_BREAKOUT_CLOSE: 'paper_breakout_close',
  PAPER_ENGULFING_LEVEL: 'paper_engulfing_level',
  PAPER_REJECTION_WICK: 'paper_rejection_wick',
  PAPER_FOLLOW_THROUGH: 'paper_follow_through',
  // Legacy — not currently mounted in the dashboard UI but retained in the API
  // allowlist to avoid breaking any in-flight DB rows.
  PAPER_COPY: 'paper_copy',
  PAPER_SCALPER: 'paper_scalper',
  // Worker strategy — BTC 5-minute EMA crossover
  BTC_5M_EMA: 'btc_5m_ema',
  // Worker strategy — BTC 5-minute late-entry window (controlled via /api/btc-5m-late)
  BTC_5M_LATE: 'btc_5m_late',
} as const;

/** All bot_id values accepted by /api/bot-settings. Derived from BOT_IDS. */
export const ALLOWED_BOT_IDS = new Set<string>(Object.values(BOT_IDS));

// ─── Strategy Filter Options ──────────────────────────────────────────────────
// Options shown in the StrategyFilter dropdown. 'ALL' must remain first.
// The string values must match the `strategy_id` column in the bot_trades table.

export const STRATEGY_FILTER_OPTIONS = [
  'ALL',
  'FASTLOOP',
  'SNIPER',
  'CANDLE_BIAS',
  'SWEEP_RECLAIM',
  'BREAKOUT_CLOSE',
  'ENGULFING_LEVEL',
  'REJECTION_WICK',
  'FOLLOW_THROUGH',
] as const;

export type StrategyFilterOption = (typeof STRATEGY_FILTER_OPTIONS)[number];
