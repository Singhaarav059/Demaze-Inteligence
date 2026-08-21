-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 026 — Company Universe (multi-source structured company data)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Built for Demaze_Multi_Source_Company_Universe_Claude_Prompt.md. Per that
-- prompt's own Section 1 ("inspect the existing repository, do not trust
-- CLAUDE.md blindly"): this repo has NO `company_registry` table and no
-- prior persistent company-universe store of any kind — confirmed via a
-- repo-wide grep before writing this migration. `pipeline_test_runs`
-- (migration 002) is the closest existing analog to what that prompt calls
-- `company_registry` ("companies actively processed by Demaze" — each row
-- is one researched company's pipeline result), and this migration
-- deliberately does not touch it. `company_universe` below is a genuinely
-- new, separate concept: raw/normalized company EXISTENCE from free/public
-- structured sources, queried BEFORE a company ever enters the research
-- pipeline — see Section 34 of that prompt for the same separation.
--
-- Three tables, one ingestion pipeline stage each (see
-- lib/company-universe/ingestion.ts):
--   1. company_universe — canonical, identity-resolved company records,
--      built via lib/company-universe/identity.ts.
--   2. company_source_records — one row per (provider, native record id),
--      raw provenance, source of truth for every fact this system knows.
--      References company_universe once identity resolution has run.
--   3. company_universe_ingestion_runs — append-only health/metrics log per
--      ingestion run (Section 25 of the source prompt), so "GLEIF = stale" /
--      "India MCA = quota exhausted" is a real, queryable fact instead
--      of a silent gap.
--
-- No RLS, matching every other table in this schema — this app has no
-- browser-side Supabase client anywhere; all access is server-only via
-- SUPABASE_SERVICE_ROLE_KEY through Next.js API routes (see
-- lib/supabase/server.ts). Provider credentials/bulk-source controls are
-- never exposed to the browser, per Section 36 of the source prompt.
-- ============================================================

-- ── 1. Canonical, identity-resolved company records ────────────────────
-- Field list follows Section 8 of the source prompt closely — "do not
-- blindly add every field" was honored by dropping nothing from that list
-- (every field there genuinely improves company-universe functionality;
-- none were speculative additions of this migration's own).
CREATE TABLE IF NOT EXISTS company_universe (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  canonical_name         TEXT        NOT NULL,
  legal_name             TEXT,
  trade_name             TEXT,

  domain                 TEXT,

  country                TEXT,
  country_code           TEXT,
  state_region           TEXT,
  city                   TEXT,
  registered_address     TEXT,

  company_type           TEXT,
  entity_type            TEXT,

  industry               TEXT,
  industry_codes         TEXT[]      NOT NULL DEFAULT '{}',
  sic_codes              TEXT[]      NOT NULL DEFAULT '{}',
  naics_codes            TEXT[]      NOT NULL DEFAULT '{}',

  employee_count         INTEGER,
  employee_count_min     INTEGER,
  employee_count_max     INTEGER,

  revenue                NUMERIC,
  revenue_currency       TEXT,
  revenue_year           INTEGER,

  founded_year           INTEGER,

  registration_id        TEXT,
  registration_authority TEXT,

  cin                    TEXT,
  lei                    TEXT,
  cik                    TEXT,
  company_number         TEXT,

  parent_company_id      UUID        REFERENCES company_universe(id) ON DELETE SET NULL,
  ultimate_parent_id     UUID        REFERENCES company_universe(id) ON DELETE SET NULL,

  status                 TEXT        NOT NULL DEFAULT 'unknown' CHECK (status IN ('active', 'inactive', 'dissolved', 'unknown')),

  -- Which providers currently have a source_records row feeding this
  -- canonical company (Section 26 — "retain the source set," never just
  -- overwrite with the last provider's response). Denormalized here for
  -- cheap read access; company_source_records.company_universe_id is the
  -- actual source of truth this array is derived from.
  source_providers       TEXT[]      NOT NULL DEFAULT '{}',

  -- 'deterministic_id' — matched/merged via a real registration ID (CIN/
  -- LEI/CIK/company_number); 'fuzzy_name_domain' — matched via the
  -- conservative fuzzy fallback in identity.ts; 'single_source' — only one
  -- provider has ever contributed, no cross-source match attempted yet.
  data_confidence        TEXT        NOT NULL DEFAULT 'single_source' CHECK (data_confidence IN ('deterministic_id', 'fuzzy_name_domain', 'single_source')),

  source_last_updated    TIMESTAMPTZ,

  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_universe IS 'Canonical, identity-resolved company-existence records from free/public structured sources (GLEIF, SEC EDGAR, Companies House, India MCA). Distinct from pipeline_test_runs: this table answers "which companies exist," not "which companies Demaze has researched." Populated by lib/company-universe/ingestion.ts.';
COMMENT ON COLUMN company_universe.data_confidence IS 'How this canonical record was formed: deterministic_id (matched via a real registration identifier — the strongest evidence), fuzzy_name_domain (conservative name+domain fallback, only used when no deterministic identifier was available), or single_source (only one provider has ever contributed — no cross-source match attempted).';
COMMENT ON COLUMN company_universe.source_providers IS 'Denormalized list of providers currently contributing to this record — see company_source_records for the authoritative per-provider rows this is derived from.';

-- Partial unique indexes on the strongest deterministic identifiers — the
-- actual re-run-safety mechanism is lib/company-universe/identity.ts's
-- resolveIdentity() (looks up by every available deterministic ID BEFORE
-- deciding insert vs. update, since a company can plausibly have more than
-- one identifier and Postgres upsert only targets one conflict key at a
-- time), but these indexes are still a real safety net against two
-- concurrent ingestion runs racing to insert the same identifier twice.
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_universe_lei ON company_universe(lei) WHERE lei IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_universe_cik ON company_universe(cik) WHERE cik IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_universe_cin ON company_universe(cin) WHERE cin IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_company_universe_company_number ON company_universe(registration_authority, company_number) WHERE company_number IS NOT NULL;

-- Discovery-query indexes — Section 35's field list, trimmed to fields this
-- codebase's actual query patterns use (ICP criteria: country/industry/
-- classification codes/status/employee_count/company_type; identity
-- lookups: domain/registration_id are covered by the unique indexes above
-- already; no separate index added purely because the prompt listed the
-- field, per that section's own "don't create dozens of unnecessary
-- indexes" instruction).
CREATE INDEX IF NOT EXISTS idx_company_universe_country_code ON company_universe(country_code);
CREATE INDEX IF NOT EXISTS idx_company_universe_industry ON company_universe(industry);
CREATE INDEX IF NOT EXISTS idx_company_universe_sic_codes ON company_universe USING GIN(sic_codes);
CREATE INDEX IF NOT EXISTS idx_company_universe_naics_codes ON company_universe USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_company_universe_status ON company_universe(status);
CREATE INDEX IF NOT EXISTS idx_company_universe_employee_count ON company_universe(employee_count);
CREATE INDEX IF NOT EXISTS idx_company_universe_company_type ON company_universe(company_type);
CREATE INDEX IF NOT EXISTS idx_company_universe_domain ON company_universe(domain);
CREATE INDEX IF NOT EXISTS idx_company_universe_canonical_name ON company_universe(canonical_name);

-- ── 2. Raw provenance, one row per (provider, native record) ──────────
-- Every imported fact needs provenance (Section 9) — this table IS that
-- provenance layer. raw_data keeps the full original provider record, so
-- re-normalizing (e.g. after a normalize.ts bug fix) never requires
-- re-fetching from the provider.
CREATE TABLE IF NOT EXISTS company_source_records (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider      TEXT        NOT NULL CHECK (source_provider IN ('india_mca', 'companies_house', 'gleif', 'sec_edgar')),
  source_record_id     TEXT        NOT NULL,
  source_type          TEXT        NOT NULL DEFAULT 'api' CHECK (source_type IN ('api', 'bulk')),
  source_url           TEXT,
  raw_data             JSONB       NOT NULL,
  source_last_updated  TIMESTAMPTZ,
  retrieved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_universe_id  UUID        REFERENCES company_universe(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_source_records IS 'One row per (provider, native record id) — the raw, field-level provenance layer every company_universe fact traces back to. Running ingestion twice for the same provider record upserts this row (unique on source_provider+source_record_id) rather than duplicating it — the actual re-run-safety mechanism, per Section 10 of the source prompt.';
COMMENT ON COLUMN company_source_records.raw_data IS 'The full original provider record, verbatim (after JSON/CSV/XML parsing, before Demaze normalization) — lets normalize.ts be re-run over already-ingested data without re-fetching from the provider.';
COMMENT ON COLUMN company_source_records.company_universe_id IS 'Set by the IDENTITY MATCH pipeline stage (lib/company-universe/identity.ts). NULL only transiently, between a record being parsed/validated and identity resolution running in the same ingestion pass.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_company_source_records_provider_record ON company_source_records(source_provider, source_record_id);
CREATE INDEX IF NOT EXISTS idx_company_source_records_universe_id ON company_source_records(company_universe_id);

-- ── 3. Append-only ingestion-run health/metrics log ────────────────────
-- Section 25 — "Demaze should know India MCA = healthy, GLEIF = stale,
-- Companies House = quota exhausted... rather than silently returning
-- incomplete discovery." One row per ingestion run (not per provider) so
-- history is preserved — "last successful sync"/"source freshness" is a
-- query (MAX(completed_at) WHERE status='succeeded' GROUP BY provider),
-- not a value that gets silently overwritten. Same append-only-snapshot
-- shape as outbound_warmup_metrics (migration 009).
CREATE TABLE IF NOT EXISTS company_universe_ingestion_runs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             TEXT        NOT NULL CHECK (provider IN ('india_mca', 'companies_house', 'gleif', 'sec_edgar')),
  run_type             TEXT        NOT NULL DEFAULT 'incremental' CHECK (run_type IN ('initial', 'incremental', 'search')),
  status               TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),

  records_fetched      INTEGER     NOT NULL DEFAULT 0,
  records_parsed       INTEGER     NOT NULL DEFAULT 0,
  records_rejected     INTEGER     NOT NULL DEFAULT 0,
  records_inserted     INTEGER     NOT NULL DEFAULT 0,
  records_updated      INTEGER     NOT NULL DEFAULT 0,
  records_deduplicated INTEGER     NOT NULL DEFAULT 0,
  records_failed        INTEGER    NOT NULL DEFAULT 0,

  api_calls            INTEGER     NOT NULL DEFAULT 0,
  rate_limited_count   INTEGER     NOT NULL DEFAULT 0,
  timeout_count        INTEGER     NOT NULL DEFAULT 0,
  avg_latency_ms       INTEGER,

  -- Resumable-cursor state for a run interrupted mid-way (Section 10's
  -- "record 4,000 of 10,000 fails, don't lose the previous 3,999") — shape
  -- is provider-specific (an offset, a page token, a byte position in a
  -- bulk file), so JSONB rather than a typed column.
  checkpoint           JSONB,
  error                TEXT,

  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_universe_ingestion_runs IS 'Append-only health/metrics log, one row per ingestion run. A provider''s current health is its most recent row; source freshness is MAX(completed_at) WHERE status=''succeeded'' per provider. Section 25 of the source prompt.';
COMMENT ON COLUMN company_universe_ingestion_runs.checkpoint IS 'Provider-specific resumable cursor (offset/page-token/byte-position) so a run interrupted mid-way can resume from where it left off instead of re-processing already-ingested records or losing progress. Section 10/11.';

CREATE INDEX IF NOT EXISTS idx_company_universe_ingestion_runs_provider_started ON company_universe_ingestion_runs(provider, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_universe_ingestion_runs_status ON company_universe_ingestion_runs(status);
