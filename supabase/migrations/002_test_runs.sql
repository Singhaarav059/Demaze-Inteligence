-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 002 — Pipeline Test Runs
-- ============================================================
-- Stores every test run from the Intelligence Lab dashboard.
-- Replaces terminal-based testing with a persistent audit trail.
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_test_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_url     TEXT NOT NULL,
  domain          TEXT,

  -- Scrape metadata
  scraped_pages   INTEGER DEFAULT 0,
  failed_pages    INTEGER DEFAULT 0,
  quality_score   INTEGER DEFAULT 0,
  quality_note    TEXT,
  discovery_method TEXT,

  -- AI usage
  token_usage     INTEGER DEFAULT 0,
  provider_used   TEXT,
  model_used      TEXT,
  ai_latency_ms   INTEGER,

  -- Timing
  execution_time_ms  INTEGER,
  scrape_time_ms     INTEGER,
  analysis_time_ms   INTEGER,

  -- Operation type
  operation       TEXT NOT NULL CHECK (operation IN ('scraper_only', 'analysis', 'full_pipeline')),

  -- Results (stored as JSONB for flexibility)
  scrape_result   JSONB,    -- ScrapeResult object (pages, urls, debug info)
  final_result    JSONB,    -- Full AI analysis output JSON
  prompts         JSONB,    -- { systemPrompt, userPrompt } for reproducibility
  error_message   TEXT,     -- Set if the run failed

  -- Status
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'error', 'partial')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for sorting by most recent runs
CREATE INDEX IF NOT EXISTS idx_pipeline_test_runs_created_at
  ON pipeline_test_runs (created_at DESC);

-- Index for filtering by domain
CREATE INDEX IF NOT EXISTS idx_pipeline_test_runs_domain
  ON pipeline_test_runs (domain);

-- Index for filtering by operation type
CREATE INDEX IF NOT EXISTS idx_pipeline_test_runs_operation
  ON pipeline_test_runs (operation);
