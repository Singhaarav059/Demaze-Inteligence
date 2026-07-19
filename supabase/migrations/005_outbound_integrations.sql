-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 005 — Outbound Integrations (settings + encrypted credentials)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- One row per (capability, provider_name) pair. Exactly one row per
-- capability has is_active = true at a time (enforced by the partial
-- unique index below) — that's the provider currently in effect for
-- that capability. credential_encrypted is AES-256-GCM ciphertext (see
-- lib/outbound/settings/credential-crypto.ts) — plaintext keys are never
-- stored. No RLS: this project gates all access at the API-route layer
-- via verifyAdminRequest, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_integrations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  capability            TEXT        NOT NULL
                          CHECK (capability IN ('email_finder', 'email_validation', 'enrichment', 'sending', 'warmup')),
  provider_name         TEXT        NOT NULL,
  display_name          TEXT        NOT NULL,
  is_enabled            BOOLEAN     NOT NULL DEFAULT false,
  is_active             BOOLEAN     NOT NULL DEFAULT false,
  credential_encrypted  TEXT,
  credential_last_four  TEXT,
  config                JSONB       NOT NULL DEFAULT '{}',
  last_tested_at        TIMESTAMPTZ,
  last_test_status      TEXT        NOT NULL DEFAULT 'untested'
                          CHECK (last_test_status IN ('success', 'failure', 'untested')),
  last_test_message     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_integrations IS 'Provider config + encrypted credentials for the outbound workflow (email finder/validation/enrichment/sending/warmup). Exactly one active provider per capability.';
COMMENT ON COLUMN outbound_integrations.capability IS 'Which outbound capability this row configures.';
COMMENT ON COLUMN outbound_integrations.is_enabled IS 'True once a credential has been saved (or provider_name=mock, which needs none).';
COMMENT ON COLUMN outbound_integrations.is_active IS 'The provider actually used for this capability right now. Enforced unique per capability by idx_outbound_integrations_capability_active.';
COMMENT ON COLUMN outbound_integrations.credential_encrypted IS 'AES-256-GCM ciphertext, base64(iv[12] + authTag[16] + ciphertext) — see lib/outbound/settings/credential-crypto.ts. NULL for provider_name=mock.';
COMMENT ON COLUMN outbound_integrations.credential_last_four IS 'Last 4 chars of the plaintext key, for display only — never the real value.';
COMMENT ON COLUMN outbound_integrations.config IS 'Provider-specific extra settings (base_url override, rate limits). Shape varies by provider_name.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_integrations_capability_provider
  ON outbound_integrations(capability, provider_name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_integrations_capability_active
  ON outbound_integrations(capability)
  WHERE is_active = true;

-- ============================================================
-- SEED DATA: one active 'mock' row per capability
-- ============================================================

INSERT INTO outbound_integrations (capability, provider_name, display_name, is_enabled, is_active)
VALUES
  ('email_finder',     'mock', 'Mock Email Finder',       true, true),
  ('email_validation', 'mock', 'Mock Email Validation',   true, true),
  ('enrichment',       'mock', 'Mock Contact Enrichment', true, true),
  ('sending',          'mock', 'Mock Email Sender',       true, true),
  ('warmup',           'mock', 'Mock Warm-Up',            true, true)
ON CONFLICT (capability, provider_name) DO NOTHING;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Should return 1 row
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_integrations';

-- Should return 5 rows, one per capability, all provider_name='mock', is_active=true
SELECT capability, provider_name, is_active
FROM outbound_integrations
ORDER BY capability;
