-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 007 — Outbound Generated Content (subject lines, email, follow-ups)
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New Query
--
-- One row per contact's generated outreach content. Generation uses the
-- existing AI provider chain (lib/ai/provider-factory.ts), not a new
-- vendor — there is no provider selection for this table.
-- No RLS, matching every other table in this schema.
-- ============================================================

CREATE TABLE IF NOT EXISTS outbound_generated_content (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID        NOT NULL REFERENCES outbound_contacts(id) ON DELETE CASCADE,
  source_run_id         UUID        REFERENCES pipeline_test_runs(id) ON DELETE SET NULL,
  subject_lines         JSONB,
  selected_subject_line TEXT,
  email_draft           JSONB,
  followups             JSONB,
  ai_provider_used      TEXT,
  ai_model_used         TEXT,
  status                TEXT        NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved', 'sent')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE outbound_generated_content IS 'Generated subject lines / cold email / follow-up sequence per contact. One row per contact (upserted on regenerate).';
COMMENT ON COLUMN outbound_generated_content.subject_lines IS 'string[] of up to 5 generated subject lines.';
COMMENT ON COLUMN outbound_generated_content.email_draft IS 'Sectioned draft: { hook, personalization, painPoint, valueProp, cta, signature, fullText }.';
COMMENT ON COLUMN outbound_generated_content.followups IS 'Array of up to 3: { sequence, angle, urgency, subject, body }.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_generated_content_contact ON outbound_generated_content(contact_id);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'outbound_generated_content';
