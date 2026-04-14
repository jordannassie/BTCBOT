-- =============================================================================
-- Migration: 0003-copy-trading-schema.sql
-- Purpose:   Additive copy-trading schema for Polymarket wallet copy-trading.
--
-- SAFE TO RUN ON PRODUCTION — does NOT modify or drop any existing tables.
-- All statements use CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- The updated_at trigger function uses CREATE OR REPLACE FUNCTION (idempotent).
--
-- Existing tables untouched:
--   public.bot_settings
--   public.bot_heartbeat
--   public.bot_trades
--   public.paper_positions
-- =============================================================================


-- =============================================================================
-- SHARED UTILITY: updated_at trigger function
-- =============================================================================
-- Uses CREATE OR REPLACE so it is safe to re-run if a previous migration
-- already created a version of this function.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- =============================================================================
-- 1. tracked_wallets
-- =============================================================================
-- Wallets we want to monitor, rank, or copy.
-- Every other copy-trading table references wallet_address back to this table.

CREATE TABLE IF NOT EXISTS public.tracked_wallets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  text        NOT NULL,
  display_name    text,
  avatar_url      text,
  bio             text,
  tags            text[]      NOT NULL DEFAULT '{}',
  is_active       boolean     NOT NULL DEFAULT true,
  source          text        NOT NULL DEFAULT 'manual',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tracked_wallets_wallet_address_key UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS tracked_wallets_is_active_idx
  ON public.tracked_wallets (is_active);

CREATE OR REPLACE TRIGGER trg_tracked_wallets_updated_at
  BEFORE UPDATE ON public.tracked_wallets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tracked_wallets DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tracked_wallets IS
  'Polymarket wallets monitored for copy-trading. All other copy-trading tables '
  'reference wallet_address back here.';


-- =============================================================================
-- 2. wallet_metrics
-- =============================================================================
-- Computed ranking and performance statistics per wallet.
-- Populated by the worker on a scheduled basis (not written by the frontend).

CREATE TABLE IF NOT EXISTS public.wallet_metrics (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address     text        NOT NULL,
  pnl_7d             numeric     NOT NULL DEFAULT 0,
  pnl_30d            numeric     NOT NULL DEFAULT 0,
  pnl_all            numeric     NOT NULL DEFAULT 0,
  win_rate           numeric     NOT NULL DEFAULT 0,   -- 0.0–1.0
  trade_count        integer     NOT NULL DEFAULT 0,
  volume             numeric     NOT NULL DEFAULT 0,
  avg_hold_minutes   numeric     NOT NULL DEFAULT 0,
  max_drawdown       numeric     NOT NULL DEFAULT 0,
  copy_score         numeric     NOT NULL DEFAULT 0,   -- composite ranking score
  category_focus     text,                             -- dominant category if any
  last_trade_at      timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT wallet_metrics_wallet_address_fkey
    FOREIGN KEY (wallet_address)
    REFERENCES public.tracked_wallets (wallet_address)
    ON DELETE CASCADE,

  CONSTRAINT wallet_metrics_wallet_address_key UNIQUE (wallet_address)
);

CREATE INDEX IF NOT EXISTS wallet_metrics_copy_score_idx
  ON public.wallet_metrics (copy_score DESC);

CREATE INDEX IF NOT EXISTS wallet_metrics_pnl_30d_idx
  ON public.wallet_metrics (pnl_30d DESC);

CREATE INDEX IF NOT EXISTS wallet_metrics_updated_at_idx
  ON public.wallet_metrics (updated_at DESC);

CREATE OR REPLACE TRIGGER trg_wallet_metrics_updated_at
  BEFORE UPDATE ON public.wallet_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wallet_metrics DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallet_metrics IS
  'Computed performance stats per tracked wallet. Updated by the worker on a '
  'scheduled cadence. win_rate is stored as a decimal (0.0–1.0).';


-- =============================================================================
-- 3. wallet_trades
-- =============================================================================
-- Raw trades observed from external wallets via Polymarket CLOB / data feed.
-- Append-only ingestion table — records are never updated after insert.

CREATE TABLE IF NOT EXISTS public.wallet_trades (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address   text        NOT NULL,
  source_trade_id  text        NOT NULL,   -- external trade identifier (dedup key)
  market_slug      text,
  market_title     text,
  condition_id     text,
  token_id         text,
  side             text,                   -- 'BUY' | 'SELL'
  outcome          text,                   -- 'YES' | 'NO'
  price            numeric,                -- per-share price (0–1 scale)
  size             numeric,                -- number of shares
  notional         numeric,                -- price × size in USD
  traded_at        timestamptz NOT NULL,
  ingested_at      timestamptz NOT NULL DEFAULT now(),
  raw_json         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT wallet_trades_wallet_address_fkey
    FOREIGN KEY (wallet_address)
    REFERENCES public.tracked_wallets (wallet_address)
    ON DELETE CASCADE,

  CONSTRAINT wallet_trades_wallet_source_key
    UNIQUE (wallet_address, source_trade_id)
);

CREATE INDEX IF NOT EXISTS wallet_trades_wallet_traded_at_idx
  ON public.wallet_trades (wallet_address, traded_at DESC);

CREATE INDEX IF NOT EXISTS wallet_trades_market_slug_idx
  ON public.wallet_trades (market_slug);

CREATE INDEX IF NOT EXISTS wallet_trades_token_id_idx
  ON public.wallet_trades (token_id);

CREATE INDEX IF NOT EXISTS wallet_trades_traded_at_idx
  ON public.wallet_trades (traded_at DESC);

ALTER TABLE public.wallet_trades DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallet_trades IS
  'Raw trades ingested from tracked external wallets. Append-only — rows are '
  'never updated after insert. Deduplication key is (wallet_address, source_trade_id).';


-- =============================================================================
-- 4. copy_bots
-- =============================================================================
-- Defines each copy-trading bot instance: which wallet to copy, sizing rules,
-- filters, and mode (PAPER / LIVE). One bot copies exactly one source wallet.

CREATE TABLE IF NOT EXISTS public.copy_bots (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text        NOT NULL,
  wallet_address       text        NOT NULL,
  mode                 text        NOT NULL DEFAULT 'PAPER',
  is_enabled           boolean     NOT NULL DEFAULT false,
  arm_live             boolean     NOT NULL DEFAULT false,
  copy_mode            text        NOT NULL DEFAULT 'scaled',
  sizing_value         numeric     NOT NULL DEFAULT 1,     -- multiplier, fixed USD, or %
  max_trade_size       numeric     NOT NULL DEFAULT 25,    -- USD cap per trade
  max_open_positions   integer     NOT NULL DEFAULT 10,
  max_trades_per_hour  integer     NOT NULL DEFAULT 20,
  max_slippage         numeric     NOT NULL DEFAULT 0.03,  -- e.g. 0.03 = 3%
  min_liquidity        numeric     NOT NULL DEFAULT 0,     -- USD min market liquidity
  opens_only           boolean     NOT NULL DEFAULT true,  -- copy only entry trades
  copy_closes          boolean     NOT NULL DEFAULT false, -- also copy exit trades
  category_filter      text[]      NOT NULL DEFAULT '{}', -- limit to these categories
  delay_seconds        integer     NOT NULL DEFAULT 0,     -- intentional copy delay
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT copy_bots_wallet_address_fkey
    FOREIGN KEY (wallet_address)
    REFERENCES public.tracked_wallets (wallet_address)
    ON DELETE CASCADE,

  CONSTRAINT copy_bots_mode_check
    CHECK (mode IN ('PAPER', 'LIVE')),

  CONSTRAINT copy_bots_copy_mode_check
    CHECK (copy_mode IN ('exact', 'scaled', 'percent'))
);

CREATE INDEX IF NOT EXISTS copy_bots_wallet_address_idx
  ON public.copy_bots (wallet_address);

CREATE INDEX IF NOT EXISTS copy_bots_is_enabled_idx
  ON public.copy_bots (is_enabled);

CREATE INDEX IF NOT EXISTS copy_bots_mode_idx
  ON public.copy_bots (mode);

CREATE OR REPLACE TRIGGER trg_copy_bots_updated_at
  BEFORE UPDATE ON public.copy_bots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.copy_bots DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copy_bots IS
  'Each row is one copy-trading bot that mirrors a single tracked wallet. '
  'copy_mode: exact = fixed USD, scaled = multiplier of source size, '
  'percent = percentage of available bankroll. '
  'arm_live must be true AND copy_global_settings.live_on must be true '
  'before a LIVE order is ever submitted.';


-- =============================================================================
-- 5. copy_attempts
-- =============================================================================
-- Audit log of every decision to copy or skip a source wallet trade.
-- Always written even when the trade is skipped (skip_reason explains why).
-- Append-only — rows are never updated.

CREATE TABLE IF NOT EXISTS public.copy_attempts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_bot_id      uuid        NOT NULL,
  wallet_address   text        NOT NULL,
  source_trade_id  text        NOT NULL,
  market_slug      text,
  market_title     text,
  token_id         text,
  source_side      text,
  source_outcome   text,
  source_price     numeric,
  source_size      numeric,
  submitted_price  numeric,
  submitted_size   numeric,
  copied           boolean     NOT NULL DEFAULT false,
  skip_reason      text,       -- populated when copied = false
  order_status     text,       -- e.g. 'MATCHED', 'PARTIAL', 'FAILED', 'SKIPPED'
  latency_ms       integer,    -- ms from source trade observed to order submitted
  slippage         numeric,    -- actual slippage achieved
  raw_response     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT copy_attempts_copy_bot_id_fkey
    FOREIGN KEY (copy_bot_id)
    REFERENCES public.copy_bots (id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS copy_attempts_bot_created_idx
  ON public.copy_attempts (copy_bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS copy_attempts_wallet_created_idx
  ON public.copy_attempts (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS copy_attempts_source_trade_idx
  ON public.copy_attempts (source_trade_id);

CREATE INDEX IF NOT EXISTS copy_attempts_copied_idx
  ON public.copy_attempts (copied);

CREATE INDEX IF NOT EXISTS copy_attempts_order_status_idx
  ON public.copy_attempts (order_status);

ALTER TABLE public.copy_attempts DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copy_attempts IS
  'Full audit log of every copy decision — both copied and skipped trades. '
  'Append-only. skip_reason explains why a trade was not executed. '
  'latency_ms measures how quickly the copy worker reacted to the source trade.';


-- =============================================================================
-- 6. copied_positions
-- =============================================================================
-- Open and closed positions held by copy bots. Updated as positions resolve.

CREATE TABLE IF NOT EXISTS public.copied_positions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_bot_id      uuid        NOT NULL,
  wallet_address   text        NOT NULL,
  source_trade_id  text,
  market_slug      text,
  market_title     text,
  condition_id     text,
  token_id         text,
  side             text,        -- 'BUY' | 'SELL'
  outcome          text,        -- 'YES' | 'NO'
  entry_price      numeric,
  size             numeric,
  status           text        NOT NULL DEFAULT 'OPEN',
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  exit_price       numeric,
  pnl              numeric     NOT NULL DEFAULT 0,
  raw_json         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT copied_positions_copy_bot_id_fkey
    FOREIGN KEY (copy_bot_id)
    REFERENCES public.copy_bots (id)
    ON DELETE CASCADE,

  CONSTRAINT copied_positions_status_check
    CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS copied_positions_bot_status_idx
  ON public.copied_positions (copy_bot_id, status);

CREATE INDEX IF NOT EXISTS copied_positions_wallet_idx
  ON public.copied_positions (wallet_address);

CREATE INDEX IF NOT EXISTS copied_positions_market_slug_idx
  ON public.copied_positions (market_slug);

CREATE INDEX IF NOT EXISTS copied_positions_token_id_idx
  ON public.copied_positions (token_id);

CREATE INDEX IF NOT EXISTS copied_positions_opened_at_idx
  ON public.copied_positions (opened_at DESC);

ALTER TABLE public.copied_positions DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copied_positions IS
  'Positions opened by copy bots. status transitions: OPEN → CLOSED (resolved) '
  'or OPEN → CANCELLED (manually stopped or bot disabled). '
  'pnl is populated at close time; it is 0 while status = OPEN.';


-- =============================================================================
-- 7. market_cache
-- =============================================================================
-- Reusable Polymarket market metadata and token mapping.
-- Populated by the worker. Used by the frontend for display and by the worker
-- for token ID lookup before submitting CLOB orders.

CREATE TABLE IF NOT EXISTS public.market_cache (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_slug      text        NOT NULL,
  market_title     text,
  condition_id     text,
  yes_token_id     text,
  no_token_id      text,
  active           boolean     NOT NULL DEFAULT true,
  liquidity        numeric     NOT NULL DEFAULT 0,
  volume           numeric     NOT NULL DEFAULT 0,
  category         text,
  end_date         timestamptz,
  last_event_at    timestamptz,
  raw_json         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT market_cache_market_slug_key UNIQUE (market_slug)
);

CREATE INDEX IF NOT EXISTS market_cache_condition_id_idx
  ON public.market_cache (condition_id);

CREATE INDEX IF NOT EXISTS market_cache_active_idx
  ON public.market_cache (active);

CREATE INDEX IF NOT EXISTS market_cache_category_idx
  ON public.market_cache (category);

CREATE INDEX IF NOT EXISTS market_cache_updated_at_idx
  ON public.market_cache (updated_at DESC);

CREATE OR REPLACE TRIGGER trg_market_cache_updated_at
  BEFORE UPDATE ON public.market_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.market_cache DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.market_cache IS
  'Cached Polymarket market metadata. yes_token_id / no_token_id are the CLOB '
  'token IDs required to submit orders. Updated by the worker; never written by '
  'the frontend directly.';


-- =============================================================================
-- 8. copy_global_settings
-- =============================================================================
-- Single-row global kill-switch and defaults for the entire copy-trading system.
-- Enforced as a singleton at the DB level via CHECK (id = 1).
--
-- live_on is the master live-trading switch. A copy bot CANNOT submit a live
-- order unless: copy_bots.mode = 'LIVE' AND copy_bots.arm_live = true
--   AND copy_global_settings.live_on = true.
-- emergency_stop immediately halts all live order submission when set to true.

CREATE TABLE IF NOT EXISTS public.copy_global_settings (
  -- Singleton enforcement: only one row may ever exist (id must equal 1).
  id                       smallint    PRIMARY KEY DEFAULT 1,
  live_on                  boolean     NOT NULL DEFAULT false,
  emergency_stop           boolean     NOT NULL DEFAULT false,
  max_total_live_exposure  numeric     NOT NULL DEFAULT 500,   -- USD
  default_slippage_cap     numeric     NOT NULL DEFAULT 0.03,  -- 3%
  default_position_size    numeric     NOT NULL DEFAULT 10,    -- USD
  default_max_positions    integer     NOT NULL DEFAULT 10,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT copy_global_settings_singleton CHECK (id = 1)
);

-- Seed the single row so it always exists; do nothing if already present.
INSERT INTO public.copy_global_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE TRIGGER trg_copy_global_settings_updated_at
  BEFORE UPDATE ON public.copy_global_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.copy_global_settings DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.copy_global_settings IS
  'Single-row global settings for the copy-trading system. '
  'live_on is the master live-trading gate — must be true along with '
  'copy_bots.arm_live before any live order is submitted. '
  'emergency_stop = true halts all live execution immediately. '
  'The singleton constraint (id = 1) prevents accidental multi-row inserts.';


-- =============================================================================
-- END OF MIGRATION 0003
-- =============================================================================
