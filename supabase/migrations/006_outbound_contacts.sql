-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 006 — Outbound Contacts (Email Finder + Validation + Enrichment)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- One row per manually-added contact (person name is always user-supplied —
-- this table never auto-discovers who to contact, see CLAUDE.md's
-- "Outbound Workflow Modules" section). All three modules' columns are
-- created together since they're one logical entity, even though only the
-- email_finder_* columns are wired by the session that adds this migration
-- — validation_*/enrichment columns are populated by later sessions.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_contacts (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id          UUID        REFERENCES pipeline_test_runs(id) ON DELETE SET NULL,
  company_domain         TEXT        NOT NULL,
  company_name           TEXT        NOT NULL,
  person_name            TEXT        NOT NULL,
  title_hint             TEXT,
  linkedin_url           TEXT,
  email                  TEXT,
  email_confidence       TEXT        CHECK (email_confidence IN ('high', 'medium', 'low', 'none')),
  email_finder_provider  TEXT,
  email_finder_status    TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (email_finder_status IN ('pending', 'found', 'not_found', 'error')),
  validation_status      TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (validation_status IN ('pending', 'valid', 'invalid', 'risky', 'unknown')),
  validation_score       INTEGER,
  validation_reason      TEXT,
  validation_provider    TEXT,
  enrichment             JSONB,
  enrichment_status      TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (enrichment_status IN ('pending', 'enriched', 'partial', 'not_found')),
  enrichment_provider    TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_contacts IS 'Manually-added contacts for outbound research. person_name is always user-supplied — never auto-discovered.';
COMMENT ON COLUMN outbound_contacts.source_run_id IS 'Optional link back to the pipeline_test_runs row this contact was researched from.';
COMMENT ON COLUMN outbound_contacts.linkedin_url IS 'Manually-pasted only — never scraped (LinkedIn access stays excluded per CLAUDE.md).';
COMMENT ON COLUMN outbound_contacts.enrichment IS 'Contact Enrichment provider output: { department, seniority, location, roleCategory, linkedinSummary, companySize, industry, confidence }. See EnrichmentResult in lib/outbound/enrichment/types.ts.';

CREATE INDEX IF NOT EXISTS idx_outbound_contacts_source_run ON outbound_contacts(source_run_id);
CREATE INDEX IF NOT EXISTS idx_outbound_contacts_domain ON outbound_contacts(company_domain);
CREATE INDEX IF NOT EXISTS idx_outbound_contacts_created_at ON outbound_contacts(created_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_contacts';
