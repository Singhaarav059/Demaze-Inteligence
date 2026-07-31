-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 015 — Decision-Maker Search Cache
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Migration 010's own comment said discovered candidates are "never
-- persisted directly... ephemeral until selected" — that discipline is
-- reversed by this migration for a concrete UX reason, not a scope change:
-- DecisionMakerFinder.tsx's autoStart search was re-firing a real, PAID
-- Prospeo search every time the component remounted (a page refresh, or
-- navigating away from and back to Auto Flow's Decision Makers step), and
-- discarding whatever the user had already found/checked. This table caches
-- the last search's raw result per source_run_id so a remount can restore
-- it instead of re-searching. A manual "Search Again" click still always
-- performs a fresh search and overwrites the cache (see the route's own
-- upsert) — this only prevents an UNREQUESTED re-search.
--
-- One row per source_run_id (a fresh search replaces the previous one,
-- never accumulates history) — this is a cache, not an audit log.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_decision_maker_searches (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id    UUID        NOT NULL REFERENCES pipeline_test_runs(id) ON DELETE CASCADE,
  company_domain   TEXT        NOT NULL,
  company_name     TEXT        NOT NULL,
  target_titles    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  candidates       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  provider_used    TEXT,
  status           TEXT        CHECK (status IN ('found', 'not_found', 'error')),
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_run_id)
);

COMMENT ON TABLE outbound_decision_maker_searches IS 'Caches the last decision-maker discovery search result per source_run_id, so a UI remount restores it instead of firing another paid search. Not an audit trail — a fresh search overwrites the row.';
COMMENT ON COLUMN outbound_decision_maker_searches.candidates IS 'Raw DecisionMakerCandidate[] from the search result (personName/title/seniority/department/linkedinUrl/confidence/grounding) — same shape returned live by POST /api/admin/outbound/decision-makers/discover.';
COMMENT ON COLUMN outbound_decision_maker_searches.target_titles IS 'The target titles this search was run with, so a restored session shows the same input that produced these candidates.';

CREATE INDEX IF NOT EXISTS idx_outbound_dm_searches_source_run ON outbound_decision_maker_searches(source_run_id);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_decision_maker_searches';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'outbound_decision_maker_searches'
ORDER BY ordinal_position;
