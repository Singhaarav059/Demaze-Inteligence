-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 018 — Outbound Warm-Up Engine (real, not simulated)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- 009_outbound_warmup.sql's outbound_warmup_mailboxes was mock-only — a
-- mailbox was just a typed address string with no credential, and
-- outbound_warmup_metrics was populated from a fake elapsed-time curve
-- (lib/outbound/warmup/providers/mock.ts), never a real send. This
-- migration adds what's needed for a genuinely real DIY warmup engine
-- (2026-08-04): multiple simultaneously-connected Gmail accounts (a pool,
-- not a single active provider like every other outbound capability) that
-- actually email, open, spam-rescue, and reply to each other.
--
-- credential_encrypted is nullable so existing manually-typed mailboxes
-- (no OAuth) keep working exactly as before — mock display only, same as
-- today. Only rows with a real credential participate in the engine.
--
-- No RLS, matching every other table in this schema.
-- ============================================================

ALTER TABLE outbound_warmup_mailboxes
  ADD COLUMN IF NOT EXISTS credential_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS oauth_connected_at   TIMESTAMPTZ;

COMMENT ON COLUMN outbound_warmup_mailboxes.credential_encrypted IS 'AES-256-GCM ciphertext of {clientId,clientSecret,refreshToken,email} (lib/outbound/settings/credential-crypto.ts, same encryption every other vendor credential in this app uses) — gmail.modify scoped, a SEPARATE OAuth grant from the sending capability''s outbound_integrations row. NULL means this row is a manually-typed mailbox_address with no real engine participation (mock display only, unchanged from before this migration).';
COMMENT ON COLUMN outbound_warmup_mailboxes.oauth_connected_at IS 'When this mailbox last completed the warmup OAuth flow. Display only — started_at (already existed) still drives ramp math, and is preserved (not reset) on a reconnect.';

CREATE TABLE IF NOT EXISTS outbound_warmup_exchanges (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_mailbox_id         UUID        NOT NULL REFERENCES outbound_warmup_mailboxes(id) ON DELETE CASCADE,
  to_mailbox_id           UUID        NOT NULL REFERENCES outbound_warmup_mailboxes(id) ON DELETE CASCADE,
  gmail_message_id        TEXT        NOT NULL,
  gmail_thread_id         TEXT        NOT NULL,
  subject                 TEXT        NOT NULL,
  sent_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  process_after           TIMESTAMPTZ NOT NULL,
  processed_at            TIMESTAMPTZ,
  status                  TEXT        NOT NULL DEFAULT 'sent'
                             CHECK (status IN ('sent', 'processed', 'failed')),
  landed_in_spam          BOOLEAN,
  rescued_from_spam       BOOLEAN     NOT NULL DEFAULT false,
  replied                 BOOLEAN     NOT NULL DEFAULT false,
  reply_gmail_message_id  TEXT,
  error                   TEXT
);

COMMENT ON TABLE outbound_warmup_exchanges IS 'One row per warmup email sent between two pool mailboxes. Recipient-side processing (spam check, rescue, mark-read, probabilistic reply) happens on a LATER tick, at/after process_after — this delay is what makes the engagement look organic instead of instant. landed_in_spam/rescued_from_spam/replied stay at their defaults until status flips to processed or failed.';
COMMENT ON COLUMN outbound_warmup_exchanges.process_after IS 'Randomized delay target (lib/outbound/warmup/engine/tick-logic.ts computeProcessDelayMs) — the tick engine will not touch this row before this time.';
COMMENT ON COLUMN outbound_warmup_exchanges.landed_in_spam IS 'NULL until the recipient-side check actually runs (status still sent, or search hasn''t found the message yet).';

CREATE INDEX IF NOT EXISTS idx_outbound_warmup_exchanges_due
  ON outbound_warmup_exchanges(process_after) WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_outbound_warmup_exchanges_from_sent
  ON outbound_warmup_exchanges(from_mailbox_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_warmup_exchanges_pair_recent
  ON outbound_warmup_exchanges(from_mailbox_id, to_mailbox_id, sent_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'outbound_warmup_mailboxes'
  AND column_name IN ('credential_encrypted', 'oauth_connected_at');

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_warmup_exchanges';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'outbound_warmup_exchanges'
ORDER BY ordinal_position;
