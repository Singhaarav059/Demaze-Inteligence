-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 011 — Remove Email Validation capability
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Email Validation never had a real vendor wired up (mock-only, seeded
-- active by migration 005) and the user explicitly decided (2026-07-19)
-- not to pursue one — no NeverBounce/MillionVerifier decision was made,
-- and mock data isn't wanted either. Removed outright rather than left on
-- mock: lib/outbound/email-validation/ (whole module), its API route, and
-- all UI wiring were deleted in the same session. This migration removes
-- the corresponding capability row and tightens the CHECK constraint to
-- match — 'email_validation' is no longer a valid outbound_integrations
-- capability value.
--
-- outbound_contacts.validation_* columns (validation_status/score/reason/
-- provider, added by migration 006) are deliberately left in place —
-- dropping columns on a live table is a harder-to-reverse operation than
-- this cleanup needs, and every row's validation_status already defaults
-- to 'pending'/NULL, so leaving them is inert, not misleading.
-- ============================================================

DELETE FROM outbound_integrations WHERE capability = 'email_validation';

ALTER TABLE outbound_integrations
  DROP CONSTRAINT IF EXISTS outbound_integrations_capability_check;

ALTER TABLE outbound_integrations
  ADD CONSTRAINT outbound_integrations_capability_check
  CHECK (capability IN ('decision_maker_discovery', 'email_finder', 'enrichment', 'sending', 'warmup'));

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Should return 0 rows
SELECT capability, provider_name FROM outbound_integrations WHERE capability = 'email_validation';

-- Should return 5 rows (one per remaining capability), none 'email_validation'
SELECT capability, provider_name, is_active FROM outbound_integrations ORDER BY capability;
