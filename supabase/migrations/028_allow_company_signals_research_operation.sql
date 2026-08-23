-- ============================================================
-- Widen pipeline_test_runs_operation_check to allow
-- 'company_signals_research' (the lightweight Discover-Companies
-- research path, app/api/admin/company-research/route.ts).
-- ============================================================
-- Real bug, discovered live: this operation value has been inserted by
-- company-research/route.ts's persistResult() since that route was built,
-- but the CHECK constraint never allowed it — every insert violated the
-- constraint and was silently rejected (supabase-js resolves {error}
-- rather than throwing on a DB constraint violation, and the calling code
-- never checked .error). Confirmed live: zero 'company_signals_research'
-- rows exist anywhere in pipeline_test_runs despite the feature being used
-- repeatedly. This also silently broke explee-discovery/route.ts's
-- "already researched" annotation, which reads rows filtered on this same
-- operation value.
-- ============================================================

alter table public.pipeline_test_runs drop constraint pipeline_test_runs_operation_check;
alter table public.pipeline_test_runs add constraint pipeline_test_runs_operation_check
  check (operation = any (array['scraper_only'::text, 'analysis'::text, 'full_pipeline'::text, 'company_signals_research'::text]));
