-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 010 — Decision-Maker Discovery
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Adds the 6th outbound capability, 'decision_maker_discovery' — given a
-- company + target titles (CEO/CTO/VP Operations/Plant Head, etc.), finds
-- candidate decision-makers. Unlike Email Finder/Contact Enrichment (which
-- take a person name as input), this capability DOES discover who to
-- contact — see CLAUDE.md's "Decision-maker auto-discovery — UNBLOCKED
-- 2026-07-18" for the scope decision. Still never touches LinkedIn.
--
-- Discovered candidates are never persisted directly — the user reviews
-- them in the UI and selects which to add, at which point they become a
-- normal outbound_contacts row (same "ephemeral until selected" discipline
-- as Company Discovery Engine's candidate list). This migration only adds
-- provenance columns so a persisted contact can record how it was found.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Widen outbound_integrations.capability to allow the new capability,
--    and seed one active 'mock' row for it (mirrors migration 005).
-- ------------------------------------------------------------

ALTER TABLE outbound_integrations
  DROP CONSTRAINT IF EXISTS outbound_integrations_capability_check;

ALTER TABLE outbound_integrations
  ADD CONSTRAINT outbound_integrations_capability_check
  CHECK (capability IN ('decision_maker_discovery', 'email_finder', 'email_validation', 'enrichment', 'sending', 'warmup'));

INSERT INTO outbound_integrations (capability, provider_name, display_name, is_enabled, is_active)
VALUES
  ('decision_maker_discovery', 'mock', 'Mock Decision-Maker Discovery', true, true)
ON CONFLICT (capability, provider_name) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Provenance columns on outbound_contacts — records whether a contact
--    was typed in manually or surfaced by decision-maker discovery.
-- ------------------------------------------------------------

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (discovery_source IN ('manual', 'decision_maker_discovery'));

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS discovery_confidence TEXT
    CHECK (discovery_confidence IN ('high', 'medium', 'low'));

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS discovery_provider TEXT;

COMMENT ON COLUMN outbound_contacts.discovery_source IS 'How this contact entered the system. ''manual'' = typed in by the user (default, still the primary path). ''decision_maker_discovery'' = surfaced by the Decision-Maker Discovery capability and then explicitly selected by the user — never auto-added.';
COMMENT ON COLUMN outbound_contacts.discovery_confidence IS 'Confidence tier reported by the discovery provider, when discovery_source = ''decision_maker_discovery''. NULL for manual contacts.';
COMMENT ON COLUMN outbound_contacts.discovery_provider IS 'Name of the decision-maker discovery provider that surfaced this contact (e.g. ''mock'', ''prospeo''). NULL for manual contacts.';

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Should return 1 row, provider_name='mock', is_active=true
SELECT capability, provider_name, is_active
FROM outbound_integrations
WHERE capability = 'decision_maker_discovery';

-- Should return 3 rows (discovery_source, discovery_confidence, discovery_provider)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'outbound_contacts' AND column_name LIKE 'discovery_%';
