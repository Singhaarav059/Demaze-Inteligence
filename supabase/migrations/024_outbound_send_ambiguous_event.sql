-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 024 — outbound_campaign_events gains 'send_ambiguous'
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Post-Hardening Pilot Readiness Plan, Phase A (send-path concurrency
-- hardening), Step A4. A Gmail send can throw/time out AFTER the request
-- reached Google's servers — the local code has no way to tell "Gmail
-- never got it" apart from "Gmail sent it, we just didn't hear back." The
-- send/follow-up routes used to blindly reset such a contact back to
-- 'queued' (retry-eligible), which risks a real duplicate email being sent
-- on the next attempt. They now leave the row claimed (not retryable) and
-- write a 'send_ambiguous' event instead, so the outcome is visible for
-- manual review rather than silently risking a duplicate send.
-- ============================================================

ALTER TABLE outbound_campaign_events DROP CONSTRAINT IF EXISTS outbound_campaign_events_event_type_check;
ALTER TABLE outbound_campaign_events ADD CONSTRAINT outbound_campaign_events_event_type_check
  CHECK (event_type IN (
    'sent', 'opened', 'clicked', 'replied', 'bounced', 'paused', 'resumed',
    'followup_scheduled', 'followup_stopped', 'send_failed', 'suppressed', 'removed',
    'send_ambiguous'
  ));

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'outbound_campaign_events_event_type_check';
