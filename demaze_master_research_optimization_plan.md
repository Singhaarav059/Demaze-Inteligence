# Demaze AI Outbound Intelligence
# Master Engineering Plan: Evidence-First, Cost-Optimized, Concurrent Research
Version: 1.0
Date: 2026-08-18

## 0. Executive Directive

This document is the implementation plan for the next major Demaze research-engineering phase.

Demaze already has a working six-phase AutoGTM loop:

1. Company research
2. Competitor discovery
3. ICP discovery
4. Company discovery
5. Decision-maker discovery via Prospeo
6. Email generation, Gmail sending, and follow-up tracking

The goal now is NOT to rebuild those phases. The goal is to make the research layer:

- evidence-first
- source-traceable
- consistent across sectors and companies
- able to detect contradictions and existing solutions
- safe to automate
- substantially faster through controlled concurrency
- cheaper through caching and in-house infrastructure
- resilient through fallbacks and resumable jobs

Important standing rules:

- Apollo is completely out of scope for now.
- Do not build LinkedIn scraping or bypass controls.
- Do not weaken Phase A/B outbound safety.
- Do not introduce new vendors without explicit approval.
- Do not remove Firecrawl, Tavily, or Serper before benchmarking replacements.
- Do not force an opportunity when evidence is weak.
- Start with G0 read-only audit before production changes.

---

# 1. What the Finished System Should Do

For every company, Demaze should be able to answer:

1. What did we actually find?
2. Where did we find it?
3. Is the source first-party, executive, regulatory, reputable third-party, or weak?
4. When was the information published?
5. Is it still likely to be current?
6. Is the statement a confirmed fact or an inference?
7. Is there corroborating evidence?
8. Is there contradictory evidence?
9. Does the company already appear to have a solution?
10. Why is the proposed opportunity relevant?
11. Why is the recipient relevant?
12. Should Demaze generate an email?
13. Should that email be automatically sendable?
14. If not, why should Demaze abstain or request review?

Every meaningful company-specific proof must have a source.

---

# 2. Core Architecture Principle

Separate universal rules from company-specific intelligence.

Universal rules:

- evidence requirements
- source hierarchy
- confidence rules
- freshness rules
- contradiction rules
- existing-solution checks
- abstention rules
- email safety rules

Company-specific data:

- company
- industry
- products
- initiatives
- news
- leadership
- technology
- existing vendors
- evidence
- opportunities
- recipient

Sector playbooks are allowed to influence WHAT Demaze searches for, but not WHAT Demaze is allowed to call true.

Example:

Bad:

> Manufacturers often have fragmented plant reporting, therefore this manufacturer probably does.

Good:

> Manufacturing playbook says to investigate plant reporting. Research found X from the company's own publication. Therefore X is a confirmed fact. A possible operational implication can be labeled as an inference.

---

# 3. Evidence Ledger

Create or extend a normalized evidence ledger.

Suggested model:

```ts
type SourceAuthority =
  | "FIRST_PARTY"
  | "EXECUTIVE"
  | "EMPLOYEE"
  | "REGULATORY"
  | "REPUTABLE_THIRD_PARTY"
  | "PARTNER"
  | "LOW_AUTHORITY";

type ClaimType =
  | "CONFIRMED_FACT"
  | "CONFIRMED_NEED"
  | "ACTIVE_INITIATIVE"
  | "EXISTING_SOLUTION"
  | "REASONABLE_INFERENCE"
  | "INDUSTRY_CONTEXT"
  | "UNKNOWN";

type EvidenceStatus =
  | "VERIFIED"
  | "CORROBORATED"
  | "CONTRADICTED"
  | "STALE"
  | "UNVERIFIED";

type IntelligenceEvidence = {
  id: string;
  companyId: string;
  claim: string;
  claimType: ClaimType;

  source: {
    url: string;
    canonicalUrl?: string;
    title?: string;
    publisher?: string;
    publishedAt?: string;
    retrievedAt: string;
    evidenceExcerpt?: string;
    authority: SourceAuthority;
  };

  confidence: number;
  confidenceCeiling: number;
  corroborationCount: number;
  status: EvidenceStatus;

  sourceProvider:
    | "DIRECT_FETCH"
    | "JINA"
    | "GEMINI_SEARCH"
    | "SERPER"
    | "TAVILY"
    | "FIRECRAWL"
    | "LINKEDIN_API"
    | "OTHER";

  contentHash?: string;
};
```

Reuse existing repository structures when they are already sufficient. Do not create duplicate tables or schemas unnecessarily.

---

# 4. Evidence Chain

Every opportunity must be traceable through:

```text
SOURCE
  ↓
EVIDENCE EXCERPT
  ↓
CLAIM
  ↓
OPPORTUNITY
  ↓
EMAIL SENTENCE
```

Example:

```text
Source:
company.com/news/example

Evidence:
Company announced X in August 2026.

Claim:
Company is actively implementing X.

Claim type:
ACTIVE_INITIATIVE

Opportunity:
Potential integration/workflow opportunity around X.

Opportunity type:
REASONABLE_INFERENCE

Email:
"I noticed your team is working on X. I was curious whether
the integration side is already handled or still being worked through."
```

The email must not convert an inference into a fact.

---

# 5. Universal Claim Rules

## Rule 1: No source, no confirmed company fact

## Rule 2: Company event does not equal company pain

A launch, expansion, hiring campaign, acquisition, or transformation initiative may indicate activity. It does not prove operational difficulty.

## Rule 3: Industry context is not personalization

Industry knowledge may guide research but cannot be presented as something the target company has confirmed.

## Rule 4: Company problem does not automatically belong to recipient

Even if a company-level issue is real, the recipient's ownership must be independently supported or expressed cautiously.

## Rule 5: Check existing solutions

Before recommending a Demaze capability, search for evidence that the company already has that capability, vendor, platform, implementation, or internal program.

## Rule 6: Inference must remain inference

Use language such as:

- may
- could
- potentially
- I was curious whether
- if this is still being worked through

when evidence supports only a hypothesis.

## Rule 7: Contradictions reduce confidence

Do not silently discard contradictory evidence.

## Rule 8: Stale evidence must be dated or downgraded

## Rule 9: Insufficient evidence means abstain

## Rule 10: The LLM may never invent evidence

---

# 6. Source Hierarchy

Use this universal hierarchy.

## Tier 1

- company website
- company newsroom
- investor relations
- annual reports
- regulatory filings
- official company documents
- official company LinkedIn page when legitimately accessible
- executive statements
- verified executive/company publications

## Tier 2

- identifiable company executives
- identifiable company employees speaking about their work
- partner announcements
- official vendor/customer announcements

## Tier 3

- Reuters
- Bloomberg
- established financial publications
- established industry publications
- government sources
- reputable trade publications

## Tier 4

- generic aggregators
- SEO pages
- anonymous forums
- low-quality directories
- AI-generated pages

Tier 4 can be discovery material but should not independently justify a strong personalized claim.

---

# 7. Source Requirements

For every meaningful evidence item, store:

- original URL
- canonical URL
- title
- publisher
- publication date when available
- retrieval date
- evidence excerpt
- authority
- provider
- content hash where possible

Never fabricate:

- URLs
- titles
- dates
- quotes
- excerpts

A source shown in the UI must correspond to evidence actually retrieved or otherwise legitimately verified.

---

# 8. Confidence Ceiling

The model must not manufacture confidence.

Use evidence-derived ceilings.

Initial calibration proposal:

```text
Weak / low-authority single source       <= 0.50
One reputable third-party source         <= 0.70
Strong first-party source                <= 0.85
Multiple independent strong sources      <= 0.95
Explicit first-party statement of need   may approach 0.98+
```

These are initial policy values, not permanent truth.

Calibrate them using the 30-company benchmark.

Final confidence must never exceed the evidence-derived ceiling.

---

# 9. Existing-Solution Verification

For each serious opportunity candidate, perform a targeted check:

```text
Does the company already use a relevant system?
Does it already use a relevant vendor?
Has it announced an implementation?
Has it built the capability internally?
Is the capability limited to one business unit or geography?
Is there evidence of a remaining gap?
```

Return one of:

```text
EXISTING_SOLUTION_CONFIRMED
EXISTING_SOLUTION_POSSIBLE
NO_EXISTING_SOLUTION_FOUND
UNKNOWN
```

Never convert:

> We did not find a solution.

into:

> They do not have a solution.

---

# 10. Contradiction Detection

Create a contradiction pass.

Example:

```text
Source A:
Company is evaluating X.

Source B:
Company completed rollout of X.

Result:
CONTRADICTED / TEMPORAL_CONFLICT
```

Rules:

- preserve both sources
- prefer newer evidence only when dates are reliable
- reduce confidence
- require review if the conflict materially affects the email
- never silently overwrite the earlier claim

---

# 11. Freshness

Store:

- publishedAt
- retrievedAt
- lastVerifiedAt

Freshness must be claim-type-aware.

Examples:

- hiring need: short window
- current initiative: short/medium window
- product capability: longer window
- annual report: long window
- acquisition: long-lived but still date-sensitive

Do not use one TTL for every evidence type.

---

# 12. Sector Playbooks

Keep Manufacturing, Automotive, SaaS, E-commerce, Financial, etc.

But use them only as search maps.

A sector playbook can define:

- terminology
- topics to investigate
- likely company pages
- likely source types
- likely initiatives
- relevant Demaze services

It cannot assert:

> Companies in this sector have problem X.

It can assert:

> Investigate whether this company has evidence related to X.

---

# 13. LinkedIn Strategy

Do NOT build LinkedIn scraping.

Do not use:

- browser automation against LinkedIn
- cookie/session scraping
- anti-bot bypass
- hidden/private endpoints
- login scraping
- credential reuse
- techniques intended to evade platform controls

Use legitimate sources only.

LinkedIn's current official Posts API has restricted permissions. Organization post retrieval is restricted to organizations where the authenticated member has appropriate company-page roles, while member-post retrieval is restricted/approved. Official documentation:

https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

Build a `LinkedInEvidenceAdapter` that supports:

1. officially permitted API access
2. legitimately accessible public/indexed information
3. search-engine discovery of public LinkedIn URLs

A search snippet alone is not proof.

If a search engine finds a LinkedIn URL:

```text
search result
  ↓
can the underlying content be legitimately verified?
  ↓
YES → store evidence
NO  → discovery-only
```

Never treat an inaccessible snippet as confirmed evidence.

---

# 14. Research Provider Architecture

Create provider abstractions.

```ts
interface SearchProvider {
  search(input: SearchRequest): Promise<SearchResult[]>;
}

interface FetchProvider {
  fetch(input: FetchRequest): Promise<FetchedDocument>;
}
```

Search providers:

```text
Gemini Google Search
Serper
Tavily
```

Fetch providers:

```text
Direct HTTP
Jina
Firecrawl
```

The evidence engine should not care which provider found the source.

---

# 15. Provider Routing

Starting architecture:

```text
CACHE
 ↓
cached evidence sufficient?
 ↓ yes
USE CACHE

cache miss
 ↓
DIRECT / IN-HOUSE FETCH
 ↓
JINA / IN-HOUSE EXTRACTION
 ↓
content sufficient?
 ↓ no
GEMINI + GOOGLE SEARCH
 ↓
evidence sufficient?
 ↓ no
SERPER
 ↓
still insufficient?
 ↓
TAVILY
 ↓
difficult page / advanced extraction required?
 ↓
FIRECRAWL
```

This is a benchmarkable starting point, not a permanent rule.

Do not call all providers by default.

---

# 16. Gemini Google Search

Test Gemini Google Search grounding as a primary external discovery method.

Official documentation says Google Search grounding connects Gemini to real-time web content and provides citations:

https://ai.google.dev/gemini-api/docs/google-search

Current Gemini pricing documentation should be checked before each cost review:

https://ai.google.dev/gemini-api/docs/pricing

Do not assume the cheapest provider is the best provider. Measure source quality.

---

# 17. Serper

Keep Serper available as a deterministic Google SERP fallback.

Current public pricing:

- 2,500 free queries
- $50 for 50,000 queries
- approximately $1 per 1,000 queries at the listed Starter tier

Official:

https://serper.dev/

Because Serper is comparatively inexpensive, do not spend major engineering effort eliminating it unless benchmarks show it is unnecessary.

---

# 18. Tavily

Make Tavily optional.

Use only when:

- Gemini Search is insufficient
- Serper is insufficient
- a task demonstrably benefits from Tavily
- benchmark results justify its use

Do not make Tavily mandatory for every company.

---

# 19. Firecrawl

Move Firecrawl from default crawler to fallback.

Use when:

- direct fetch fails
- in-house extraction fails
- JavaScript rendering is genuinely required
- advanced crawling is justified
- high-value content cannot otherwise be retrieved

Current Firecrawl pricing:

https://www.firecrawl.dev/pricing

The current public pricing page lists a 1,000-credit free tier and paid tiers based on credits/pages. Confirm live pricing before making cost assumptions.

---

# 20. In-House Web Fetcher

Build an internal fetch layer using normal HTTP.

Requirements:

- timeout
- retries
- redirects
- content-type detection
- compression support
- response-size limits
- robots.txt awareness
- clear user-agent
- status classification
- metrics

Suggested result:

```ts
type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  html?: string;
  text?: string;
  fetchedAt: string;
  durationMs: number;
};
```

Do not implement anti-bot bypassing.

---

# 21. In-House HTML Extraction

Build:

```text
HTML
 ↓
remove script/style/tracking noise
 ↓
remove navigation/footer noise where safe
 ↓
extract title/headings/paragraphs/lists/tables
 ↓
clean document
```

Use mature open-source parsing libraries.

Do not build an unnecessary browser engine.

---

# 22. Sitemap Discovery

For each company domain:

1. inspect robots.txt
2. discover sitemap references
3. inspect sitemap indexes
4. extract URLs
5. canonicalize URLs
6. deduplicate URLs
7. score URLs

Prioritize:

```text
/about
/company
/products
/services
/solutions
/news
/press
/blog
/investors
/leadership
/careers
/reports
```

Avoid:

```text
/login
/cart
/privacy
/terms
/cookie
tracking URLs
duplicate query URLs
```

---

# 23. URL Relevance Scoring

Initial scoring:

```text
press release        +10
news                 +10
investor relations   +10
annual report        +10
about                 +8
leadership            +8
product               +8
services              +8
case study            +7
careers               +6
blog                  +3

privacy              -10
terms                -10
login                -20
tracking             -20
```

These are starting values.

Benchmark them.

---

# 24. Scrape Relevance Quality

The existing `assessScrapeQuality()` limitation must be addressed.

Do not judge quality by page/character count alone.

Include signals such as:

- title relevance
- heading relevance
- company-name presence
- sector relevance
- evidence-bearing language
- date presence
- source authority
- page type
- duplication
- navigation/noise ratio
- URL relevance

A large irrelevant page must not score as highly as a smaller evidence-bearing page.

---

# 25. Caching

Build source caching.

Store:

```text
canonical_url
content_hash
title
content
publisher
published_at
retrieved_at
last_verified_at
http_status
source_provider
content_type
```

Use different TTLs by page type.

Also cache:

- search results
- normalized sources
- validated evidence
- research summaries

Do not repeatedly pay to rediscover the same evidence.

---

# 26. Evidence Cache

Create reusable verified evidence.

Example:

```text
company_id
source_id
claim
excerpt
claim_type
confidence
source_authority
published_at
verified_at
status
```

Future research can reuse evidence when still fresh.

This becomes Demaze's own research memory, not an Apollo-like people database.

---

# 27. Adaptive Research Depth

Do not research every company equally deeply.

## Level 1 — Qualification

Use:

- website
- basic company profile
- 2–3 targeted searches
- recent signal check

If no meaningful evidence:

```text
ABSTAIN
```

## Level 2 — Evidence Research

For promising companies:

- recent news
- press
- executive/company statements
- relevant initiatives
- existing-solution check
- corroboration

## Level 3 — Deep Verification

Only for strong candidates:

- contradiction search
- source corroboration
- vendor verification
- recipient relevance
- final opportunity validation

---

# 28. Early Stopping

Stop when evidence is sufficient.

Example condition:

```text
3 strong sources
+
1 recent first-party source
+
1 corroborating source
+
clear current initiative
+
no material contradiction
```

Do not continue searching just because budget remains.

If evidence is weak, broaden research.

These thresholds must be configurable and benchmarked.

---

# 29. Research Budget

Create per-company configurable limits.

Example starting configuration:

```ts
{
  maxWebsitePages: 15,
  maxExternalSearches: 5,
  maxDeepSearches: 2,
  maxFirecrawlPages: 3,
  maxLlmCalls: ...,
  maxResearchDurationMs: ...
}
```

Instrument first.

Then calibrate from the 30-company benchmark.

---

# 30. Concurrent Research

The previous 30-company run took more than one hour because companies were effectively researched sequentially.

Replace that with a job queue.

Example:

```text
100 companies
   ↓
queue
   ↓
10 controlled workers
   ↓
10 companies researching
90 queued
```

When one finishes, the next queued company starts.

Do not equate batch size with concurrency.

---

# 31. Start With 5 Workers

Do not launch 30 simultaneous jobs.

Benchmark:

```text
1 worker
5 workers
10 workers
15 workers
```

Measure:

- total runtime
- p50 latency
- p95 latency
- 429 errors
- 5xx errors
- timeouts
- provider failures
- CPU
- memory
- evidence quality
- cost

Select the highest stable concurrency.

10 is an initial target, not a guaranteed final value.

---

# 32. Parallelize Inside Each Company

Independent tasks can run concurrently:

```text
company website
recent news
leadership
press
external evidence
LinkedIn discovery
```

Then merge:

```text
all research
 ↓
evidence normalization
 ↓
evidence validation
```

Do not parallelize dependent tasks.

Opportunity analysis must wait for evidence collection.

---

# 33. Resumable Job States

Each company must be independently resumable.

Suggested states:

```text
QUEUED
RESEARCHING
EVIDENCE_COLLECTION
EVIDENCE_VALIDATION
OPPORTUNITY_ANALYSIS
CONTACT_DISCOVERY
EMAIL_GENERATION
QA
READY
REVIEW_REQUIRED
ABSTAINED
FAILED
COMPLETED
```

If 4 companies fail in a 100-company run, do not restart the other 96.

---

# 34. Retry Policy

Retry transient failures:

- timeout
- 429
- temporary 5xx
- transient network failure

Do not blindly retry:

- malformed URL
- permanent 403
- robots denial
- unsupported content
- policy block
- contradiction

Use exponential backoff with jitter.

Respect provider rate limits.

---

# 35. Cost Instrumentation

Before replacing providers, measure them.

Per company:

```text
company_id
started_at
finished_at
duration_ms

firecrawl_calls
firecrawl_pages
tavily_calls
serper_calls
gemini_search_calls
gemini_tokens
jina_calls
direct_fetch_calls

cache_hits
cache_misses

sources_found
verified_sources
first_party_sources
contradictions
opportunities
abstained

estimated_cost_usd
```

Calculate:

```text
cost per research
cost per verified source
cost per opportunity
cost per send-ready contact
cost per sent email
```

The key business metric should be:

> cost per evidence-backed send-ready opportunity

not simply cost per raw research.

---

# 36. Prospeo

Keep Prospeo.

Do not build a people database.

Call Prospeo only after:

```text
company research
+
validated opportunity
```

Do not spend people-data credits on companies that failed the evidence gate.

---

# 37. Email Evidence Requirements

For every company-specific sentence, the system must be able to answer:

```text
What claim is this?
Where did it come from?
What source supports it?
Fact or inference?
How recent?
Why is the recipient relevant?
```

Expose this in the UI.

Recommended UI:

```text
Why we think this

Confirmed evidence
[Source]
[Evidence excerpt]
[Published date]

Our inference
[Clearly labeled inference]

Existing solution check
[Result]

Recipient relevance
[Evidence]
```

---

# 38. User Experience

Do not expose internal orchestration complexity to ordinary users.

Instead of showing many technical stages, show:

```text
Researching 30 companies

Completed: 18
Researching: 8
Queued: 3
Review needed: 1
Abstained: 0

Average time: 47s/company
Estimated remaining: 5m
```

Per company:

```text
Siemens
✓ Research complete
8 evidence items
4 verified sources
1 opportunity
Evidence confidence: High
```

Advanced evidence can be expanded.

---

# 39. Pilot Observability

Reuse the existing pilot funnel.

Do not create a separate analytics platform.

Track:

- companies queued
- companies completed
- research failures
- evidence sufficient
- evidence insufficient
- opportunities
- abstentions
- review items
- provider calls
- cache hit rate
- average duration
- cost
- source quality

---

# 40. Benchmark Strategy

Use the existing 30-company pilot as a permanent regression suite.

For each run record:

```text
company
runtime
cost
source count
first-party source count
verified evidence count
contradictions
opportunity result
opportunity confidence
abstention/review result
```

The optimized system is not successful if it is only faster.

A faster system with worse evidence is a regression.

---

# 41. Control vs Candidate Benchmark

Run the same 30 companies through:

## Control

Current stack.

## Candidate

```text
in-house fetch
+
in-house extraction
+
cache
+
Gemini Search
+
conditional Serper
+
conditional Tavily
+
Firecrawl fallback
```

Compare:

- evidence correctness
- source quality
- first-party source coverage
- opportunity quality
- false opportunity rate
- abstention rate
- runtime
- provider calls
- cost

Only remove a provider after measured success.

---

# 42. Implementation Order

## G0 — Read-only audit

Inspect:

- every Firecrawl call
- every Tavily call
- every Serper call
- every Jina call
- every direct fetch
- every Gemini search/web call
- every research LLM call
- every cache
- relevant DB tables
- batch execution architecture
- current concurrency
- provider abstractions
- evidence/provenance fields
- benchmark mechanism
- current cost observability
- sequential bottlenecks

Deliver:

`docs/research-architecture-audit.md`

No production behavior changes.

---

## G1 — Cost and latency instrumentation

Add metrics.

Run the 30-company benchmark.

Deliver:

`docs/research-cost-baseline.md`

Do not optimize before the baseline exists.

---

## G2 — Evidence ledger

Implement normalized provenance.

Deliver:

`docs/evidence-policy.md`

Add tests.

---

## G3 — In-house fetcher

Implement direct HTTP fetch.

Test against the 30-company benchmark.

Do not remove Firecrawl.

---

## G4 — In-house extractor

Implement clean HTML extraction.

Compare output with Firecrawl.

---

## G5 — Smart crawler

Implement:

- robots
- sitemap
- URL discovery
- URL scoring
- deduplication
- page limits
- early stopping

---

## G6 — Cache

Implement:

- page cache
- search cache
- evidence cache
- content hashing
- TTL

---

## G7 — Search router

Implement:

```text
cache
→ Gemini Search
→ Serper
→ Tavily
```

Stop when evidence is sufficient.

---

## G8 — Firecrawl fallback

Move Firecrawl from default to fallback.

Measure usage reduction.

---

## G9 — LinkedIn evidence adapter

Only legitimate sources:

- permitted official API access
- legitimately accessible public/indexed content

Never scraping or bypassing controls.

---

## G10 — Concurrent job queue

Implement:

- queue
- workers
- per-company state
- retries
- backoff
- resumability
- progress

Start at 5 workers.

---

## G11 — Internal parallelism

Parallelize independent research tasks.

Respect provider rate limits.

---

## G12 — Adaptive research

Implement:

```text
QUALIFICATION
EVIDENCE
DEEP_VERIFICATION
```

plus early stopping.

---

## G13 — UX

Implement:

- live progress
- evidence counts
- review state
- abstention state
- ETA
- expandable source/evidence details

---

## G14 — Concurrency benchmark

Test:

```text
1
5
10
15
```

workers.

Select the highest stable level.

---

## G15 — Final 30-company comparison

Compare old vs new.

Do not move to large-scale automation until:

- evidence quality is acceptable
- source attribution is reliable
- cost is lower
- runtime is lower
- failure handling is correct
- outbound safety has no regression

---

# 43. Testing Requirements

Every phase must add tests.

Evidence tests:

- source required
- source URL preserved
- excerpt preserved
- inference remains inference
- missing evidence causes abstention
- contradictions detected
- stale source handled
- confidence ceiling enforced

Fetching tests:

- timeout
- retry
- redirect
- non-HTML
- robots
- large response
- duplicate URL

Cache tests:

- hit
- miss
- TTL
- content hash
- stale refresh

Routing tests:

- cache prevents unnecessary provider call
- Gemini sufficient prevents Serper
- Serper sufficient prevents Tavily
- Firecrawl only used as fallback
- provider failure triggers appropriate fallback
- no infinite fallback loops

Concurrency tests:

- duplicate company cannot run twice
- jobs resume
- retry classification
- 429 backoff
- partial batch completion
- progress reporting

Always run the existing outbound safety suite after research changes.

---

# 44. Required Commands

After every meaningful phase:

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

For research changes:

- run the 30-company benchmark
- compare against baseline
- record actual metrics

Never claim completion from unit tests alone.

---

# 45. Documentation Deliverables

Create/update:

```text
docs/research-architecture-audit.md
docs/research-cost-baseline.md
docs/evidence-policy.md
docs/research-provider-routing.md
docs/research-concurrency.md
docs/linkedin-evidence-policy.md
docs/research-cost-optimization.md
docs/research-benchmark-results.md
```

Document actual results, not assumptions.

---

# 46. External References

Use official documentation for provider integration.

Gemini Google Search:
https://ai.google.dev/gemini-api/docs/google-search

Gemini pricing:
https://ai.google.dev/gemini-api/docs/pricing

Firecrawl pricing:
https://www.firecrawl.dev/pricing

Serper:
https://serper.dev/

LinkedIn Posts API:
https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api

Re-check live pricing/permissions before implementing or budgeting.

---

# 47. Stop Conditions

Stop and report instead of guessing if:

- provider API behavior is unclear
- LinkedIn access would require scraping or bypass
- a change would weaken outbound safety
- a replacement causes evidence-quality regression
- a migration is materially larger than expected
- existing tests become unreliable
- cost cannot be measured
- a new paid vendor appears necessary

Do not silently introduce a new vendor.

---

# 48. What Not To Do

Do NOT:

- add LLMs just to solve isolated quality issues
- create sector-specific truth standards
- create special prompts for individual companies
- fabricate sources
- turn industry assumptions into facts
- send without evidence
- scrape LinkedIn
- bypass LinkedIn controls
- remove providers without benchmarking
- call every provider for every company
- research every company to maximum depth
- process companies sequentially
- launch 30+ concurrent workers without testing
- build your own Google
- build your own Prospeo
- build another analytics platform
- weaken Phase A/B safety
- reintroduce Apollo
- introduce a new vendor without explicit approval

---

# 49. Success Criteria

The project is complete only when the 30-company benchmark demonstrates with real measurements:

1. lower research latency
2. lower external-provider usage
3. lower cost per research
4. equal or better source quality
5. source attached to every meaningful proof
6. clear fact vs inference separation
7. existing-solution checking
8. contradiction detection
9. safe LinkedIn evidence handling
10. resumable concurrent research
11. reliable batch progress
12. no outbound safety regression
13. no existing test regression

The final report must contain numbers.

Bad:

> Much faster.

Good:

> Median research time fell from X seconds to Y seconds; 30-company wall time fell from X minutes to Y minutes.

Bad:

> Cheaper.

Good:

> Average external research cost fell from $X/company to $Y/company.

Bad:

> Evidence improved.

Good:

> First-party source coverage increased from X% to Y%; unsupported opportunity rate changed from X% to Y%.

---

# 50. FIRST COMMAND TO CLAUDE

Start with G0 only.

Do not immediately change production behavior.

First inspect the repository and produce:

`docs/research-architecture-audit.md`

The audit must identify:

- every Firecrawl call
- every Tavily call
- every Serper call
- every Jina call
- every direct fetch
- every Gemini web/search call
- every research LLM call
- every relevant cache
- every relevant DB table
- current batch execution architecture
- current concurrency
- current provider abstraction
- current evidence/provenance fields
- current 30-company benchmark
- current cost observability
- all sequential research paths
- all safely parallelizable paths

Then report:

1. Current architecture
2. Current bottlenecks
3. Current cost drivers
4. Current evidence gaps
5. Proposed minimal changes
6. Files likely to change
7. DB migrations required, if any
8. Risks
9. Test plan
10. Exact implementation order

After G0 is complete, proceed to G1.

Do not skip phases.
Do not make unrelated improvements.

The objective is simple:

**Make Demaze faster, cheaper, evidence-backed, explainable, and safe to automate at scale.**
