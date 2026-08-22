-- ============================================================
-- Demaze AI Outbound Intelligence Platform
-- Migration 030 — Enable RLS on company_registry
-- ============================================================
-- Run this in: Supabase Dashboard -> SQL Editor -> New Query
--
-- company_registry (migration 026) was the only table in this schema
-- created without RLS enabled — every other table already has RLS ON with
-- zero policies (confirmed via Supabase's own advisor + a direct
-- information_schema check before writing this). Zero policies + RLS
-- enabled means default-deny for the anon/authenticated roles PostgREST
-- uses, while the service-role key (SUPABASE_SERVICE_ROLE_KEY, used by
-- every server-side route via lib/supabase/server.ts's createServerClient())
-- ALWAYS bypasses RLS regardless of policy — so this migration is a pure
-- security tightening with zero effect on legitimate application access.
--
-- Verified before writing this migration, not assumed:
--   - grep across app/**/*.tsx and app/**/*.ts found ZERO callers of
--     lib/supabase/client.ts's createBrowserClient() (the anon-key client)
--     anywhere in the app. Every read/write of company_registry goes
--     through an API route using createServerClient() (service role).
--   - NEXT_PUBLIC_SUPABASE_ANON_KEY is still a public, browser-bundled env
--     var (ships in every deployed page's JS, extractable by anyone) even
--     though nothing in this app currently calls it for this table — that
--     public exposure combined with RLS being off is the actual
--     vulnerability: an arbitrary client could hit Supabase's REST API
--     directly with the anon key and read/write every company_registry row,
--     bypassing this app's own admin auth entirely.
--
-- No policies added (same as every other table in this schema) — nothing
-- needs anon/authenticated-role access to this table today. If a future
-- feature needs client-side (anon-key) reads, add a scoped SELECT policy
-- then, not now.
--
-- Reversible: `ALTER TABLE company_registry DISABLE ROW LEVEL SECURITY;`
-- restores the exact prior (insecure) state.
-- ============================================================

ALTER TABLE company_registry ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================

SELECT relrowsecurity FROM pg_class WHERE relname = 'company_registry';
