-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 020 — Campaign Settings (daily limit, send window, per-campaign
-- follow-up cadence override) + new campaign_events types
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Part 1: outbound_campaigns gains real, per-campaign send-safety and
-- cadence settings. Every new column is nullable (or defaulted to the most
-- permissive value) so an existing campaign behaves EXACTLY as it does
-- today until someone explicitly sets it — same fail-safe-default
-- discipline as outbound_followup_settings (migration 016) and
-- lib/outbound/settings/provider-selection.ts:
--   - daily_send_limit  NULL = unlimited (current behavior)
--   - send_window_start/end NULL = no restriction (current behavior)
--   - timezone defaults to 'UTC' (harmless when the window itself is unset)
--   - interval_1/2/3_days NULL = fall back to the existing global
--     outbound_followup_settings singleton (current behavior) — see
--     lib/outbound/sending/followup-settings.ts's campaignId-aware
--     getFollowupIntervals()
--
-- Part 2: outbound_campaign_events.event_type gains 'send_failed',
-- 'suppressed', and 'removed' — a failed or suppressed send attempt
-- currently updates outbound_campaign_contacts.status but writes NO event
-- row at all, so the per-contact timeline has nothing to show for it. This
-- makes those outcomes as visible as every other event type already is.
-- 'removed' covers Review & Send's new "Remove from campaign" action.
--
-- No RLS, matching every other table in this schema.
-- ============================================================

ALTER TABLE outbound_campaigns
  ADD COLUMN IF NOT EXISTS daily_send_limit  INTEGER     CHECK (daily_send_limit IS NULL OR daily_send_limit > 0),
  ADD COLUMN IF NOT EXISTS send_window_start SMALLINT    CHECK (send_window_start BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS send_window_end   SMALLINT    CHECK (send_window_end BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS timezone          TEXT        NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS interval_1_days   INTEGER     CHECK (interval_1_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS interval_2_days   INTEGER     CHECK (interval_2_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS interval_3_days   INTEGER     CHECK (interval_3_days BETWEEN 1 AND 365);

COMMENT ON COLUMN outbound_campaigns.daily_send_limit IS 'Max sends per calendar day in this campaign''s own timezone. NULL = unlimited.';
COMMENT ON COLUMN outbound_campaigns.send_window_start IS 'Hour (0-23, campaign timezone) sends may start. NULL (with send_window_end) = no restriction.';
COMMENT ON COLUMN outbound_campaigns.send_window_end IS 'Hour (0-23, campaign timezone) sends must stop by. Wraps past midnight if less than send_window_start.';
COMMENT ON COLUMN outbound_campaigns.interval_1_days IS 'Per-campaign follow-up cadence override (step 1 of 3). NULL on any of the three = fall back to the global outbound_followup_settings singleton.';

ALTER TABLE outbound_campaign_events DROP CONSTRAINT IF EXISTS outbound_campaign_events_event_type_check;
ALTER TABLE outbound_campaign_events ADD CONSTRAINT outbound_campaign_events_event_type_check
  CHECK (event_type IN (
    'sent', 'opened', 'clicked', 'replied', 'bounced', 'paused', 'resumed',
    'followup_scheduled', 'followup_stopped', 'send_failed', 'suppressed', 'removed'
  ));

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'outbound_campaigns'
  AND column_name IN ('daily_send_limit', 'send_window_start', 'send_window_end', 'timezone', 'interval_1_days', 'interval_2_days', 'interval_3_days')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'outbound_campaign_events_event_type_check';
