-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 008 — Outbound Campaigns (sending)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- Mock-only today: sender_provider is always 'mock' until a real vendor
-- (Smartlead/Instantly) is added via lib/outbound/sending/provider-factory.ts.
-- No real email is ever sent by this table's existence — see CLAUDE.md's
-- "Outbound Workflow Modules" section for the standing rule that a real
-- send still requires explicit per-batch confirmation once a real
-- provider exists.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_campaigns (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  source_run_id     UUID        REFERENCES pipeline_test_runs(id) ON DELETE SET NULL,
  status            TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  sender_provider   TEXT        NOT NULL DEFAULT 'mock',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_campaigns IS 'One outreach campaign. status is app-managed via pause/resume/send actions, not a raw vendor mirror.';

CREATE TABLE IF NOT EXISTS outbound_campaign_contacts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID        NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  contact_id            UUID        NOT NULL REFERENCES outbound_contacts(id) ON DELETE CASCADE,
  generated_content_id  UUID        REFERENCES outbound_generated_content(id) ON DELETE SET NULL,
  status                TEXT        NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'sent', 'followup_1', 'followup_2', 'followup_3', 'replied', 'bounced', 'stopped')),
  provider_message_id   TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_campaign_contacts IS 'One row per contact enqueued into a campaign. generated_content_id links to the subject/email/followups that were actually sent.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_unique
  ON outbound_campaign_contacts(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_outbound_campaign_contacts_campaign
  ON outbound_campaign_contacts(campaign_id);

CREATE TABLE IF NOT EXISTS outbound_campaign_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID        NOT NULL REFERENCES outbound_campaigns(id) ON DELETE CASCADE,
  campaign_contact_id   UUID        REFERENCES outbound_campaign_contacts(id) ON DELETE CASCADE,
  event_type            TEXT        NOT NULL
                          CHECK (event_type IN ('sent', 'opened', 'clicked', 'replied', 'bounced', 'paused', 'resumed', 'followup_scheduled')),
  detail                JSONB       NOT NULL DEFAULT '{}',
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_campaign_events IS 'Event timeline per campaign/contact. detail holds provider-specific extras (providerMessageId, error, etc).';

CREATE INDEX IF NOT EXISTS idx_outbound_campaign_events_campaign
  ON outbound_campaign_events(campaign_id, occurred_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('outbound_campaigns', 'outbound_campaign_contacts', 'outbound_campaign_events')
ORDER BY table_name;
