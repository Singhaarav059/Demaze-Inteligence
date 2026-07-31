-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 017 — Outbound Suppression List (bounces + unsubscribes, combined)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- One table for "never send to this address again," regardless of WHY —
-- a hard bounce and an unsubscribe request are both the same underlying
-- mechanism (permanently exclude an address from future sends), so this is
-- one table with a `reason` column, not two near-identical tables. See
-- CLAUDE.md-adjacent session notes: this was a deliberate simplification
-- decided before this session started, not something discovered mid-build.
--
-- email is always stored lowercased by lib/outbound/sending/suppression.ts
-- before it ever reaches this table, so a plain (non-expression) unique
-- index on the column works for both lookups AND upsert's ON CONFLICT —
-- PostgREST's upsert can't target an expression index like lower(email),
-- only a real unique constraint/index on an actual column, so normalizing
-- in application code (once, at the one module that touches this table)
-- is simpler than fighting that limitation here.
--
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_suppression_list (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  reason        TEXT        NOT NULL CHECK (reason IN ('bounced', 'unsubscribed', 'manual')),
  detail        TEXT,
  contact_id    UUID        REFERENCES outbound_contacts(id) ON DELETE SET NULL,
  campaign_id   UUID        REFERENCES outbound_campaigns(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_suppression_list IS 'Addresses excluded from all future sends. reason=bounced is set automatically (Gmail bounce detection in check-replies/process-followups); unsubscribed/manual are admin-added via /admin/outbound/suppression.';
COMMENT ON COLUMN outbound_suppression_list.email IS 'Always lowercased before insert by lib/outbound/sending/suppression.ts — this column IS the canonical case-insensitive form, not a display value.';
COMMENT ON COLUMN outbound_suppression_list.detail IS 'Free-text context — e.g. the bounce sender header, or an admin note for a manual/unsubscribed entry.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_suppression_email ON outbound_suppression_list(email);
CREATE INDEX IF NOT EXISTS idx_outbound_suppression_created_at ON outbound_suppression_list(created_at DESC);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_suppression_list';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'outbound_suppression_list'
ORDER BY ordinal_position;
