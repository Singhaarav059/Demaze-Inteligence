# Company Universe — Source Licensing & Terms

Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 29: "Before
importing any source into a persistent Demaze database, inspect and
document its API terms, dataset license, redistribution restrictions,
attribution requirements, commercial-use restrictions, storage/caching
rules. Do NOT assume `public = freely redistributable`."

**Important caveat, stated up front**: this session's network egress
policy blocked every one of these providers' domains (confirmed via
direct curl and WebFetch — see the final report), so none of the terms
below were re-verified against the providers' current live documentation
in this session. They reflect each provider's well-established, long-
standing public terms as documented in this build's provider files and
this assistant's own knowledge — **re-confirm each one against the
provider's current terms page before this system is used in production**,
since terms can change and this session had no way to check for recent
changes.

**RESOLVED 2026-08-21 — OpenCorporates removed, not just flagged.** The
open question this doc originally raised about OpenCorporates (below, in
the "What this means" section) has been resolved by explicit user
decision: OpenCorporates is removed entirely from this build. This layer's
goal is a **free-first structured company universe** feeding the existing
Demaze discovery/qualification/research pipeline — not a global company-
database replacement — and OpenCorporates was the one provider here with a
real, unresolved commercial-use/paid-tier tension (see the original table
row, preserved below for history). The 4 remaining providers (India MCA,
UK Companies House, SEC EDGAR, GLEIF) all permit free commercial use and
local persistence under their standard public terms, with no equivalent
open question. Do not re-add OpenCorporates, or any other paid/commercial
provider, without a separate explicit decision.

| provider | source_url | license_url | commercial_use | local_storage_allowed | redistribution_allowed | attribution_required | rate_limit | notes |
|---|---|---|---|---|---|---|---|---|
| India MCA (via data.gov.in) | https://www.data.gov.in/catalog/company-master-data | https://data.gov.in/government-open-data-license-india | Yes — India's National Data Sharing and Accessibility Policy (NDSAP) / Government Open Data License permits reuse including commercial, with attribution | Yes | Yes, with attribution | Yes — attribute the Ministry of Corporate Affairs / data.gov.in as the source | Not confirmed this session (conservative placeholder used in code: 30 req/min) | Requires a registered `api-key` (data.gov.in publishes a shared demo key for light testing only — not for sustained use). The exact resource UUID for the Company Master Data dataset was NOT confirmed this session (network blocked) — see `lib/company-universe/providers/india-mca.ts`'s own header. |
| UK Companies House | https://www.gov.uk/guidance/companies-house-data-products | Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) | Yes — OGL v3.0 explicitly permits commercial use | Yes | Yes, with attribution | Yes — "Contains public sector information licensed under the Open Government Licence v3.0" | 600 requests / 5 minutes (stated directly in the source prompt, Section 3 — the one rate limit given verbatim rather than estimated) | Free monthly bulk snapshot ("Basic Company Data") + live REST API, both under the same OGL terms. API auth is Basic Auth with the API key as username, blank password. |
| GLEIF (Global LEI Index) | https://www.gleif.org/en/lei-data/global-lei-index | https://www.gleif.org/en/about-lei/gleif-terms-of-use (CC0 1.0 Universal for the LEI data pool itself, per GLEIF's own published position) | Yes | Yes | Yes — GLEIF explicitly publishes LEI reference data as open data | Not strictly required (CC0) but GLEIF asks that reuse credit "GLEIF" as the source | Not confirmed this session — RATE_LIMIT in `gleif.ts` (30 req/min) is a deliberately conservative placeholder, not a number read from GLEIF's current docs | No API key required for the public API. Bulk "Golden Copy" files exist but this session did not confirm their current download URL (it is dataset-versioned/changes over time) — `bulkIngest()` takes a caller-supplied local file rather than guessing the URL. |
| SEC EDGAR | https://www.sec.gov/search-filings/edgar-application-programming-interfaces | https://www.sec.gov/about/privacy/website-privacy-and-program-fraud-notice (EDGAR data is a U.S. federal government work — not subject to copyright domestically) | Yes | Yes | Yes — U.S. federal government works are in the public domain domestically | No | No hard number published by SEC as an API quota; SEC's fair-access policy asks for a descriptive `User-Agent` with contact info and reasonable request pacing — enforced in code via `SEC_EDGAR_USER_AGENT`, already built in an earlier session (`lib/enrichment/sources/edgar-client.ts`) | Reused directly by this build (`lib/company-universe/providers/sec-edgar.ts`), not a separate client. |

## What this means for how each provider is actually used in this build

**India MCA, Companies House, GLEIF, SEC EDGAR**: all four permit the kind
of local persistence `company_universe`/`company_source_records` does
(storing normalized + raw records long-term) under their standard public
terms — no additional license needed, attribution included in each
provider's `sourceUrl` field on every `NormalizedCompanyRecord`.

## Removed provider (historical record, not active)

**OpenCorporates** was built and unit-tested identically to the other four
in the original 2026-08-21 session, then removed the same day by explicit
user decision (see the RESOLVED note above) — its own terms were the one
genuine open question this doc originally flagged, preserved below for
history rather than deleted:

| provider | source_url | license_url | commercial_use | local_storage_allowed | redistribution_allowed | attribution_required | rate_limit | notes |
|---|---|---|---|---|---|---|---|---|
| OpenCorporates (REMOVED) | https://opencorporates.com/info/our-data | https://opencorporates.com/terms | **No** for the free/API tier without a specific commercial license — OpenCorporates' own terms distinguish free non-commercial/research API use from commercial use, which requires a paid license | Time-limited caching only under the free tier (OpenCorporates' terms restrict long-term local storage/redistribution without a data license) | **No**, not under the free tier — a full local mirror/redistribution requires a commercial data license | Yes, when reuse is permitted at all | Not confirmed — RATE_LIMIT in the now-deleted `opencorporates.ts` (20 req/min) was a placeholder | This was the one provider in the original build where "free tier" and "what Demaze would actually need to do" (persist canonical records long-term in `company_universe`) were in real tension — the exact reason it was removed rather than kept as an optional/fallback source. |

Do not re-add OpenCorporates, or any other paid/commercial provider, to
the active implementation without a separate explicit decision.
