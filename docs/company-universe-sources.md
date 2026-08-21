# Company Universe — Source Licensing & Terms

Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 29: "Before
importing any source into a persistent Demaze database, inspect and
document its API terms, dataset license, redistribution restrictions,
attribution requirements, commercial-use restrictions, storage/caching
rules. Do NOT assume `public = freely redistributable`."

**Important caveat, stated up front**: this session's network egress
policy blocked every one of these 5 providers' domains (confirmed via
direct curl and WebFetch — see the final report), so none of the terms
below were re-verified against the providers' current live documentation
in this session. They reflect each provider's well-established, long-
standing public terms as documented in this build's provider files and
this assistant's own knowledge — **re-confirm each one against the
provider's current terms page before this system is used in production**,
since terms can change and this session had no way to check for recent
changes.

| provider | source_url | license_url | commercial_use | local_storage_allowed | redistribution_allowed | attribution_required | rate_limit | notes |
|---|---|---|---|---|---|---|---|---|
| India MCA (via data.gov.in) | https://www.data.gov.in/catalog/company-master-data | https://data.gov.in/government-open-data-license-india | Yes — India's National Data Sharing and Accessibility Policy (NDSAP) / Government Open Data License permits reuse including commercial, with attribution | Yes | Yes, with attribution | Yes — attribute the Ministry of Corporate Affairs / data.gov.in as the source | Not confirmed this session (conservative placeholder used in code: 30 req/min) | Requires a registered `api-key` (data.gov.in publishes a shared demo key for light testing only — not for sustained use). The exact resource UUID for the Company Master Data dataset was NOT confirmed this session (network blocked) — see `lib/company-universe/providers/india-mca.ts`'s own header. |
| UK Companies House | https://www.gov.uk/guidance/companies-house-data-products | Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/) | Yes — OGL v3.0 explicitly permits commercial use | Yes | Yes, with attribution | Yes — "Contains public sector information licensed under the Open Government Licence v3.0" | 600 requests / 5 minutes (stated directly in the source prompt, Section 3 — the one rate limit given verbatim rather than estimated) | Free monthly bulk snapshot ("Basic Company Data") + live REST API, both under the same OGL terms. API auth is Basic Auth with the API key as username, blank password. |
| GLEIF (Global LEI Index) | https://www.gleif.org/en/lei-data/global-lei-index | https://www.gleif.org/en/about-lei/gleif-terms-of-use (CC0 1.0 Universal for the LEI data pool itself, per GLEIF's own published position) | Yes | Yes | Yes — GLEIF explicitly publishes LEI reference data as open data | Not strictly required (CC0) but GLEIF asks that reuse credit "GLEIF" as the source | Not confirmed this session — RATE_LIMIT in `gleif.ts` (30 req/min) is a deliberately conservative placeholder, not a number read from GLEIF's current docs | No API key required for the public API. Bulk "Golden Copy" files exist but this session did not confirm their current download URL (it is dataset-versioned/changes over time) — `bulkIngest()` takes a caller-supplied local file rather than guessing the URL. |
| SEC EDGAR | https://www.sec.gov/search-filings/edgar-application-programming-interfaces | https://www.sec.gov/about/privacy/website-privacy-and-program-fraud-notice (EDGAR data is a U.S. federal government work — not subject to copyright domestically) | Yes | Yes | Yes — U.S. federal government works are in the public domain domestically | No | No hard number published by SEC as an API quota; SEC's fair-access policy asks for a descriptive `User-Agent` with contact info and reasonable request pacing — enforced in code via `SEC_EDGAR_USER_AGENT`, already built in an earlier session (`lib/enrichment/sources/edgar-client.ts`) | Reused directly by this build (`lib/company-universe/providers/sec-edgar.ts`), not a separate client. |
| OpenCorporates | https://opencorporates.com/info/our-data | https://opencorporates.com/terms | **No** for the free/API tier without a specific commercial license — OpenCorporates' own terms distinguish free non-commercial/research API use from commercial use, which requires a paid license | Time-limited caching only under the free tier (OpenCorporates' terms restrict long-term local storage/redistribution without a data license) | **No**, not under the free tier — a full local mirror/redistribution requires a commercial data license | Yes, when reuse is permitted at all | Not confirmed this session — RATE_LIMIT in `opencorporates.ts` (20 req/min) is a placeholder | **This is the one provider in this build where "free tier" and "what Demaze would actually need to do" (persist canonical records long-term in `company_universe`) are in real tension** — flagged here explicitly rather than silently assumed fine. Confirm OpenCorporates' current commercial-API terms (or acquire a paid license) before relying on this provider for anything beyond short-lived, per-request verification lookups. No `OPENCORPORATES_API_TOKEN` is configured in this environment, so this provider is currently inert regardless. |

## What this means for how each provider is actually used in this build

- **India MCA, Companies House, GLEIF, SEC EDGAR**: all four permit the
  kind of local persistence `company_universe`/`company_source_records`
  does (storing normalized + raw records long-term) under their standard
  public terms — no additional license needed, attribution included in
  each provider's `sourceUrl` field on every `NormalizedCompanyRecord`.
- **OpenCorporates**: built and unit-tested identically to the other four,
  but its terms are the one genuine open question in this table. Until
  confirmed, treat its contribution to `company_universe` as **provisional**
  — a future session should either (a) confirm the free tier does in fact
  permit this kind of storage for Demaze's actual use case, (b) acquire
  OpenCorporates' commercial data license, or (c) restrict this provider to
  ephemeral, non-persisted verification lookups only (not automatically
  written to `company_universe` the way the other four are). This build did
  NOT make that decision unilaterally — flagging it here is the deliberate
  stopping point, per this plan's own Rule 3 ("no new vendors" without an
  explicit decision) and Section 29's "do not implement around assumptions."
