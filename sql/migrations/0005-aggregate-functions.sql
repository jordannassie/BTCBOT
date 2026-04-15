-- Migration 0005 — Database-side aggregate functions for OPEN position exposure
--
-- WHY THIS EXISTS
-- ---------------
-- Supabase PostgREST returns at most 1 000 rows per request by default.
-- Any API route that fetches copied_positions rows and then sums them in
-- JavaScript silently underreports when there are >1 000 OPEN positions.
-- These functions push COUNT / SUM / AVG / MAX into PostgreSQL, which operates
-- on the full table with no row-limit.
--
-- FUNCTIONS
-- ---------
-- copy_open_position_stats()
--   → one row: total_count, total_exposure, avg_size, max_size (all OPEN)
--   → used by /api/copy/summary
--
-- copy_open_exposure_by_mode()
--   → one row per mode (LIVE / PAPER): count, exposure, avg (all OPEN)
--   → used by /api/copy/exposure
--
-- copy_open_exposure_for_mode(p_mode text)
--   → one row: total_exposure for that mode (all OPEN)
--   → used by /api/copy/exposure-check (pre-trade enforcement)
--
-- All functions are STABLE (read-only, no side-effects) and SECURITY DEFINER
-- so they execute with the schema owner's privileges via the service-role key.
-- Run once against the production Supabase project.

-- ── 1. Overall OPEN position stats (no mode split) ───────────────────────────
CREATE OR REPLACE FUNCTION copy_open_position_stats()
RETURNS TABLE (
  total_count    bigint,
  total_exposure numeric,
  avg_size       numeric,
  max_size       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COUNT(*)::bigint               AS total_count,
    COALESCE(SUM(size),  0)        AS total_exposure,
    COALESCE(AVG(size),  0)        AS avg_size,
    COALESCE(MAX(size),  0)        AS max_size
  FROM copied_positions
  WHERE status = 'OPEN';
$$;

-- ── 2. OPEN exposure grouped by bot mode ─────────────────────────────────────
CREATE OR REPLACE FUNCTION copy_open_exposure_by_mode()
RETURNS TABLE (
  mode           text,
  total_count    bigint,
  total_exposure numeric,
  avg_size       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    cb.mode::text                    AS mode,
    COUNT(cp.id)::bigint             AS total_count,
    COALESCE(SUM(cp.size), 0)        AS total_exposure,
    COALESCE(AVG(cp.size), 0)        AS avg_size
  FROM copied_positions cp
  JOIN copy_bots cb ON cp.copy_bot_id = cb.id
  WHERE cp.status = 'OPEN'
  GROUP BY cb.mode;
$$;

-- ── 3. Single-mode OPEN exposure (for pre-trade cap check) ───────────────────
CREATE OR REPLACE FUNCTION copy_open_exposure_for_mode(p_mode text)
RETURNS TABLE (
  total_exposure numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(cp.size), 0) AS total_exposure
  FROM copied_positions cp
  JOIN copy_bots cb ON cp.copy_bot_id = cb.id
  WHERE cp.status = 'OPEN'
    AND cb.mode = p_mode;
$$;
