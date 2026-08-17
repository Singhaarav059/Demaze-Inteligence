-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 025 — Pilot review fields on pipeline_test_runs
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- Post-Hardening Pilot Readiness Plan, Phase F2 (human quality review).
-- Every pilot company's researched run needs a human-reviewable
-- approve/reject/needs-work decision before it can proceed to outreach
-- generation (Phase F3) — this is a deliberately temporary validation gate
-- for the pilot only, not a redesign of pipeline_test_runs. Kept as 5
-- additive, nullable columns on the existing table rather than a new one —
-- one company/one run maps to at most one pilot review decision, no
-- separate entity worth its own table for this.
--
-- pilot_icp_segment / pilot_source_list carry through the optional Phase E
-- upload fields (lib/batch/file-parser.ts's icpSegment/sourceListId) so a
-- reviewer can see which pilot batch/segment a company came from — these
-- were previously only held in-memory client-side, never persisted.
-- ============================================================

ALTER TABLE pipeline_test_runs
  ADD COLUMN IF NOT EXISTS pilot_icp_segment text,
  ADD COLUMN IF NOT EXISTS pilot_source_list text,
  ADD COLUMN IF NOT EXISTS pilot_review_status text
    CHECK (pilot_review_status IN ('pending', 'approved', 'rejected', 'needs_work')),
  ADD COLUMN IF NOT EXISTS pilot_review_note text,
  ADD COLUMN IF NOT EXISTS pilot_reviewed_at timestamptz;

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'pipeline_test_runs' AND column_name LIKE 'pilot_%'
ORDER BY column_name;
