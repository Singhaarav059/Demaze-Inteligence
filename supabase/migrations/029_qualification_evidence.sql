-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 029 — Qualification evidence (sector/domain)
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Closes the evidence-persistence gap migration 028's own header flagged:
-- company_registry recorded WHY a decision was made (qualification_reason)
-- and WHAT the size verdict was (size_evidence), but never the sector/ICP-
-- fit evidence (which snippet, which signal words matched) or the domain-
-- confirmation evidence (confidence tier, source URLs) that
-- qualifyCandidate() already computes on every call and previously
-- discarded. Without this, a re-audit could not re-verify sector/ICP fit
-- and was permanently capped at REVIEW — see
-- lib/enrichment/company-reaudit.ts.
--
-- Two columns, not four — sector-signal matching IS the ICP-fit check at
-- this qualification stage (there is no broader ICP criterion here; that's
-- a separate, post-research module, lib/enrichment/icp-generator.ts), and
-- geography is not currently evidenced anywhere in qualifyCandidate() (no
-- code path resolves/verifies a candidate's country), so a geography_evidence
-- column would sit permanently NULL — not added, per "do not invent
-- evidence retroactively." See lib/companies/identity.ts's SectorEvidence/
-- DomainEvidence for the exact shape.
-- ============================================================

ALTER TABLE company_registry
  ADD COLUMN IF NOT EXISTS sector_evidence JSONB,
  ADD COLUMN IF NOT EXISTS domain_evidence JSONB;

COMMENT ON COLUMN company_registry.sector_evidence IS 'SectorEvidence (lib/companies/identity.ts) — {sector, matched, matchedSignals, query, snippet}. Doubles as ICP-fit evidence (see column header note). NULL for rows qualified before migration 029 or rejected before the sector check ran.';
COMMENT ON COLUMN company_registry.domain_evidence  IS 'DomainEvidence (lib/companies/identity.ts) — {domain, confidence, sourceUrls}. NULL when no domain was confirmed for this candidate.';

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'company_registry'
  AND column_name IN ('sector_evidence', 'domain_evidence')
ORDER BY ordinal_position;
