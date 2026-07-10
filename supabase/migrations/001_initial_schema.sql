-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 001 — Initial Schema
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================


-- ============================================================
-- TABLE 1: companies
-- One row per unique company domain.
-- The persistent intelligence anchor — all other tables hang off this.
-- ============================================================

CREATE TABLE companies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain            TEXT        NOT NULL UNIQUE,
  name              TEXT,
  website           TEXT        NOT NULL,
  industry          TEXT,
  sub_industry      TEXT,
  headquarters      TEXT,
  size_estimate     TEXT,
  business_model    TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_analyzed_at  TIMESTAMPTZ,
  analysis_count    INTEGER     NOT NULL DEFAULT 0,
  metadata          JSONB       NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE companies IS 'One row per unique company domain. The persistent intelligence profile anchor.';
COMMENT ON COLUMN companies.domain IS 'Normalized domain e.g. acmecorp.com — unique constraint prevents duplicates';
COMMENT ON COLUMN companies.metadata IS 'Extensible catch-all for future fields without schema migrations';


-- ============================================================
-- TABLE 2: analyses
-- One row per pipeline run against a company.
-- A company can have many analyses over time.
-- ============================================================

CREATE TABLE analyses (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'scraping', 'analyzing', 'done', 'error')),
  error_message         TEXT,
  triggered_by          TEXT        NOT NULL DEFAULT 'manual'
                          CHECK (triggered_by IN ('manual', 'scheduled', 'bulk', 'api')),
  scraped_content       JSONB,
  report                JSONB,
  ai_provider_used      TEXT,
  ai_model_used         TEXT,
  scrape_duration_ms    INTEGER,
  analysis_duration_ms  INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

COMMENT ON TABLE analyses IS 'One row per pipeline run. Stores status, raw scrape content, and the full structured report.';
COMMENT ON COLUMN analyses.status IS 'pending → scraping → analyzing → done | error';
COMMENT ON COLUMN analyses.report IS 'Full structured JSON report including scores, signals, opportunities, outreach angle';
COMMENT ON COLUMN analyses.scraped_content IS 'Raw Firecrawl output stored for debugging and re-analysis without re-scraping';


-- ============================================================
-- TABLE 3: signals
-- One row per detected signal.
-- Normalized for queryability — enables filtering across all companies by signal type.
-- ============================================================

CREATE TABLE signals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  analysis_id   UUID        REFERENCES analyses(id) ON DELETE SET NULL,
  type          TEXT        NOT NULL,
  category      TEXT        NOT NULL
                  CHECK (category IN ('growth', 'hiring', 'digital_transformation', 'business')),
  strength      TEXT        NOT NULL
                  CHECK (strength IN ('weak', 'moderate', 'strong')),
  evidence      TEXT        NOT NULL,
  source_url    TEXT,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active     BOOLEAN     NOT NULL DEFAULT true
);

COMMENT ON TABLE signals IS 'Normalized signal storage. Each detected signal is a discrete row for cross-company queries.';
COMMENT ON COLUMN signals.type IS 'Signal type from taxonomy e.g. new_facility, automation_hiring, erp_implementation';
COMMENT ON COLUMN signals.evidence IS 'Exact text passage from the website that triggered this signal detection';
COMMENT ON COLUMN signals.is_active IS 'Set to false when a newer analysis supersedes this signal';


-- ============================================================
-- TABLE 4: opportunities
-- One row per AI/automation opportunity identified at a company.
-- Normalized for cross-company opportunity queries.
-- ============================================================

CREATE TABLE opportunities (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  analysis_id       UUID        REFERENCES analyses(id) ON DELETE SET NULL,
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  relevance         TEXT        NOT NULL
                      CHECK (relevance IN ('High', 'Medium', 'Low')),
  estimated_impact  TEXT,
  entry_point       TEXT,
  category          TEXT,
  detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active         BOOLEAN     NOT NULL DEFAULT true
);

COMMENT ON TABLE opportunities IS 'Normalized opportunity storage. Enables queries like show all companies with computer vision opportunities.';
COMMENT ON COLUMN opportunities.entry_point IS 'Recommended job title to contact for this specific opportunity';
COMMENT ON COLUMN opportunities.category IS 'e.g. quality, logistics, maintenance, scheduling, safety';


-- ============================================================
-- TABLE 5: ai_providers
-- Configuration for AI providers.
-- Provider selection logic reads this table — switching models needs no code change.
-- ============================================================

CREATE TABLE ai_providers (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL UNIQUE,
  display_name  TEXT        NOT NULL,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  priority      INTEGER     NOT NULL DEFAULT 0,
  config        JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_providers IS 'AI provider configuration. Priority ASC = tried first. Changing models = row update, not code change.';
COMMENT ON COLUMN ai_providers.priority IS 'Lower number = higher priority. Provider with priority 1 is tried before priority 2.';
COMMENT ON COLUMN ai_providers.config IS 'Stores base_url, model name, max_tokens, temperature per provider';


-- ============================================================
-- INDEXES
-- ============================================================

-- companies
CREATE UNIQUE INDEX idx_companies_domain
  ON companies(domain);

CREATE INDEX idx_companies_last_analyzed
  ON companies(last_analyzed_at DESC NULLS LAST);

-- analyses
CREATE INDEX idx_analyses_company_id
  ON analyses(company_id);

CREATE INDEX idx_analyses_status
  ON analyses(status);

CREATE INDEX idx_analyses_created_at
  ON analyses(created_at DESC);

-- signals
CREATE INDEX idx_signals_company_id
  ON signals(company_id);

CREATE INDEX idx_signals_type
  ON signals(type);

CREATE INDEX idx_signals_category
  ON signals(category);

CREATE INDEX idx_signals_strength
  ON signals(strength);

CREATE INDEX idx_signals_active
  ON signals(is_active)
  WHERE is_active = true;

-- opportunities
CREATE INDEX idx_opportunities_company_id
  ON opportunities(company_id);

CREATE INDEX idx_opportunities_relevance
  ON opportunities(relevance);

CREATE INDEX idx_opportunities_active
  ON opportunities(is_active)
  WHERE is_active = true;

-- ai_providers
CREATE INDEX idx_ai_providers_priority
  ON ai_providers(priority ASC)
  WHERE is_active = true;


-- ============================================================
-- SEED DATA: ai_providers
-- Three NVIDIA NIM models in priority order.
-- All share the same base_url and API key env var.
-- ============================================================

INSERT INTO ai_providers (name, display_name, is_active, is_default, priority, config)
VALUES
  (
    'nvidia_nim_llama_70b',
    'NVIDIA NIM — Llama 3.1 70B Instruct',
    true,
    true,
    1,
    '{
      "base_url": "https://integrate.api.nvidia.com/v1",
      "model": "meta/llama-3.1-70b-instruct",
      "max_tokens": 4096,
      "temperature": 0.2
    }'::jsonb
  ),
  (
    'nvidia_nim_mixtral_8x22b',
    'NVIDIA NIM — Mixtral 8x22B Instruct',
    true,
    false,
    2,
    '{
      "base_url": "https://integrate.api.nvidia.com/v1",
      "model": "mistralai/mixtral-8x22b-instruct",
      "max_tokens": 4096,
      "temperature": 0.2
    }'::jsonb
  ),
  (
    'nvidia_nim_nemotron_120b',
    'NVIDIA NIM — Nemotron Super 120B',
    true,
    false,
    3,
    '{
      "base_url": "https://integrate.api.nvidia.com/v1",
      "model": "nvidia/nemotron-3-super-120b",
      "max_tokens": 4096,
      "temperature": 0.2
    }'::jsonb
  );


-- ============================================================
-- VERIFICATION QUERIES
-- Run these after migration to confirm everything was created correctly.
-- ============================================================

-- Should return 5 rows, one per table
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'analyses', 'signals', 'opportunities', 'ai_providers')
ORDER BY table_name;

-- Should return 3 rows (the seeded providers)
SELECT name, display_name, priority, is_default
FROM ai_providers
ORDER BY priority;
