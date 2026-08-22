-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 026 — allow 'unsubscribed' as an outbound_campaign_events type
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Adds a real, working unsubscribe mechanism (production-hardening pass,
-- deliverability findings): every sent email now carries a List-Unsubscribe
-- header pointing at GET/POST /api/unsubscribe/[campaignContactId], which
-- writes to outbound_suppression_list (already supports reason
-- 'unsubscribed', no schema change needed there) AND logs an event here.
-- The suppression write is the load-bearing action and works with or
-- without this migration (a CHECK-constraint failure on the event insert
-- is caught and logged, never blocks the suppression write) — this
-- migration only unlocks the event-log entry showing up in campaign
-- history/analytics.
-- ============================================================

-- Builds on migration 024's full list (not the original 008 list — 024
-- already added followup_stopped/send_failed/suppressed/removed/
-- send_ambiguous; overwriting with only 008's shorter list would silently
-- regress those).
ALTER TABLE outbound_campaign_events DROP CONSTRAINT IF EXISTS outbound_campaign_events_event_type_check;
ALTER TABLE outbound_campaign_events ADD CONSTRAINT outbound_campaign_events_event_type_check
  CHECK (event_type IN (
    'sent', 'opened', 'clicked', 'replied', 'bounced', 'paused', 'resumed',
    'followup_scheduled', 'followup_stopped', 'send_failed', 'suppressed', 'removed',
    'send_ambiguous', 'unsubscribed'
  ));

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'outbound_campaign_events_event_type_check';
