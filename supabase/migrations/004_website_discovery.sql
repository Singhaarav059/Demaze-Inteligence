-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 004 — Website Discovery Logging
-- ============================================================
-- Adds a column to log the Step 0 website-discovery result (status, domain,
-- confidence, reason, candidates) on every pipeline_test_runs row where the
-- run started from a company name rather than a direct URL.
--
-- Stored as a single JSONB object (not 4 separate columns) — it's one atomic
-- result, and this avoids a 4-column migration for what's fundamentally one
-- decision. Queryable via JSONB operators (e.g. website_discovery->>'status')
-- if filtering by discovery outcome is needed later.
--
-- Purpose: when a future report looks wrong, this lets us check whether the
-- wrong company was resolved at step zero, before any other pipeline stage
-- ran at all.
-- ============================================================

ALTER TABLE pipeline_test_runs
  ADD COLUMN IF NOT EXISTS website_discovery JSONB;

COMMENT ON COLUMN pipeline_test_runs.website_discovery IS
  'Step 0 result: { status, domain, confidence, reason, candidates }. NULL when the run started from a direct URL (no discovery needed).';
