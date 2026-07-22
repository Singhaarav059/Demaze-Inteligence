-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 013 — Prospeo shared-response cache on outbound_contacts
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Email Finder and Contact Enrichment both call Prospeo's enrich-person
-- endpoint for the same contact, at different times, via two independent
-- API routes (/find-email, /enrich) — each triggered by a separate UI
-- button. Historically each route made its own Prospeo call even when the
-- other route already had a response containing the data it needed (the
-- enrich-person endpoint returns person+company+email fields regardless of
-- which request shape triggered it).
--
-- prospeo_raw stores the last raw enrich-person response for this contact.
-- When one route (find-email or enrich) needs data, it checks prospeo_raw
-- first — a cache hit costs zero Prospeo credits. A cache miss makes one
-- call and populates BOTH email_* and enrichment_* columns from that single
-- response, so the second action (whichever route runs next) becomes a
-- cache hit instead of a second paid call. See
-- lib/outbound/shared/prospeo-contact-cache.ts for the orchestration.
-- ============================================================

ALTER TABLE outbound_contacts
  ADD COLUMN IF NOT EXISTS prospeo_raw JSONB,
  ADD COLUMN IF NOT EXISTS prospeo_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN outbound_contacts.prospeo_raw IS 'Last raw Prospeo enrich-person response ({ person, company }) for this contact — shared between the Email Finder and Contact Enrichment routes so a match found by one is reused by the other instead of re-fetched.';
COMMENT ON COLUMN outbound_contacts.prospeo_fetched_at IS 'When prospeo_raw was fetched — used the same way scraped_at/cached_at are elsewhere in this schema, no fixed TTL applied yet (a stale-but-present cache entry is still cheaper and more accurate than re-guessing).';

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'outbound_contacts' AND column_name IN ('prospeo_raw', 'prospeo_fetched_at');
