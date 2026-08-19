-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 026 — Company Registry (persistent identity + lifecycle)
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Global company-discovery rework. One row per unique real-world company,
-- resolved via lib/companies/identity.ts (domain -> LinkedIn URL ->
-- normalized name, in that confidence order). This is the persistent
-- source of truth that "already discovered/researched/outreached" checks
-- read and write, replacing the old per-request full-table-scan of
-- pipeline_test_runs that discovery routes used before this migration.
--
-- Named `company_registry`, not `companies` — migration 001 already
-- defines a `companies` table (a different, abandoned schema — zero code
-- references anywhere in the current app, confirmed via repo-wide grep),
-- and whether migration 001 was ever actually applied to the live DB is
-- unverifiable from the repo alone. Reusing the name `companies` risked
-- either a hard CREATE TABLE failure or, worse, an IF NOT EXISTS silently
-- no-op'ing against the wrong old schema. A distinct name sidesteps the
-- ambiguity entirely.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS company_registry (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  canonical_domain        TEXT,
  normalized_name         TEXT        NOT NULL,
  display_name            TEXT        NOT NULL,
  linkedin_url            TEXT,
  linkedin_url_normalized TEXT,

  -- Classification
  sector                  TEXT        CHECK (sector IN ('manufacturing', 'automotive', 'ecommerce')),
  country                 TEXT,

  -- Lifecycle
  status                  TEXT        NOT NULL DEFAULT 'discovered'
                            CHECK (status IN ('discovered', 'qualified', 'disqualified', 'researched', 'outreached')),
  rejection_reason        TEXT        CHECK (rejection_reason IS NULL OR rejection_reason IN (
                            'duplicate', 'already_researched', 'already_outreached', 'wrong_sector',
                            'outside_size_range', 'insufficient_evidence', 'poor_icp_fit',
                            'inactive_company', 'other'
                          )),

  -- Size evidence (see lib/enrichment/company-size.ts) — never a single
  -- number; an array of {metric, raw, valueUsdApprox?, employeeCount?,
  -- sourceSnippet}, metric always one of revenue/valuation/market_cap/
  -- employee_count, never conflated.
  size_evidence            JSONB,

  -- Discovery/source-performance attribution (first-touch only — see
  -- CLAUDE.md discussion of "store the data correctly, don't build a
  -- dashboard yet")
  discovery_source         TEXT,   -- 'cache' | 'gemini_search' | 'serper' | 'tavily' | 'excel_upload' | 'manual'
  discovery_query          TEXT,   -- the query/segment string that surfaced this company

  -- Links into the rest of the schema
  source_run_id             UUID       REFERENCES pipeline_test_runs(id) ON DELETE SET NULL,
  outreach_campaign_id      UUID       REFERENCES outbound_campaigns(id) ON DELETE SET NULL,

  -- Lifecycle timestamps
  discovered_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at             TIMESTAMPTZ,
  researched_at            TIMESTAMPTZ,
  outreached_at            TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_registry IS 'One row per unique real-world company (global identity anchor). status enforces no-automatic-re-research / no-automatic-re-outreach; a manual UI override is the only way to bypass it.';
COMMENT ON COLUMN company_registry.canonical_domain IS 'Normalized domain (protocol/www stripped). Nullable — a name-only-resolved company has no domain yet.';
COMMENT ON COLUMN company_registry.linkedin_url_normalized IS 'Normalized linkedin.com/company/<slug> form, from an already-observed public URL (search snippet or uploaded row) — never fetched/scraped.';
COMMENT ON COLUMN company_registry.rejection_reason IS 'Set only when status=disqualified — one honest reason, never silently dropped.';
COMMENT ON COLUMN company_registry.size_evidence IS 'SizeEvidence[] — revenue/valuation/market_cap/employee_count kept as distinct metrics, never conflated into one figure.';
COMMENT ON COLUMN company_registry.discovery_source IS 'Which tier of routedSearch() (or excel_upload/manual) first surfaced this company — for later cost-per-source analysis.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_registry_domain
  ON company_registry (canonical_domain) WHERE canonical_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_registry_linkedin
  ON company_registry (linkedin_url_normalized) WHERE linkedin_url_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_company_registry_name
  ON company_registry (normalized_name);
CREATE INDEX IF NOT EXISTS idx_company_registry_status
  ON company_registry (status);
CREATE INDEX IF NOT EXISTS idx_company_registry_sector
  ON company_registry (sector);
CREATE INDEX IF NOT EXISTS idx_company_registry_source
  ON company_registry (discovery_source);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'company_registry';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'company_registry'
ORDER BY ordinal_position;
