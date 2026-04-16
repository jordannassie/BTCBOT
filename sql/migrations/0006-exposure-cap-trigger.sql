-- =============================================================================
-- Migration: 0006-exposure-cap-trigger.sql
-- Purpose:   Hard-enforce the paper/live exposure cap at the database level.
--
-- PROBLEM SOLVED
-- --------------
-- copy_global_settings.paper_max_exposure_usd and live_max_exposure_usd are
-- advisory caps stored in the DB and displayed on the dashboard.  The only
-- enforcement in place was POST /api/copy/exposure-check — a cooperative HTTP
-- endpoint the worker must call before opening a position.  Because the worker
-- does not call that endpoint, the cap had no effect: the worker inserted rows
-- directly into copied_positions regardless of current exposure.
--
-- This migration adds a BEFORE INSERT trigger on copied_positions that enforces
-- the cap at the database layer.  The worker does not need to change.  If a
-- position INSERT would push total open exposure over the configured cap, the
-- INSERT is rejected with a clear Postgres exception and the row is never
-- written.
--
-- SAFE TO RUN ON PRODUCTION — uses CREATE OR REPLACE FUNCTION and
-- DROP TRIGGER IF EXISTS, so it is idempotent and can be re-run safely.
--
-- HOW THE TRIGGER WORKS
-- ---------------------
-- 1. Fires BEFORE INSERT on every new copied_positions row.
-- 2. Immediately returns if NEW.status <> 'OPEN'
--      → closes (UPDATE), cancellations (UPDATE), and any INSERT that arrives
--        already-closed are always allowed — this trigger NEVER blocks them.
-- 3. Resolves the bot's mode (PAPER / LIVE) via copy_bots.
-- 4. Reads the applicable cap column from copy_global_settings (singleton id=1).
-- 5. If the cap is 0 or NULL → unlimited, returns immediately.
-- 6. Calculates current open exposure for that mode using the same
--    JOIN logic as copy_open_exposure_for_mode() (migration 0005) so the
--    trigger and the dashboard always read identical numbers.
-- 7. If current_exposure + NEW.size > cap → RAISE EXCEPTION (INSERT aborted).
--    Otherwise → RETURN NEW (INSERT proceeds normally).
--
-- ERROR FORMAT (returned to the caller as a Postgres / Supabase error):
--   exposure_cap_exceeded: current=850.00 proposed=200.00 would_be=1050.00 cap=1000.00 mode=PAPER
--
-- SCOPE
-- -----
--   PAPER mode cap  → enforced by paper_max_exposure_usd (0 = unlimited)
--   LIVE  mode cap  → enforced by live_max_exposure_usd  (0 = unlimited)
--   Closes / sells  → never touched (worker closes via UPDATE, not INSERT)
--   Restart Paper   → never touched (updates status to CANCELLED via UPDATE)
-- =============================================================================


-- ── Trigger function ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.copy_enforce_exposure_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_mode    text;
  v_cap     numeric;
  v_current numeric;
BEGIN
  -- ── Step 1: Only check new OPEN positions ──────────────────────────────────
  -- Closes and cancellations are recorded by the worker as UPDATEs to existing
  -- rows (status: OPEN → CLOSED / CANCELLED).  This trigger is BEFORE INSERT
  -- only, so UPDATEs are invisible to it.  Any INSERT that arrives with a
  -- non-OPEN status (e.g. a historical import) is also allowed through.
  IF NEW.status <> 'OPEN' THEN
    RETURN NEW;
  END IF;

  -- ── Step 2: Resolve the bot's mode ────────────────────────────────────────
  SELECT mode INTO v_mode
  FROM public.copy_bots
  WHERE id = NEW.copy_bot_id;

  IF v_mode IS NULL THEN
    -- Bot not found — let the FK constraint produce the appropriate error.
    RETURN NEW;
  END IF;

  -- ── Step 3: Read the cap for this mode ────────────────────────────────────
  IF v_mode = 'PAPER' THEN
    SELECT paper_max_exposure_usd INTO v_cap
    FROM public.copy_global_settings
    WHERE id = 1;
  ELSIF v_mode = 'LIVE' THEN
    SELECT live_max_exposure_usd INTO v_cap
    FROM public.copy_global_settings
    WHERE id = 1;
  ELSE
    -- Unknown mode — allow through; mode validation belongs to copy_bots.
    RETURN NEW;
  END IF;

  -- ── Step 4: 0 or NULL means unlimited ─────────────────────────────────────
  IF v_cap IS NULL OR v_cap = 0 THEN
    RETURN NEW;
  END IF;

  -- ── Step 5: Sum current open exposure for this mode ───────────────────────
  -- Identical JOIN to copy_open_exposure_for_mode() (migration 0005) so the
  -- trigger and the dashboard always agree on the current exposure figure.
  -- Orphaned rows (copy_bot_id no longer in copy_bots) are excluded by the JOIN.
  SELECT COALESCE(SUM(cp.size), 0) INTO v_current
  FROM public.copied_positions cp
  JOIN public.copy_bots cb ON cb.id = cp.copy_bot_id
  WHERE cp.status = 'OPEN'
    AND cb.mode    = v_mode;

  -- ── Step 6: Enforce the cap ───────────────────────────────────────────────
  IF v_current + NEW.size > v_cap THEN
    RAISE EXCEPTION 'exposure_cap_exceeded: current=% proposed=% would_be=% cap=% mode=%',
      v_current,
      NEW.size,
      (v_current + NEW.size),
      v_cap,
      v_mode
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- ── Trigger registration ──────────────────────────────────────────────────────
-- DROP + CREATE is idempotent — safe to re-run if the trigger already exists.

DROP TRIGGER IF EXISTS copy_exposure_cap_check ON public.copied_positions;

CREATE TRIGGER copy_exposure_cap_check
  BEFORE INSERT ON public.copied_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_enforce_exposure_cap();


-- ── Deployment note ───────────────────────────────────────────────────────────
-- Run this entire file in the Supabase SQL editor (or via supabase db push).
-- No grants are needed for the trigger function itself — it runs under the
-- privileges of the table owner (postgres / supabase_admin), not the caller.
--
-- To verify after deployment:
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.copied_positions'::regclass;
--   -- Expected: copy_exposure_cap_check | O  (O = enabled)
--
-- To verify the function exists:
--   SELECT proname FROM pg_proc WHERE proname = 'copy_enforce_exposure_cap';
