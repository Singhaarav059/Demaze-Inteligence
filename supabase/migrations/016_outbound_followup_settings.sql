-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 016 — Follow-Up Cadence Settings + a 'followup_stopped' event
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Part 1: outbound_followup_settings — a single admin-editable row (the
-- "Follow-up Control Panel" session's cadence editor) replacing the
-- previously-hardcoded FOLLOWUP_INTERVALS_DAYS = [3, 4, 7] constant in
-- lib/outbound/sending/followup-schedule.ts. Singleton pattern (id=1,
-- enforced by the CHECK constraint) — there is exactly one cadence for the
-- whole app, not per-campaign or per-contact. If this table is empty or
-- unreachable, lib/outbound/sending/followup-settings.ts falls back to the
-- original [3, 4, 7] default, so this migration is safe to apply late.
--
-- Part 2: outbound_campaign_events.event_type gains 'followup_stopped', for
-- the panel's "Stop Remaining Follow-ups" per-contact action — none of the
-- existing event types ('sent'/'opened'/'clicked'/'replied'/'bounced'/
-- 'paused'/'resumed'/'followup_scheduled') describe "an admin manually
-- cancelled this contact's remaining sequence," and reusing 'paused' would
-- be misleading (that's a whole-campaign action, this is per-contact).
--
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_followup_settings (
  id                INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  interval_1_days   INTEGER     NOT NULL DEFAULT 3 CHECK (interval_1_days BETWEEN 1 AND 365),
  interval_2_days   INTEGER     NOT NULL DEFAULT 4 CHECK (interval_2_days BETWEEN 1 AND 365),
  interval_3_days   INTEGER     NOT NULL DEFAULT 7 CHECK (interval_3_days BETWEEN 1 AND 365),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_followup_settings IS 'Singleton (id=1) admin-editable follow-up cadence, replacing the old hardcoded [3,4,7]-day FOLLOWUP_INTERVALS_DAYS constant.';

INSERT INTO outbound_followup_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE outbound_campaign_events DROP CONSTRAINT IF EXISTS outbound_campaign_events_event_type_check;
ALTER TABLE outbound_campaign_events ADD CONSTRAINT outbound_campaign_events_event_type_check
  CHECK (event_type IN ('sent', 'opened', 'clicked', 'replied', 'bounced', 'paused', 'resumed', 'followup_scheduled', 'followup_stopped'));

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_followup_settings';

SELECT * FROM outbound_followup_settings;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'outbound_campaign_events_event_type_check';
