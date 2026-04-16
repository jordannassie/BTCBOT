-- =============================================================================
-- Migration: 0007-wallet-pnl-daily.sql
-- Purpose:   Add derived analytics columns to wallet_metrics and create the
--            wallet_pnl_daily time-series table for sparkline rendering.
--
-- SAFE TO RUN ON PRODUCTION — all statements are additive / idempotent.
-- =============================================================================


-- =============================================================================
-- 1. New columns on wallet_metrics
-- =============================================================================
-- trades_per_day  — smoothed activity rate (trade_count / window_days).
--                   Populated by the enrichment endpoint and the worker.
-- quick_exit_rate — fraction 0–1 of positions closed before market resolution.
--                   Populated by the worker from per-trade granularity data.
-- first_trade_at  — timestamp of the wallet's earliest known trade, used for
--                   accurate trades_per_day over the full observed lifetime.

ALTER TABLE public.wallet_metrics
  ADD COLUMN IF NOT EXISTS trades_per_day  numeric,
  ADD COLUMN IF NOT EXISTS quick_exit_rate numeric,
  ADD COLUMN IF NOT EXISTS first_trade_at  timestamptz;

COMMENT ON COLUMN public.wallet_metrics.trades_per_day IS
  'Smoothed trades-per-day rate. For Polymarket leaderboard wallets this is '
  'trade_count / 30 (30-day window). Updated by enrichment endpoint and worker.';

COMMENT ON COLUMN public.wallet_metrics.quick_exit_rate IS
  'Fraction (0–1) of observed positions closed before market resolution. '
  'Null until the worker processes per-trade history. '
  'High value (> 0.5) → "Quick Exit" fast-copy signal.';

COMMENT ON COLUMN public.wallet_metrics.first_trade_at IS
  'Timestamp of the earliest known trade by this wallet. '
  'Used to compute lifetime trades_per_day when available.';


-- =============================================================================
-- 2. wallet_pnl_daily — time-series daily P&L per tracked wallet
-- =============================================================================
-- One row per (wallet_address, date) pair.
-- Populated by the copy-trading worker from observed source wallet trades.
-- When populated, this table drives the profit sparkline; otherwise the
-- frontend falls back to computing a cumulative curve from copied_positions.

CREATE TABLE IF NOT EXISTS public.wallet_pnl_daily (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text        NOT NULL,
  date            date        NOT NULL,
  daily_pnl       numeric     NOT NULL DEFAULT 0,   -- that day's realised P&L
  cumulative_pnl  numeric     NOT NULL DEFAULT 0,   -- running total up to this day
  trade_count     integer     NOT NULL DEFAULT 0,   -- trades on this date
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wallet_pnl_daily_wallet_fkey
    FOREIGN KEY (wallet_address)
    REFERENCES public.tracked_wallets (wallet_address)
    ON DELETE CASCADE,

  CONSTRAINT wallet_pnl_daily_unique
    UNIQUE (wallet_address, date)
);

-- Clustered index for sparkline queries (all dates for one wallet)
CREATE INDEX IF NOT EXISTS wallet_pnl_daily_wallet_date_idx
  ON public.wallet_pnl_daily (wallet_address, date ASC);

-- Reverse index for latest-first queries
CREATE INDEX IF NOT EXISTS wallet_pnl_daily_date_desc_idx
  ON public.wallet_pnl_daily (date DESC);

ALTER TABLE public.wallet_pnl_daily DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallet_pnl_daily IS
  'Daily realised P&L and running cumulative P&L per tracked wallet. '
  'One row per (wallet, date). Populated by the worker from source wallet '
  'trade history. Used by /api/copy/wallet-series as the primary sparkline '
  'data source; copied_positions is the fallback.';


-- =============================================================================
-- END OF MIGRATION 0007
-- =============================================================================
