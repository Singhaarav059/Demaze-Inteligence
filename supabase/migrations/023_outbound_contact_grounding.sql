-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 023 — Persist decision-maker grounding through to send review
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Production Hardening Master Plan, Phase 5, Step 5.4 (company identity
-- check). lib/outbound/decision-maker-discovery/grounding.ts already tags
-- every discovered candidate 'confirmed' / 'conflict' / 'not_found' against
-- the company's own scraped leadership content, but that flag was previously
-- computed only at discovery time and shown as a badge in
-- DecisionMakerFinder.tsx — it was NEVER persisted onto the resulting
-- outbound_contacts row, so by the time a contact reached Review & Send
-- (the actual send gate), the grounding signal no longer existed anywhere.
-- These two columns close that gap, mirroring discovery_confidence/
-- discovery_provider (migration 010) exactly.
-- ============================================================

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS discovery_grounding_status TEXT
    CHECK (discovery_grounding_status IN ('confirmed', 'conflict', 'not_found'));

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS discovery_grounding_reason TEXT;

COMMENT ON COLUMN outbound_contacts.discovery_grounding_status IS 'Website-grounding result at the time this candidate was added (see lib/outbound/decision-maker-discovery/grounding.ts). ''confirmed'' = name+title matched the company''s own scraped leadership content. ''conflict'' = name matched but title differs. ''not_found'' = not present in the company''s own scraped content at all. NULL for manual contacts or contacts added before this column existed.';
COMMENT ON COLUMN outbound_contacts.discovery_grounding_reason IS 'Human-readable reason accompanying discovery_grounding_status. NULL when discovery_grounding_status is NULL.';

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Should return 2 rows (discovery_grounding_status, discovery_grounding_reason)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'outbound_contacts' AND column_name LIKE 'discovery_grounding_%';
