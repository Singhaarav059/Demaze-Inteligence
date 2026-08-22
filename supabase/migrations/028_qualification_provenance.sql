-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 028 — Qualification provenance + ruleset versioning
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Closes a real gap found live 2026-08-20: company_registry.status could
-- be 'qualified' with no record of WHY, under WHAT ruleset, or from WHAT
-- evidence — so when the qualification logic improved (entity-type
-- classifier, AI-knowledge size tier), 17 real mega-cap/industrial-zone
-- rows already sitting as 'qualified' stayed silently wrong, because
-- qualifyCandidate()'s duplicate check short-circuits before any logic
-- ever re-runs against an existing row. This migration adds the provenance
-- fields needed to (a) know why a decision was made and (b) detect when a
-- decision was made under a now-superseded ruleset.
--
-- Deliberately NOT storing raw search snippet text — company_registry was
-- never the evidence store (discovery_query/discovery_source already
-- record WHICH query/tier found a candidate; the ephemeral snippet text
-- itself lives only in the discovery run's in-memory CompanyMatch, never
-- persisted anywhere). Re-audit of sector/ICP fit therefore still needs
-- fresh evidence — see lib/enrichment/company-reaudit.ts's own header for
-- what this DOES and does NOT let a re-audit re-check.
-- ============================================================

ALTER TABLE company_registry
  ADD COLUMN IF NOT EXISTS qualification_version    TEXT,
  ADD COLUMN IF NOT EXISTS qualification_reason      TEXT,
  ADD COLUMN IF NOT EXISTS qualification_confidence  TEXT CHECK (qualification_confidence IS NULL OR qualification_confidence IN ('QUALIFIED', 'REVIEW', 'REJECTED')),
  ADD COLUMN IF NOT EXISTS qualification_score       INTEGER,
  ADD COLUMN IF NOT EXISTS entity_type               TEXT,
  ADD COLUMN IF NOT EXISTS entity_confidence         TEXT CHECK (entity_confidence IS NULL OR entity_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS size_classification       TEXT CHECK (size_classification IS NULL OR size_classification IN ('within_range', 'too_large', 'too_small', 'unknown')),
  ADD COLUMN IF NOT EXISTS size_confidence           TEXT CHECK (size_confidence IS NULL OR size_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS size_evidence_source       TEXT CHECK (size_evidence_source IS NULL OR size_evidence_source IN ('snippets', 'homepage', 'knowledge', 'none')),
  ADD COLUMN IF NOT EXISTS icp_fit                    TEXT CHECK (icp_fit IS NULL OR icp_fit IN ('match', 'no_evidence', 'no_match')),
  ADD COLUMN IF NOT EXISTS icp_confidence             TEXT CHECK (icp_confidence IS NULL OR icp_confidence IN ('confirmed', 'unconfirmed'));

COMMENT ON COLUMN company_registry.qualification_version   IS 'Which qualifyCandidate() ruleset version produced the current status — see lib/enrichment/company-qualification.ts''s CURRENT_QUALIFICATION_VERSION. NULL means the row predates this migration/versioning (treated as stale).';
COMMENT ON COLUMN company_registry.qualification_reason     IS 'Human-readable explanation of the qualify/disqualify decision (score reasons or the specific gate that rejected it) — supplements, does not replace, the terse rejection_reason enum.';
COMMENT ON COLUMN company_registry.qualification_confidence IS 'discovery-confidence.ts''s QUALIFICATION_VERDICT tri-state (QUALIFIED/REVIEW/REJECTED) — finer-grained than status, which stays a binary qualified/disqualified for backward compatibility with every existing status-based query.';
COMMENT ON COLUMN company_registry.qualification_score      IS 'discovery-confidence.ts''s 0-100 score — diagnostic only, never itself gates status.';
COMMENT ON COLUMN company_registry.entity_type              IS 'entity-classification.ts''s classifyEntityType() result at decision time.';
COMMENT ON COLUMN company_registry.size_classification      IS 'company-size.ts''s SizeVerdict at decision time.';
COMMENT ON COLUMN company_registry.size_evidence_source     IS 'Which tier resolved the size verdict: snippets (explicit figure in search text) / homepage (explicit figure on the company''s own site) / knowledge (AI direct-knowledge, no explicit figure found) / none (stayed unknown).';
COMMENT ON COLUMN company_registry.icp_fit                  IS 'Sector-signal match result at decision time: match / no_evidence (no snippet text to judge) / no_match.';

CREATE INDEX IF NOT EXISTS idx_company_registry_qualification_version
  ON company_registry (qualification_version);

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'company_registry'
  AND (column_name LIKE 'qualification_%' OR column_name LIKE 'entity_%' OR column_name LIKE 'size_%' OR column_name LIKE 'icp_%')
ORDER BY ordinal_position;
