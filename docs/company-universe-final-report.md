# Company Universe — Final Report

Built for `Demaze_Multi_Source_Company_Universe_Claude_Prompt.md`. Follows
that document's own Section 39 report structure (A-L below map directly to
its A-L). Self-contained — written for a reader with no access to this
session.

**Headline fact that shapes everything below**: this session's network
egress policy blocks every one of the 5 target providers' domains
(api.gleif.org, api.opencorporates.com, api.company-information.service.gov.uk,
www.sec.gov/data.sec.gov, api.data.gov.in) — confirmed via direct `curl`
(`CONNECT tunnel failed, response 403`) and `WebFetch`
(`EGRESS_BLOCKED`) before any provider code was written. Every provider was
still built and thoroughly unit-tested against each API's documented
response shape (mocked HTTP throughout — required anyway by Section 32's
"do not make the normal test suite dependent on live providers"), but
**none were exercised against a real live response in this session.** This
is stated once here and repeated in each provider file's own header
comment, so it is never silently forgotten later.

---

## A. Existing architecture (what was found before changing anything)

Per Section 1's explicit instruction to inspect rather than trust
CLAUDE.md: several things CLAUDE.md documents as built do **not** exist in
this actual checkout —

- **No `company_registry` table exists anywhere** — confirmed via a
  repo-wide grep of `supabase/migrations/*.sql` and every `.ts` file.
  `pipeline_test_runs` (migration 002) is the closest real analog to what
  the source prompt calls `company_registry` ("companies actively
  processed by Demaze research"). This build's new `company_universe`
  table is deliberately separate from it, per Section 34's own guidance.
- **No Apollo integration exists in this codebase**, despite CLAUDE.md
  documenting an extensive "BUILT 2026-08-14 — Apollo.io added as a second
  vendor" session (revenue-range filtering, `apolloOrg` fields,
  `lib/enrichment/sources/apollo-client.ts`, etc.). Confirmed via
  `git log --all --oneline | grep -i apollo` (zero results) and a repo-wide
  grep for `isOutsideRevenueRange`/`apolloOrg`/`revenueRangeUsd` (zero
  results). `lib/enrichment/company-discovery.ts`'s real `discoverCompanies()`
  signature is `(icpSegment, excludeCompanyNames?)` — no third
  `revenueRangeUsd` parameter, contradicting CLAUDE.md's own description of
  it. This is a real, material CLAUDE.md/codebase drift, not a small
  detail — noted here rather than silently worked around.
- **No 9-cell company-discovery benchmark exists** — `benchmarks/` holds
  the existing per-company research-quality benchmark
  (`benchmark-runner.ts` + `benchmarks/companies/*.json`), not a
  discovery-quality comparison harness. Section 27's "use the same existing
  9-cell benchmark" assumes something that isn't there; this build creates
  the harness fresh (`benchmarks/company-universe-comparison.ts`) rather
  than reusing a nonexistent one.
- **What DOES already exist and was reused, not duplicated**: the Company
  Discovery Engine (`lib/enrichment/company-discovery.ts`, search-grounded,
  untouched by this build except for one additive post-filter — see F
  below), `website-discovery.ts`'s identity/normalization discipline (the
  pattern this build's own `identity.ts` follows), `lib/rate-limit.ts`
  (reused directly for provider throttling), `lib/logger.ts`, the
  `ReturnType<typeof createServerClient>` Supabase-client-parameter
  convention from `lib/outbound/warmup/engine/run-tick.ts`, and
  `lib/enrichment/sources/edgar-client.ts` (SEC EDGAR — already built in an
  earlier session as a single-company enrichment source; this build reuses
  its ticker map/User-Agent/URL builders directly for a second, discovery-
  oriented purpose rather than re-implementing a second SEC client).

## B. Providers implemented

All 5 named in the source prompt. See `docs/company-universe-sources.md`
for full licensing detail per provider (not repeated here).

| provider | coverage | data | api/bulk | auth | rate limit | refresh |
|---|---|---|---|---|---|---|
| India MCA (via data.gov.in) | India only | CIN, company name/status/class/category, registered state, registration date, principal activity | api.data.gov.in "resource API" (paginated JSON) | api-key query param | 30/min (unconfirmed placeholder) | on-demand search |
| UK Companies House | UK only | Company number, name, status, type, SIC codes, registered address, incorporation date | Live REST API + monthly bulk CSV snapshot | Basic Auth (key as username) | 600/5min (the one number the source prompt states directly) | API for targeted refresh, bulk for base universe |
| GLEIF | Global (LEI-registered entities only) | LEI, legal name, address, entity status, legal form, jurisdiction | Live REST API (JSON:API) + bulk Golden Copy CSV | None required | 30/min (unconfirmed placeholder) | API for search, bulk for large-scale ingestion |
| SEC EDGAR | US-reporting entities only (public companies + some foreign private issuers) | CIK, name, SIC, address, XBRL-derived annual revenue (best-effort tag search) | Ticker-map JSON (bulk, ~10k+ entries, already cached by the existing enrichment client) + submissions/companyfacts APIs | None required | SEC's own soft ~10 req/sec (unchanged from the existing client) | Ticker map re-fetch; per-company submissions/XBRL on demand |
| OpenCorporates | Global (200M+ companies claimed) | Company number, jurisdiction, status, type, incorporation date, industry codes | Live REST API only (no free bulk dataset) | API token | 20/min (unconfirmed placeholder) | On-demand search/lookup only |

## C. Database changes (exact migrations/tables/fields)

One new migration: `supabase/migrations/026_company_universe.sql`. **Not
yet applied to the live Supabase project** — same "user runs the SQL, this
assistant never executes migrations directly" precedent as every other
migration in this repo's history.

Three tables:
1. `company_universe` — canonical, identity-resolved companies. Full field
   list matches Section 8 verbatim (see the migration file's own comments
   for the reasoning behind each). Partial unique indexes on `lei`/`cik`/
   `cin`/`(registration_authority, company_number)`; discovery-query
   indexes on `country_code`/`industry`/`sic_codes` (GIN)/`naics_codes`
   (GIN)/`status`/`employee_count`/`company_type`/`domain`/`canonical_name`.
2. `company_source_records` — raw per-provider provenance, unique on
   `(source_provider, source_record_id)`, `raw_data JSONB` keeps the full
   original record so re-normalization never needs a re-fetch.
3. `company_universe_ingestion_runs` — append-only health/metrics log, one
   row per ingestion run (not per provider, so history is preserved).

No RLS on any of the three — matches every other table in this schema
(this app is server-only via `SUPABASE_SERVICE_ROLE_KEY`, no browser-side
Supabase client anywhere).

## D. Ingestion (initial vs. incremental)

`lib/company-universe/ingestion.ts` implements Section 10's exact pipeline
stage-for-stage: VALIDATE (non-empty canonical name) -> IDENTITY MATCH
(`identity.ts`) -> UPSERT -> PROVENANCE.

- **`runProviderSearch()`** — a live, on-demand `search()` call against one
  provider, every result ingested immediately. Used both for the local-
  first discovery path's "gap fill" and as the only ingestion mode for the
  two providers with no bulk capability (India MCA, OpenCorporates).
- **`runProviderBulkIngest()`** — for GLEIF/Companies House/SEC EDGAR
  (`capabilities.bulkIngest = true`), streams a provider's `bulkIngest()`
  batch-by-batch, ingesting each batch as it arrives and writing the
  provider's own returned checkpoint into `company_universe_ingestion_runs`
  for resumability (Section 10's "record 4,000 of 10,000 fails, don't lose
  the previous 3,999").
- **Re-run safety, live-verified (via tests, not a real run — see the
  Testing section)**: ingesting the identical provider record twice
  resolves back to the same canonical company (via its own deterministic
  identifier, now present from the first run) and upserts (not duplicates)
  the `company_source_records` row.
- **Section 33's "do not run massive live ingestion first"**: fully
  honored, if unintentionally reinforced — this session could not run
  ANY live ingestion at all (network blocked), so no risk of skipping the
  "small controlled pilot" step existed. When network access is
  available, run a small sample (Section 33's own suggested ~10,000
  records per source) through `runProviderSearch`/`runProviderBulkIngest`
  before any larger run, exactly as that section specifies.

## E. Identity resolution (how duplicates across sources are merged)

`lib/company-universe/identity.ts` — the single most safety-critical file
in this build, and the most thoroughly tested (22 dedicated test
assertions). Deterministic identifiers (LEI, CIK, CIN, company number +
registration authority) are checked first and always win; conservative
fuzzy matching (same domain + ≥75% name-word overlap, or exact normalized
name + same country) only fires when no deterministic identifier matched
anything. A single-word name is never fuzzy-matched on its own (mirrors
`website-discovery.ts`'s existing single-word-name guard). When deterministic
identifiers on one incoming record point at two DIFFERENT existing
canonical companies (contradictory source data), the function returns a
`conflict` outcome — the pipeline creates a standalone new record rather
than guessing which existing company to merge into, per Section 12's "never
merge purely because names are similar... every merge should have a
reason/confidence."

Field-level merge precedence (`mergeCanonicalFields`) follows Section 13
directly: national registries win for legal-identity/business-activity
fields, SEC EDGAR wins for financial fields, and a field with no precedence
rule (e.g. `domain`) keeps its first-set value rather than being silently
overwritten by whichever provider happened to run most recently.

## F. Discovery (how Company Discovery now uses structured sources before web search)

`lib/company-universe/discovery.ts`'s `discoverCompaniesStructuredFirst()`
implements Section 14's target architecture: query `company_universe`
locally first; only when local results are sparse (fewer than 5 matches)
does it also call every configured+healthy provider's live `search()`,
ingesting results before returning them (so a repeat query later serves
from cache without spending quota again). An unconfigured or currently-
unhealthy provider is skipped with its specific reason surfaced, per
Section 25's "Demaze should know... rather than silently returning
incomplete discovery" — never silently ignored.

Two new small admin routes (Section 31's "a small admin/status endpoint is
acceptable, no large UI"): `GET /api/admin/company-universe/status`
(per-provider health + last successful sync) and
`POST /api/admin/company-universe/discover` (structured query -> ranked
candidates). Neither replaces the existing
`POST /api/admin/company-discovery` route — both are designed to coexist,
per Section 15's "search enrichment, not the only path."

**One additive integration into the existing route**, not a rewrite: when
a caller passes `employeeCountMax`/`revenueMaxUsd`,
`app/api/admin/company-discovery/route.ts` now also checks
`company_universe` for any surviving candidate's domain and rejects it
deterministically if structured evidence shows it's over-scale — Section
18's "prefer deterministic evidence over LLM inference... do not spend an
LLM call" when authoritative structured data already answers the question.
`lib/enrichment/company-discovery.ts` itself was **not modified** — it
stays Supabase-free per its own established convention; this check lives
at the route layer, additive-only, and a candidate with no
`company_universe` match is completely unaffected (the common case until
this table has real ingested data).

## G. Qualification (how structured evidence feeds size/entity qualification)

`qualifyBySizeStructured()` (`discovery.ts`) implements Section 18's exact
hierarchy for the two tiers this module owns (structured sources) — it
never fabricates a value (Section 17: "uncertain = unknown, never convert
uncertainty into too_large") and only ever returns a definitive `reject`
(clear over-scale evidence) or `insufficient_data` ("nothing here
disqualifies it, continue to the existing snippet/LLM-tier heuristics
unchanged"). No dedicated `company-size.ts` file exists in this codebase
(Section 18 assumed one) — the existing size logic lives inline in
`company-discovery.ts`'s `detectSizeMismatch()`, which was left untouched;
the new structured check runs BEFORE it reaches that fallback, as an
additive earlier-and-cheaper gate, not a replacement.

Entity-type qualification (Section 20 — reject industrial parks/
associations/government programs, don't overgeneralize words like
"cluster"/"group") was **not built as new code** this session — the
existing structural entity classifier this section refers to was not
located as a single, separate module during Section 1's inspection (the
closest match, `classifyCompanyRejection()` in `company-discovery.ts`, is
name-based, not entity-type-based, and was left untouched per "do not
rewrite working discovery code unnecessarily"). Flagged as a real gap, not
silently addressed: a future session should locate or build the dedicated
entity-type classifier Section 20 describes.

## H. Benchmark (structured+search vs. search-only, with exact numbers)

**Not run.** `benchmarks/company-universe-comparison.ts` is built,
type-checked, and ready to run — a real 9-cell (3 sectors x 3 regions)
comparison calling both the existing search-only route and the new
structured-first route, computing every metric Section 27 asks for
(total/unique candidates, duplicate rate, mega-cap leakage, unknown-size
rate, qualified count, and the found-only-by-structured / found-only-by-
search / found-by-both overlap). It was not executed for two independent,
stated reasons: (1) this session's network egress policy blocks every
provider the NEW path depends on, which would produce a meaningless
all-error result for that arm; (2) even without the block, a real run
spends real Tavily/Serper/LLM quota on the OLD path, which needs explicit
user confirmation under this repo's own standing discipline. Run it with
`npm run benchmark:company-universe` once both conditions are lifted.

## I. Cost (estimated, not measured — no live run occurred)

Structured-source cost is near-zero at any scale — GLEIF, SEC EDGAR, and
India MCA (once a real API key exists) require no per-call payment; UK
Companies House's REST API is free (rate-limited, not metered); the only
metered structured provider is OpenCorporates, and its API-token pricing
was not confirmed this session (network blocked docs). Existing paid costs
(Tavily/Serper search, LLM reasoning) are UNCHANGED by this build — the
structured layer is designed to reduce how many companies ever reach that
expensive tier (Section 15's "ICP filtering before expensive web research"),
not to add a new paid step.

| scale | structured-source cost | existing search/LLM cost (unchanged, not measured this session) |
|---|---|---|
| 100 companies | ~$0 (GLEIF/SEC/MCA free; Companies House free; OpenCorporates pricing TBD) | Same as today's `discoverCompanies()` cost for 100 candidates — not re-measured, this build doesn't change that path's per-call cost |
| 1,000 companies | ~$0, same reasoning | Same as today, scaled 10x — but structured pre-filtering should mean FEWER of these 1,000 ever need the expensive path, per Section 15 (not quantified without a real benchmark run) |
| 10,000 companies | ~$0 for the 4 free providers; OpenCorporates cost unknown pending its pricing confirmation | Same caveat as above, at larger scale — this is exactly the number Section H's unrun benchmark would make concrete |

## J. Coverage gaps (honest, per country/segment)

- **India**: real coverage depends entirely on getting a working
  `MCA_DATA_GOV_RESOURCE_ID` + `MCA_DATA_GOV_API_KEY` — neither confirmed
  this session (network blocked). Until then, India MCA contributes
  nothing; India-based companies rely on GLEIF (LEI-registered only, a
  small minority of Indian SMEs) and OpenCorporates.
- **UK**: strong coverage once `COMPANIES_HOUSE_API_KEY` is set — Companies
  House is a comprehensive, free, official UK registry.
- **US public companies**: strong coverage via SEC EDGAR (no key needed) —
  but genuinely private US companies (the majority) have no SEC coverage at
  all, same limitation this repo's existing `edgar-client.ts` already
  documents.
- **Everywhere else**: GLEIF only covers LEI-registered entities (a
  minority of SMEs globally, per Section 4's own "GLEIF is NOT the
  complete global company universe"); OpenCorporates claims 200M+ companies
  globally but is entirely unconfirmed in this session (no token, network
  blocked) and its commercial-use terms are the one real open question in
  `docs/company-universe-sources.md`.
- **No coverage claim in this report should be trusted as "live-verified"**
  — every number and behavior described here comes from documented API
  contracts and mocked-HTTP unit tests, not a real call to any of the 5
  providers.

## K. Tests (exact count and TypeScript result)

`npx tsc --noEmit`: clean, zero errors, across the entire repo (not just
the new files).

`npm test`: **1023/1023 passing** (903 pre-existing + 120 new, across 9 new
test files — `company-universe-identity`, `-http-client`,
`-sec-edgar-provider`, `-gleif-provider`, `-companies-house-provider`,
`-opencorporates-provider`, `-india-mca-provider`, `-ingestion`,
`-discovery`). Zero regressions in the pre-existing suite. All 120 new
tests run against mocked `global.fetch`/mocked module dependencies — GLEIF
and Companies House's `bulkIngest()` are tested against real temporary CSV
files on local disk (no network), the one place in this build where actual
file-stream/backpressure logic is exercised directly rather than only via
its extracted pure mapping function.

**A real bug was found and fixed by this test suite, not just documented**:
`lib/company-universe/providers/india-mca.ts`'s `mapStatus()` checked for
the substring `"struck off"`, but MCA's actual status vocabulary uses
`"Strike Off"` (the action, not the past tense) — caught by a failing test
assertion before this report was written, fixed in the same session.

`npm run lint`: this branch already carries 144 pre-existing problems
(confirmed via `npm run lint` before this session's own changes were
counted — mostly `@typescript-eslint/no-explicit-any` in test-mock files,
matching the established pattern in `tests/helpers/fake-supabase.ts`, the
pre-existing shared test fake). This session's new test files add ~64 more
of the identical, already-established pattern (mocked `global.fetch`/
Supabase clients typed loosely, same as every other mocked-HTTP test file
in this repo) — not new debt of a different kind. All of this session's
actual SOURCE files (`lib/company-universe/**`,
`app/api/admin/company-universe/**`, the benchmark script) are lint-clean
(`npx eslint` returns zero problems for those paths specifically). Lint
remains `continue-on-error: true` in this repo's CI, per CLAUDE.md's own
Track 6 entry — unchanged by this session.

## L. Remaining risks (evidence-backed only)

1. **Zero live verification of any of the 5 providers.** This is the
   single largest risk in this build, stated as plainly as possible: every
   API endpoint URL, request shape, and response-field mapping is built
   from documented contracts and this assistant's own knowledge, not from
   a real observed response. A real live smoke test (one `search()` and
   one `getCompany()` call per provider, explicit confirmation given
   first, same "throwaway script, real quota, delete after" precedent this
   repo already uses for every other vendor integration) is the necessary
   next step before trusting this in production, and could not be done
   here because the network itself was blocked, not because it wasn't
   attempted.
2. **India MCA's resource ID, API key, and exact column names are all
   unconfirmed** — the lowest-confidence adapter of the five, by a wide
   margin, and its own file header says so.
3. **OpenCorporates' commercial-use/local-storage terms are a genuine open
   question**, not resolved by this session (`docs/company-universe-sources.md`).
4. **GLEIF/OpenCorporates/India MCA rate limits are conservative
   placeholders**, not numbers confirmed from each provider's current
   published policy.
5. **The Section 20 entity-type classifier this plan assumed exists was
   not found** during Section 1's inspection — flagged, not silently
   worked around, in section G above.
6. **The 9-cell benchmark comparison has not been run** — Section H is
   honest about this; no numbers in this report should be read as "the new
   system found more companies than the old one," because that has not yet
   been measured.
7. **`company_universe` migration 026 is not yet applied** to the live
   Supabase project — this build's tables do not exist in production
   until the user runs it, same as every other migration in this repo's
   history.
