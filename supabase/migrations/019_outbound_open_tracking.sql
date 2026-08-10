-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 019 — Outbound Open Tracking
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- opened_at is a single first-open timestamp per contact, not a per-event
-- log ("first write wins" — app/api/track/open/[campaignContactId]/route.ts
-- only ever sets it via `WHERE opened_at IS NULL`, never overwrites it).
-- This is what the automatic follow-up engine's "unopened past N days" gate
-- needs and what one column can express; a fuller open-event history can
-- already be reconstructed later from outbound_campaign_events rows (the
-- 'opened' event_type has existed in the CHECK constraint since migration
-- 008 — this migration is the first thing that actually inserts one).
--
-- No RLS, matching every other table in this schema.
-- ============================================================

ALTER TABLE outbound_campaign_contacts
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN outbound_campaign_contacts.opened_at IS 'Set once, on first confirmed open (tracking-pixel hit), never overwritten. NULL means never confirmed opened — this is the signal the automatic follow-up engine gates on (lib/outbound/sending/followup-engine/tick-logic.ts).';

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_opened_at
  ON outbound_campaign_contacts(opened_at) WHERE opened_at IS NOT NULL;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'outbound_campaign_contacts'
  AND column_name = 'opened_at';

SELECT indexname
FROM pg_indexes
WHERE tablename = 'outbound_campaign_contacts'
  AND indexname = 'idx_outbound_campaign_contacts_opened_at';
