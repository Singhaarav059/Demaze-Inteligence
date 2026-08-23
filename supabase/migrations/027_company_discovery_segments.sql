-- ============================================================
-- company_discovery_segments — persisted "target market" searches
-- ============================================================
-- Replaces the client-only localStorage recent-searches list on
-- /admin/company-discovery. A row is created automatically after every
-- successful search (no explicit "Save" action). `companies` is a snapshot
-- of the search results at save time (name/domain + firmographics) —
-- progress ("X of Y researched") is computed against this snapshot only,
-- by matching against pipeline_test_runs, never by re-querying Explee.
-- No RLS — this app has no per-user auth model beyond the shared
-- ADMIN_SECRET, consistent with every other admin table.
-- ============================================================

create table if not exists public.company_discovery_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sector text not null,
  filters jsonb not null default '{}'::jsonb,
  companies jsonb not null default '[]'::jsonb,
  total_found integer not null default 0,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now()
);

create index if not exists company_discovery_segments_last_viewed_idx
  on public.company_discovery_segments (last_viewed_at desc);

comment on table public.company_discovery_segments is
  'A saved company-discovery search (target market definition) with a snapshot of its matched companies, so the Home dashboard can show real research progress against it.';
