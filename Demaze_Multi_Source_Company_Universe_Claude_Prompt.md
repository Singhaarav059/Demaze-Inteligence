# Claude Task: Build Demaze's Free Company Universe & Multi-Source Discovery Layer

We need to make Demaze's company discovery substantially more reliable.

The current discovery engine relies heavily on web/search discovery. That has exposed a fundamental limitation:

- search engines return overlapping results
- repeated searches often return the same companies
- search snippets frequently don't contain employee/revenue information
- search is not a reliable representation of the complete company universe
- mega-cap companies can slip through when firmographic evidence is absent
- discovery quality depends too heavily on search ranking

Do NOT try to solve this by adding more Google queries or more hardcoded company-name lists.

The next architectural step is to build a **multi-source company-universe layer using free/open/public company datasets**, then use Demaze's existing web research system for enrichment and intelligence.

The core principle is:

```text
STRUCTURED COMPANY DATA
        ↓
COMPANY UNIVERSE
        ↓
NORMALIZATION + DEDUPLICATION
        ↓
ICP / ENTITY / SIZE QUALIFICATION
        ↓
WEB RESEARCH
        ↓
SIGNALS / PAIN POINTS / OPPORTUNITIES
```

Search engines should become an **enrichment/research layer**, not the primary company-universe source.

---

# 1. FIRST: INSPECT THE EXISTING CODEBASE

Before writing code, inspect the actual repository.

Do not trust CLAUDE.md or previous descriptions blindly.

Determine:

- current discovery architecture
- current `company_registry` schema
- current qualification pipeline
- existing source/provider abstractions
- existing scraper/search implementation
- existing deduplication/identity logic
- existing benchmark infrastructure
- existing Supabase migrations
- current environment/configuration pattern
- current logging/metrics pattern
- existing rate-limit/concurrency conventions

Do not duplicate an existing abstraction.

Do not rewrite working discovery or qualification code unnecessarily.

After inspection, briefly state:

1. what already exists
2. where the new data-source layer should integrate
3. what schema changes are actually required

Then implement.

---

# 2. DATA SOURCES TO IMPLEMENT

Build provider adapters for the following sources.

## A. India — Government Company Master Data

Source:

Government of India Open Government Data platform:

https://data.gov.in/catalog/company-master-data

This is the Ministry of Corporate Affairs Company Master Data.

It contains fields including:

- CIN
- company name
- company status
- company class
- company category
- authorized capital
- paid-up capital
- registration date
- registered state
- Registrar of Companies
- principal/business activity information where available

The dataset is updated periodically.

This should be the primary structured discovery source for India.

### Important

Do not scrape the data.gov.in webpage itself.

Determine the actual downloadable/API resource exposed by the dataset and use the official machine-readable resource.

Store the source provenance.

---

# 3. UK — Companies House

Use the official Companies House data products.

Official:

https://www.gov.uk/guidance/companies-house-data-products

https://download.companieshouse.gov.uk/

https://developer.company-information.service.gov.uk/

Companies House provides:

- free monthly bulk company data
- company number
- company name
- company status
- company type
- registered office
- SIC/business activity
- previous names
- filing information

The current free company snapshot is specifically intended for bulk use.

The Companies House API provides live company information and currently has a default rate limit of 600 requests per 5 minutes.

### Implementation

Prefer the **bulk snapshot** for building the local UK company universe.

Use the API for:

- refreshing individual records
- fetching current details
- targeted enrichment

Do NOT make thousands of API calls when the bulk dataset can provide the base universe.

Build incremental refresh capability.

---

# 4. GLOBAL LEGAL ENTITY DATA — GLEIF

Use GLEIF as the global legal-entity identity/verification layer.

Official:

https://www.gleif.org/en/lei-data/global-lei-index

https://www.gleif.org/en/lei-data/gleif-api-public-beta

https://www.gleif.org/en/lei-data/lei-download

GLEIF provides:

- LEI
- legal entity name
- legal address
- entity status
- registration information
- Level 1 entity information
- Level 2 ownership relationships where available

GLEIF makes the complete LEI data pool publicly accessible and provides downloadable files and API access.

### IMPORTANT

GLEIF is NOT the complete global company universe.

Many SMEs do not have LEIs.

Therefore:

```text
GLEIF = identity / verification / corporate relationship layer
```

NOT:

```text
GLEIF = all global companies
```

Use it accordingly.

Prefer bulk files for large-scale ingestion rather than querying the API for every company.

Support:

- initial full ingestion
- incremental/delta updates
- entity matching
- LEI enrichment
- parent/child relationship enrichment

Do not download the full dataset on every application request.

---

# 5. GLOBAL COMPANY DISCOVERY — OPENCORPORATES

Use OpenCorporates as an additional global legal-company discovery source.

Official:

https://api.opencorporates.com/

Documentation:

https://api.opencorporates.com/documentation/API-Reference

OpenCorporates currently provides access to data covering 200M+ companies and includes source provenance.

However:

IMPORTANT:

The OpenCorporates API currently has usage limits depending on account/license.

Do NOT design Demaze around unlimited API access.

Do NOT attempt to bypass rate limits.

Do NOT scrape OpenCorporates.

Create an adapter that respects:

- API key
- rate limits
- retries
- exponential backoff
- daily/monthly quota
- source licensing
- attribution requirements

Use it primarily for:

- global company discovery
- legal entity matching
- jurisdictions not covered by a stronger local source
- verification
- enrichment

If the current OpenCorporates free/API account is too restrictive for large ingestion, the provider must degrade gracefully rather than blocking the entire discovery engine.

---

# 6. USA — SEC EDGAR

Use SEC EDGAR for public-company discovery and financial verification.

Official:

https://www.sec.gov/search-filings/edgar-application-programming-interfaces

The SEC APIs provide:

- company submissions
- filing history
- XBRL financial facts
- company identifiers
- financial data

The APIs do not require API keys.

SEC also provides bulk archives.

### IMPORTANT

SEC is NOT a complete US private-company database.

Use it primarily for:

```text
public companies
financial evidence
revenue evidence
filing evidence
company identity
```

It should be especially useful for the current mega-cap problem.

Where SEC data establishes:

```text
revenue
assets
public-company status
filing information
```

prefer deterministic SEC evidence over LLM inference.

Respect SEC's automated-access requirements and rate limits.

Identify the application with a proper User-Agent containing contact information according to SEC requirements.

Do not hammer SEC endpoints concurrently.

---

# 7. DO NOT CREATE ONE GIANT PROVIDER

Create a clean provider abstraction.

Something conceptually like:

```text
CompanyDataProvider
```

with capabilities such as:

```text
search()
getCompany()
stream/bulk ingestion if supported
refresh()
healthCheck()
```

Then implement:

```text
IndiaMcaProvider
CompaniesHouseProvider
GleifProvider
OpenCorporatesProvider
SecEdgarProvider
```

Use the project's existing architecture if an equivalent abstraction already exists.

Do not force every provider to implement methods it doesn't support.

For example:

```text
bulkDownload()
```

may be supported by GLEIF/Companies House but not OpenCorporates.

Model capabilities explicitly.

---

# 8. CREATE A CANONICAL COMPANY SCHEMA

Do not allow every provider to write its own incompatible company structure.

Create a normalized internal representation.

Use existing schema conventions where possible.

The canonical company record should support fields such as:

```text
canonical_company_id

canonical_name
legal_name
trade_name

domain

country
country_code
state_region
city
registered_address

company_type
entity_type

industry
industry_codes
sic_codes
naics_codes

employee_count
employee_count_min
employee_count_max

revenue
revenue_currency
revenue_year

founded_year

registration_id
registration_authority

cin
lei
cik
company_number

parent_company_id
ultimate_parent_id

status

source_records

source_last_updated

first_seen_at
last_seen_at

data_confidence
```

Do NOT blindly add every field.

First inspect the existing `company_registry`.

Reuse existing fields where possible.

Add only fields that genuinely improve company-universe functionality.

---

# 9. SOURCE PROVENANCE IS MANDATORY

Every imported fact needs provenance.

Demaze must be able to answer:

> Where did this company information come from?

Use a normalized source model.

For example:

```text
source_provider
source_record_id
source_type
source_url
source_last_updated
retrieved_at
```

Where appropriate, store field-level provenance.

Example:

```text
employee_count = 850
source = SEC
retrieved_at = ...
```

versus:

```text
industry = automotive
source = MCA
```

Do not overwrite one provider's evidence with another provider's evidence without retaining provenance.

---

# 10. BUILD A COMPANY INGESTION PIPELINE

Create a proper ingestion pipeline:

```text
SOURCE
  ↓
FETCH
  ↓
PARSE
  ↓
NORMALIZE
  ↓
VALIDATE
  ↓
IDENTITY MATCH
  ↓
UPSERT
  ↓
SOURCE PROVENANCE
```

It must support:

### Initial ingestion

Load a source's available dataset.

### Incremental refresh

Only process changed/new records where the source supports it.

### Re-run safety

Running the same ingestion twice must NOT create duplicates.

### Failure recovery

If 10,000 records are being imported and record 4,000 fails:

Do not lose the previous 3,999.

Use checkpointing/batching where appropriate.

---

# 11. DO NOT LOAD MASSIVE DATASETS INTO MEMORY

Some official datasets are large.

For example, GLEIF publishes multi-million-record datasets and Companies House publishes large bulk files.

Do not:

```text
download huge dataset
parse everything
hold entire dataset in RAM
insert one record at a time
```

Instead use:

- streaming
- chunking
- batching
- temporary files
- database bulk insert/upsert
- checkpoints

Use the appropriate parser for CSV/XML/JSON.

Inspect the actual formats before implementation.

---

# 12. BUILD IDENTITY RESOLUTION PROPERLY

This is critical.

The same company may appear as:

```text
BMW AG
Bayerische Motoren Werke AG
BMW
BMW Group
```

Do not create four companies.

Use the existing identity system and extend it carefully.

Identity signals should include where available:

```text
registration ID
CIN
company number
LEI
CIK
domain
normalized legal name
country
registered address
parent relationships
```

Use deterministic identifiers first.

Then use conservative fuzzy matching only when deterministic identifiers are unavailable.

Never merge two companies purely because their names are similar.

Every merge should have a reason/confidence.

---

# 13. SOURCE PRIORITY

Create an explicit source precedence model.

Example:

### Legal identity

Prefer:

```text
national government registry
GLEIF
SEC
OpenCorporates
```

depending on jurisdiction and entity type.

### Financial data

Prefer:

```text
SEC
government filings
official company filings
```

### Business activity

Prefer:

```text
national registry classification
official filings
company website
```

### Current operational signals

Prefer:

```text
company website
news
search
job postings
press releases
```

Do NOT let a generic LLM statement override authoritative structured evidence.

---

# 14. CHANGE THE DISCOVERY ENGINE

The current Company Discovery Engine should become:

```text
DISCOVERY REQUEST
        ↓
Determine target countries/regions
        ↓
Query structured company sources
        ↓
Merge results
        ↓
Identity deduplication
        ↓
Canonical company records
        ↓
Basic deterministic qualification
        ↓
Web research only where needed
        ↓
Final qualification
```

Search should no longer be the only way to generate company candidates.

---

# 15. SEARCH FALLBACK

Keep the existing:

```text
Firecrawl
Jina
Tavily/search
direct fetch
```

but use them as fallback/enrichment.

For example:

```text
Structured provider returns 1,000 companies
        ↓
ICP filtering
        ↓
300 candidates
        ↓
Research only those 300
```

Do NOT perform expensive web research against thousands of companies before basic structured filtering.

---

# 16. COMPANY DISCOVERY QUERY MODEL

The discovery engine should eventually support queries like:

```text
country = India
sector = manufacturing
employee_count = 50-500
status = active
```

or:

```text
countries = Germany, France, UK
industry = automotive
employee_count = 100-5000
```

or:

```text
region = South Asia
sector = ecommerce
company_type = operating_company
```

Normalize user-facing ICP criteria into provider-specific filters.

If a provider cannot support a filter, don't pretend it can.

Instead:

```text
provider filtering
        ↓
local filtering
        ↓
research filtering
```

---

# 17. IMPORTANT: DO NOT ASSUME REVENUE/EMPLOYEE DATA EXISTS

A provider may have:

```text
employee_count = unknown
revenue = unknown
```

That is acceptable.

Do NOT manufacture values.

Use:

```text
known
unknown
conflicting
```

states.

Qualification remains conservative.

For size:

```text
deterministic evidence → highest priority
stored evidence → next
knowledge tier → last resort
unknown → unknown
```

The existing safety rule remains:

```text
uncertain = unknown
```

Never convert uncertainty into `too_large`.

---

# 18. IMPROVE THE EXISTING SIZE QUALIFICATION

Integrate structured source evidence into `company-size.ts`.

Preferred hierarchy:

```text
government / regulatory evidence
        ↓
provider firmographic evidence
        ↓
stored company evidence
        ↓
homepage evidence
        ↓
search snippets
        ↓
LLM knowledge tier
```

If SEC or another authoritative source clearly establishes that a company is far above the ICP size limit, reject deterministically.

Do not spend an LLM call.

If a structured source gives no size information, continue to the next source.

---

# 19. MEGA-CAP HANDLING

Do NOT create:

```text
KNOWN_MEGA_CAP_NAMES = [
  BMW,
  Audi,
  Porsche,
  ...
]
```

as the primary solution.

Instead use evidence.

The knowledge tier can remain as the final safety net.

Add the known failures to tests/benchmark fixtures only:

```text
BMW
Audi
Mini
Porsche
Volvo
Jaguar
Land Rover
Maruti Suzuki
JCB
Tencent
Jacobs Solutions
Fluor
Murata Manufacturing
Murata Vietnam
Robert Bosch GmbH
O'Reilly Automotive
Lear
Bilfinger Tebodin
```

Do not hardcode them into production rejection logic.

---

# 20. INDUSTRIAL ZONE / NON-COMPANY ENTITY HANDLING

Keep the structural entity classifier.

It should reject:

```text
industrial park
industrial estate
industrial zone
economic zone
cluster
government program
association
chamber
authority
initiative
etc.
```

But don't overgeneralize words like:

```text
cluster
group
park
zone
```

because legitimate companies can contain these words.

Use entity-type reasoning and contextual evidence.

Add regression tests.

---

# 21. LOCAL COMPANY DATABASE

The most important architectural change:

Create a persistent local company-universe store.

Conceptually:

```text
company_source_records
        ↓
canonical companies
        ↓
company_registry
```

Do not call external providers for every discovery request if the data has already been ingested locally.

Discovery should query the local canonical database first.

External providers are used for:

```text
initial ingestion
refresh
new jurisdictions
missing data
verification
```

This is what makes the system sustainable.

---

# 22. SOURCE REFRESH STRATEGY

Implement source-specific refresh schedules/configuration.

Example:

```text
MCA
monthly / according to published dataset

Companies House
monthly bulk snapshot
API for targeted live refresh

GLEIF
daily/incremental where practical

SEC
real-time API / nightly bulk where appropriate

OpenCorporates
on-demand / quota-aware
```

Do not hardcode these schedules into business logic.

Make them configuration-driven.

Do not create automations yet unless the project already has a scheduler.

Build the ingestion jobs/services first.

---

# 23. RATE LIMITING

Every external provider must have:

```text
rate limiting
retry with backoff
429 handling
timeout
circuit breaker or graceful failure
quota awareness
logging
```

Respect provider policies.

Never bypass rate limits.

Do not parallelize aggressively.

Use the existing codebase convention of respecting real provider quotas.

---

# 24. CACHE EVERYTHING APPROPRIATE

If the same company/provider request has already been made:

Do not make the request again unnecessarily.

Use existing caching infrastructure if present.

Cache:

- provider responses where licensing allows
- source lookups
- entity matches
- company refreshes
- failed requests with short TTL where appropriate

Do not cache information indefinitely when the provider requires freshness.

---

# 25. BUILD A SOURCE HEALTH SYSTEM

Create a lightweight provider health/metrics mechanism.

Track:

```text
records fetched
records parsed
records rejected
records inserted
records updated
records deduplicated
records failed
API calls
429s
timeouts
latency
last successful sync
source freshness
```

This is important because Demaze should know:

```text
India MCA = healthy
Companies House = healthy
GLEIF = stale
OpenCorporates = quota exhausted
SEC = healthy
```

rather than silently returning incomplete discovery.

---

# 26. DISCOVERY SOURCE SCORING

When a company is returned by multiple sources, retain the source set.

Example:

```text
BMW AG

sources:
- GLEIF
- OpenCorporates
- SEC
- web
```

This increases confidence.

Do not simply overwrite the company with the last provider response.

---

# 27. BENCHMARK THE NEW SYSTEM AGAINST CURRENT GOOGLE DISCOVERY

This is mandatory.

Use the same existing 9-cell benchmark:

```text
Manufacturing
Automotive
E-commerce

South Asia
Europe + UK
North America
```

Compare:

### Old

```text
search-only discovery
```

against:

### New

```text
structured-source discovery
+
search enrichment
```

Measure:

```text
total candidates
unique companies
duplicate rate
entity-type errors
mega-cap leakage
unknown-size rate
qualified companies
review rate
source coverage
```

Also measure:

```text
companies found only by structured sources
companies found only by search
companies found by both
```

This last metric is extremely important.

---

# 28. DO NOT EXPECT THE FREE SOURCES TO BE PERFECT

The goal isn't:

```text
free source = Apollo replacement
```

The goal is:

```text
free structured sources
+
web research
+
LLM reasoning
=
strong company discovery at low cost
```

Clearly label coverage gaps.

If a country has poor free structured coverage, the system should say so.

Do not pretend global coverage is uniform.

---

# 29. SOURCE LICENSING

This is critical.

Before importing any source into a persistent Demaze database, inspect and document its:

- API terms
- dataset license
- redistribution restrictions
- attribution requirements
- commercial-use restrictions
- storage/caching rules

Especially for OpenCorporates.

Do NOT assume:

```text
public = freely redistributable
```

If a source permits API querying but not unrestricted database redistribution, architect around that limitation.

For each provider create a small configuration/documentation record:

```text
provider
source_url
license_url
commercial_use
local_storage_allowed
redistribution_allowed
attribution_required
rate_limit
notes
```

Do not implement around assumptions.

---

# 30. ENVIRONMENT VARIABLES

Use the existing environment-variable pattern.

Potential configuration:

```text
OPENCORPORATES_API_TOKEN
COMPANIES_HOUSE_API_KEY
```

Do not hardcode credentials.

GLEIF and SEC should not require API keys if the official interfaces currently don't require them.

For MCA, inspect the actual API/download mechanism and only add credentials if genuinely required.

---

# 31. NO USER-FACING UI YET

Do not spend time building a large UI.

For this task, create:

- provider adapters
- ingestion jobs
- database schema/migrations
- normalization
- identity matching
- discovery integration
- metrics
- benchmark
- tests

A small admin/status endpoint is acceptable if the existing architecture already uses one.

---

# 32. TESTING

Add unit tests for every provider adapter.

Mock external HTTP calls.

Do not make the normal test suite dependent on live APIs.

Test:

### Provider parsing

Valid records.

Malformed records.

Missing fields.

Unexpected fields.

Encoding issues.

### Deduplication

Same company from multiple providers.

Legal name vs trading name.

Domain variations.

Registration IDs.

### Incremental sync

New record.

Updated record.

Unchanged record.

Deleted/inactive record.

### Rate limiting

429.

Timeout.

Network failure.

Retry exhaustion.

### Qualification

Structured large-company evidence.

Structured SME evidence.

Unknown size.

Conflicting sources.

### Source precedence

Authoritative source overrides weaker evidence where appropriate.

### No hallucination

Missing provider fields remain null/unknown.

### Re-run safety

Running ingestion twice does not create duplicates.

---

# 33. DO NOT RUN MASSIVE LIVE INGESTION FIRST

Before importing millions of records:

Run a small controlled pilot.

For example:

```text
India:
10,000 records

UK:
10,000 records

GLEIF:
10,000 records

SEC:
10,000 records

OpenCorporates:
small quota-safe sample
```

Measure:

- memory
- database write speed
- deduplication
- storage
- query performance
- ingestion time
- error rate

Only then design the full ingestion strategy.

---

# 34. IMPORTANT DATABASE CONSIDERATION

Do not blindly dump millions of companies into `company_registry` if that table is primarily intended for active Demaze research/qualification state.

Separate concepts if necessary:

```text
company_universe
```

from:

```text
company_registry
```

For example:

```text
company_universe
    ↓
raw/normalized company existence

company_registry
    ↓
companies actively processed by Demaze
```

This may be the cleaner architecture.

But inspect the existing schema first.

Do not create redundant tables if the existing architecture already supports this separation.

---

# 35. QUERY PERFORMANCE

The local company-universe database must support efficient filtering.

Plan indexes for common discovery fields:

```text
country
country_code
state_region
industry
sic
naics
status
employee_count
company_type
source
canonical_company_id
domain
registration_id
lei
```

Don't create dozens of unnecessary indexes.

Use actual query patterns.

---

# 36. SECURITY

The existing `company_registry` RLS issue must remain addressed.

If the new `company_universe` table is created:

Do NOT leave it publicly writable.

Determine whether it should be:

```text
server-only
authenticated read
admin-only
```

based on the actual application architecture.

Do not expose provider credentials or bulk-source controls to the browser.

---

# 37. FINAL DISCOVERY ARCHITECTURE

The finished architecture should conceptually look like:

```text
                FREE / PUBLIC SOURCES
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
      MCA          Companies House       GLEIF
       │                 │                 │
       │                 │                 │
       ├──────────── SEC EDGAR ────────────┤
       │                                   │
       └──────────── OpenCorporates ───────┘
                         │
                         ▼
                 SOURCE INGESTION
                         │
                         ▼
                 NORMALIZATION
                         │
                         ▼
                IDENTITY RESOLUTION
                         │
                         ▼
                COMPANY UNIVERSE
                         │
                         ▼
                STRUCTURED FILTER
                         │
                         ▼
                  QUALIFICATION
                         │
                         ▼
              WEB RESEARCH / SIGNALS
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Website          News          Search
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                 DEMAZE INTELLIGENCE
                         │
                         ▼
                PAIN / OPPORTUNITY
                         │
                         ▼
                   OUTBOUND
```

---

# 38. SUCCESS CRITERIA

Do not declare success because the providers technically work.

The success criteria are:

### Discovery

The system finds substantially more unique companies than search-only discovery.

### Coverage

At least:

- India has strong government-source coverage
- UK has strong Companies House coverage
- US public companies have strong SEC coverage
- global legal entities have GLEIF/OpenCorporates coverage

### Quality

Structured sources reduce:

- duplicate discovery
- fake entities
- industrial parks
- associations
- government programs
- mega-cap leakage

### Cost

The company-universe layer should be predominantly free.

Existing paid costs should remain concentrated in:

- web crawling
- search/enrichment
- LLM reasoning

rather than paying per company merely to discover that the company exists.

### Reliability

A temporary failure of Google/Tavily should NOT destroy the entire company-discovery capability.

A temporary failure of one structured provider should NOT destroy discovery either.

The system should degrade gracefully.

---

# 39. FINAL REPORT

When implementation is complete, report:

## A. Existing architecture

What you found before changing anything.

## B. Providers implemented

For each:

- provider
- country/coverage
- data available
- API/bulk
- authentication
- rate limit
- license notes
- refresh strategy

## C. Database changes

Exact migrations/tables/fields.

## D. Ingestion

How initial and incremental ingestion works.

## E. Identity resolution

How duplicate companies across sources are merged.

## F. Discovery

How Company Discovery now uses structured sources before web search.

## G. Qualification

How structured evidence feeds entity/size/ICP qualification.

## H. Benchmark

Compare:

```text
search-only
vs
structured-source + search
```

with exact numbers.

## I. Cost

Estimate:

```text
company discovery cost
web enrichment cost
LLM cost
```

for:

```text
100 companies
1,000 companies
10,000 companies
```

## J. Coverage gaps

Be honest about which countries/segments remain weak.

## K. Tests

Exact count and TypeScript result.

## L. Remaining risks

Only evidence-backed issues.

---

# HARD RULES

Do NOT:

- add another mega-cap blacklist
- scrape Google as the primary company database
- scrape government websites when an official API/bulk dataset exists
- bypass rate limits
- bypass CAPTCHAs
- bypass provider restrictions
- invent missing firmographics
- treat GLEIF as the complete company universe
- treat SEC as a private-company database
- treat OpenCorporates as unlimited/free without checking its actual licensing and quota
- expose API credentials to the browser
- make the normal test suite dependent on live providers
- import millions of records before testing ingestion safely
- mutate the existing 262 qualified rows as part of this task
- break the existing qualification/re-audit system
- replace the existing Firecrawl/Jina/Tavily research layer
- add unrelated features

The objective is:

> **Build Demaze a reliable, low-cost, multi-source company universe that can continuously feed the existing intelligence engine.**

The web is for understanding companies.

Structured public data is for knowing **which companies exist**.

Keep those responsibilities separate.
