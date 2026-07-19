-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 009 — Outbound Warm-Up
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Mock-only today (provider_name always 'mock' until Smartlead/Instantly
-- are added). outbound_warmup_metrics accumulates a snapshot each time
-- the metrics endpoint is called (this app has no background scheduler),
-- so the health-monitoring trend fills in as the dashboard is viewed over
-- time rather than via a cron job.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_warmup_mailboxes (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_address   TEXT        NOT NULL UNIQUE,
  provider_name     TEXT        NOT NULL DEFAULT 'mock',
  status            TEXT        NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('not_started', 'warming', 'warmed', 'paused')),
  started_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_warmup_mailboxes IS 'One row per sending mailbox under warm-up. started_at feeds the provider''s elapsed-time-based status calculation.';

CREATE TABLE IF NOT EXISTS outbound_warmup_metrics (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id            UUID        NOT NULL REFERENCES outbound_warmup_mailboxes(id) ON DELETE CASCADE,
  emails_sent_total     INTEGER     NOT NULL DEFAULT 0,
  inbox_rate            NUMERIC     NOT NULL,
  spam_rate             NUMERIC     NOT NULL,
  domain_health_score   INTEGER     NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_warmup_metrics IS 'Time-series snapshots of warm-up health per mailbox, for the Health Monitoring trend view.';

CREATE INDEX IF NOT EXISTS idx_outbound_warmup_metrics_mailbox
  ON outbound_warmup_metrics(mailbox_id, recorded_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('outbound_warmup_mailboxes', 'outbound_warmup_metrics')
ORDER BY table_name;
