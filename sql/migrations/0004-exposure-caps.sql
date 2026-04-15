-- Migration 0004 — Global exposure caps split by bot mode
--
-- Adds separate max-exposure caps for PAPER and LIVE trading.
-- Convention: 0 = unlimited (cap is disabled for that mode).
--
-- The existing max_total_live_exposure column is kept as-is (backwards
-- compat with any external workers that already read it).  The new
-- live_max_exposure_usd column is the authoritative live cap used by the
-- enforcement endpoint and UI going forward; max_total_live_exposure is
-- preserved as a legacy alias and will be retired in a future migration.
--
-- Run once against the production Supabase project.

ALTER TABLE public.copy_global_settings
  ADD COLUMN IF NOT EXISTS live_max_exposure_usd  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paper_max_exposure_usd numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.copy_global_settings.live_max_exposure_usd IS
  'Max total USD allocated across all OPEN LIVE copied positions. 0 = unlimited.';

COMMENT ON COLUMN public.copy_global_settings.paper_max_exposure_usd IS
  'Max total USD allocated across all OPEN PAPER copied positions. 0 = unlimited.';
