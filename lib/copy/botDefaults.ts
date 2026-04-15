// Canonical defaults for all copy bot creation paths:
//   - Manual "Create Bot" form (CopyBotsSection)
//   - Auto-create on Add Wallet (/api/copy/wallets POST)
//   - Backfill (/api/copy/bots/backfill POST)
//
// UNLIMITED SEMANTICS
//   max_open_positions = 0 → no position limit
//   max_trades_per_hour = 0 → no rate limit
//   The worker is expected to treat 0 as "no limit" for these two fields.

export const BOT_DEFAULTS = {
  mode: 'PAPER',
  is_enabled: true,
  arm_live: false,
  copy_mode: 'scaled',
  sizing_value: 1,
  max_trade_size: 25,
  max_open_positions: 0,   // 0 = unlimited
  max_trades_per_hour: 0,  // 0 = unlimited
  max_slippage: 0.03,
  delay_seconds: 0,
  opens_only: false,
  copy_closes: true,
} as const;

// LocalStorage key used by the Create Bot form to persist operator-saved defaults.
export const BOT_DEFAULTS_LS_KEY = 'btcbot-bot-defaults';
