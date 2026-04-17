-- Migration 0008 — Per-bot exit mode settings
-- Adds three columns to copy_bots to support the Auto Profit and
-- Auto Profit + Max Hold exit strategies. The Worker reads these fields
-- to decide whether to close a position early.
--
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks).

ALTER TABLE public.copy_bots
  ADD COLUMN IF NOT EXISTS exit_mode TEXT NOT NULL DEFAULT 'mirror_only'
    CHECK (exit_mode IN ('mirror_only', 'auto_profit', 'auto_profit_max_hold'));

ALTER TABLE public.copy_bots
  ADD COLUMN IF NOT EXISTS take_profit_pct NUMERIC NOT NULL DEFAULT 8;

ALTER TABLE public.copy_bots
  ADD COLUMN IF NOT EXISTS max_hold_minutes INTEGER NOT NULL DEFAULT 10;

COMMENT ON COLUMN public.copy_bots.exit_mode IS
  'mirror_only = close only when source wallet closes | '
  'auto_profit = close when profit >= take_profit_pct | '
  'auto_profit_max_hold = auto_profit + time-based close after max_hold_minutes';

COMMENT ON COLUMN public.copy_bots.take_profit_pct IS
  'Take-profit threshold in percent (e.g. 8 = close at +8%). '
  'Used when exit_mode is auto_profit or auto_profit_max_hold.';

COMMENT ON COLUMN public.copy_bots.max_hold_minutes IS
  'Close position after this many minutes regardless of P/L. '
  'Used only when exit_mode = auto_profit_max_hold.';
