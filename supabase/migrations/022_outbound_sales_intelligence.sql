-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 022 — Outbound Sales Intelligence (per-run generated object)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- One row per research run, generated on-demand (not part of the
-- always-running research pipeline — see lib/sales-knowledge/generate.ts)
-- once the user reaches Auto Flow's "Sales Strategy" step. Two parallel
-- column sets, not a diff/history table:
--   - recommended_* — immutable AI/deterministic output, the audit trail
--     ("what did we originally suggest").
--   - active_* — nullable user overrides ("what generation actually
--     uses"). NULL means "use the matching recommended_* value" — this
--     COALESCE happens at read time in application code, not via a
--     generated column, so the read-side fallback logic lives in one
--     place (lib/sales-knowledge/repository.ts) rather than duplicated
--     in SQL.
-- is_overridden is a simple boolean flag, not a per-field audit log — the
-- spec asks for "AI recommended X, you changed it to Y" visibility, not a
-- timestamped change history, and a history table would be over-building
-- for that requirement.
--
-- Depends on migration 021 (sales_knowledge_* tables) existing first —
-- recommended_*/active_* slug/id columns reference those tables by
-- slug/id but are NOT foreign keys (same app-level-only referential
-- integrity as the tag-array columns in 021), since a Sales Knowledge row
-- can be soft-deleted later without invalidating a historical run's
-- point-in-time snapshot of what it recommended.
--
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_sales_intelligence (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id                 UUID        NOT NULL REFERENCES pipeline_test_runs(id) ON DELETE CASCADE,

  -- Immutable AI/deterministic-recommended values
  recommended_industry_slug     TEXT,
  recommended_problem_slug      TEXT,
  recommended_capability_slug   TEXT,
  recommended_case_study_ids    UUID[]      NOT NULL DEFAULT '{}',
  recommended_roles             TEXT[]      NOT NULL DEFAULT '{}',
  recommended_cta               TEXT,
  confidence_tier                TEXT       CHECK (confidence_tier IN ('confirmed_fact', 'research_supported_signal', 'industry_pattern', 'hypothesis')),
  reasoning                      JSONB      NOT NULL DEFAULT '{}',
  positioning_text               TEXT,

  -- User-editable overrides (NULL = "use the matching recommended_* value")
  active_industry_slug          TEXT,
  active_problem_slug           TEXT,
  active_capability_slug        TEXT,
  active_case_study_ids         UUID[],
  active_roles                  TEXT[],
  active_cta                    TEXT,
  active_positioning_text       TEXT,

  is_overridden                  BOOLEAN    NOT NULL DEFAULT false,
  status                          TEXT       NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'reviewed', 'stale')),
  ai_provider_used               TEXT,
  ai_model_used                  TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_sales_intelligence IS 'One generated, user-editable Sales Intelligence object per research run. active_* NULL means "use recommended_*" — see lib/sales-knowledge/repository.ts for the read-side fallback.';
COMMENT ON COLUMN outbound_sales_intelligence.confidence_tier IS 'Evidence hierarchy: confirmed_fact (verbatim quote in scraped content) > research_supported_signal (LLM-observed, paraphrased) > industry_pattern (tag overlap only, no company-specific evidence) > hypothesis (narrative guess only, no corroboration).';
COMMENT ON COLUMN outbound_sales_intelligence.reasoning IS 'Traceability strings: {industry, problem, capability, case_study, roles, cta} -> "why this was recommended" text, shown in the Sales Strategy UI.';
COMMENT ON COLUMN outbound_sales_intelligence.status IS 'generated = fresh from the matcher, untouched. reviewed = user has looked at/edited it. stale = reserved for a future re-research-invalidates-old-intelligence flow, not wired to anything yet.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_sales_intelligence_run ON outbound_sales_intelligence(source_run_id);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_sales_intelligence';
