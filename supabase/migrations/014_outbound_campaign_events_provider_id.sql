-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 014 — outbound_campaign_events.provider_event_id
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Needed for app/api/webhooks/lemlist/route.ts: Lemlist retries failed
-- webhook deliveries, so the receiver needs to dedupe by the provider's own
-- event id rather than trusting "we only got this once". Nullable + a
-- partial unique index (not a plain UNIQUE column) because most existing
-- event rows (from the mock sending provider, pause/resume actions) have no
-- provider-side event id at all and shouldn't collide with each other.
-- No RLS, matching every other table in this schema.
-- ============================================================

ALTER TABLE outbound_campaign_events
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_campaign_events_provider_event_id
  ON outbound_campaign_events(provider_event_id)
  WHERE provider_event_id IS NOT NULL;

COMMENT ON COLUMN outbound_campaign_events.provider_event_id IS
  'Vendor-side event id (e.g. Lemlist webhook payload id), used to dedupe retried webhook deliveries. NULL for app-generated events (sent, paused, resumed).';

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'outbound_campaign_events'
  AND column_name = 'provider_event_id';
