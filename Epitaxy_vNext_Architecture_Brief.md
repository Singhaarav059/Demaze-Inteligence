# Epitaxy vNext — Competitive Architecture Audit & Improvement Brief

## Mission

Improve Epitaxy into a stronger account-intelligence and outbound system without sacrificing its strongest property: **verified, evidence-backed qualification instead of unconstrained LLM guessing**.

Target flow:

**Company discovery → research → verified evidence → buying signals → opportunity → best person → why now → grounded outreach**

This document is an **audit and architecture brief first**. Claude must not begin by blindly copying repositories or rewriting working subsystems.

---

# 1. Reference repositories to study

Study the actual source code, workflows, schemas, and implementation details, not only README claims.

### 1. B2B Lead Intelligence
https://github.com/brainupgrade-in/b2b-lead-intelligence

Inspect:
- ICP-driven company sourcing
- source selection
- cheap `feed` vs deep `enriched` modes
- source deduplication
- decision-maker discovery
- buying-intent signals
- tech-stack detection
- social-profile extraction
- 0–100 ICP scoring
- optional grounded outreach hooks
- public/login-free sourcing
- per-lead cost-aware enrichment

The repo documents public sources including YC, Hacker News hiring, TechCrunch, PRNewswire and Crunchbase News, plus enriched crawling for contacts, decision makers, tech stack and intent.

### 2. 50k Lead Generation System
https://github.com/Awaisali36/50k-lead-generation-system

Inspect:
- Apollo + Google Search dual sourcing
- Google/Serper discovery of LinkedIn profile URLs
- Apify LinkedIn enrichment
- multi-stage enrichment
- campaign/workflow routing
- structured persistence
- qualification
- retries/fallbacks
- high-volume processing

Documented stack:
- n8n
- Airtable
- Apify
- Serper.dev
- Tavily
- Google Gemini

**Do not copy its simplistic AI 0–10 scoring model into Epitaxy.** Epitaxy's evidence/verification architecture is stronger.

### 3. LinkedIn LeadGen
https://github.com/ashmitb95/linkedin-leadgen

Inspect:
- Playwright/browser automation
- OpenClaw/CDP browser sessions
- DOM extraction using stable `/in/` and job URL anchors rather than fragile CSS selectors
- Claude parsing/scoring
- SQLite
- SHA256 deduplication
- upsert behavior preserving stronger records
- dashboard architecture

Architecture:
**Browser → Extract → AI parse/score → SQLite → Dashboard**

Use this mainly for people/LinkedIn discovery architecture.

### 4. Lead Gen Hacker
https://github.com/sirlifehacker/lead-gen-hacker

Inspect:
- discovery
- enrichment
- workflow decomposition
- provider usage
- normalization
- automation
- cost-aware routing

Only adapt patterns that materially improve Epitaxy.

### 5. AI LinkedIn Lead Generation Machine
https://github.com/anshwysmcbel2710/ai-linkedin-lead-generation-machine

Inspect:
- ICP definition
- discovery
- enrichment
- content intelligence
- scoring
- LinkedIn
- outreach
- separation between discovery and enrichment

---

# 2. Epitaxy strengths that must be preserved

Current architecture:

**Company → research → evidence → quote verification → service-evidence matching → opportunity → confidence/origin → Why Now → outreach**

Preserve these principles unless a demonstrably superior design exists:

1. Sector/industry matching alone must never create an opportunity.
2. A real matched opportunity is required before sector-playbook positioning/CTA can be injected.
3. Evidence must trace to actual retrieved content.
4. Source origin must be tracked.
5. Observed facts and inference must remain separate.
6. Deterministic opportunities remain constrained to the confirmed service catalog.
7. Disqualifiers must apply consistently.
8. Thin evidence should result in no opportunity, not fabrication.
9. LLM inference must never silently become confirmed evidence.
10. Discovery may find sources; retrieved content must earn evidence status through verification.
11. Why Now must not manufacture urgency.
12. Do not casually rewrite D.1–D.5.

---

# 3. Known problems from D.1–D.5

## P0 — Structured evidence reliability

Fresh 10-company testing showed cases where `_extractor` / `_service_evidence_content` could be absent or empty even when the narrative layer had real external research.

Bharat Forge showed inconsistent fresh runs:
- external evidence existed
- structured evidence sometimes disappeared
- opportunity counts changed unexpectedly
- weaker LLM opportunity paths could remain active

**Fix evidence reliability before optimizing opportunity volume.**

## P0 — Company-profile scoping bug

A real bug was fixed where:
- `signals[]` scanned website + enriched content
- `companyProfile` scanned website-only content

Thin website scrapes could therefore produce `primary_type = unknown` even when external enriched content contained valid classification evidence.

The implemented fix:
- classify website first
- if website establishes a confident primary type, keep it
- only fall back to combined content when website classification is unknown
- supplement missing operations fields from combined content

Preserve this trust ordering.

## P0/P1 — Evidence dates

D.3 found that most evidence lacks reliable publication dates. Why Now therefore had to use corroboration as a proxy for recency.

Long-term evidence should support:

```text
Evidence
├── quote
├── source_url
├── source_type
├── origin
├── published_at
├── retrieved_at
├── company_subject
├── verification_status
├── confidence
└── evidence_ids
```

Do not blindly implement this. First map it to current types and consumers.

## P1 — People/contact layer

Epitaxy is stronger on account intelligence than on:
- finding the right person
- matching a person to an opportunity
- role ownership
- LinkedIn discovery
- public professional contact discovery
- contact ranking

This is a major product gap.

---

# 4. Target Epitaxy vNext architecture

```text
                         EPITAXY
                            |
              +-------------+-------------+
              |                           |
       COMPANY INTELLIGENCE         PEOPLE INTELLIGENCE
              |                           |
       +------+------+                +---+----+
       |      |      |                |        |
    Website Search  News           LinkedIn  Public web
       |      |      |                |        |
       +------+------+                +---+----+
              |                           |
              +-------------+-------------+
                            |
                     SOURCE ADAPTERS
                            |
                    NORMALIZED SOURCES
                            |
                     EVIDENCE LAYER
                            |
          +-----------------+-----------------+
          |                 |                 |
       Signals           Company           People
                         Profile
          |                 |                 |
          +-----------------+-----------------+
                            |
                   OPPORTUNITY ENGINE
                            |
                        WHY NOW
                            |
                    PERSON MATCHING
                            |
                     GROUNDED OUTREACH
```

The product should answer:

1. **Is this company worth pursuing?**
2. **What exactly could we sell?**
3. **Why now?**
4. **Who should we contact?**
5. **What should we say?**

---

# 5. Mandatory architectural audit

Compare Epitaxy with all five repositories across:

1. company discovery
2. search/research
3. scraping
4. extraction
5. source classification
6. evidence normalization
7. quote verification
8. publication dates
9. recency
10. company identity resolution
11. enrichment
12. technology detection
13. buying-intent signals
14. people discovery
15. LinkedIn discovery
16. LinkedIn enrichment
17. decision-maker extraction
18. role classification
19. contact discovery
20. ICP scoring
21. opportunity qualification
22. disqualifiers
23. LLM usage
24. provider fallback
25. retry behavior
26. failure isolation
27. cost-aware routing
28. deduplication
29. persistence/data model
30. outreach grounding
31. observability
32. batch processing
33. incremental refresh
34. change detection
35. UI/admin visibility

For every dimension report:
- current Epitaxy implementation
- best reference implementation
- what is genuinely better
- what should be adapted
- exact Epitaxy modules/files affected
- expected benefit
- complexity
- provider/API dependency
- evidence/compliance risk
- P0/P1/P2/P3 priority

---

# 6. Source-adapter architecture

Evaluate moving toward a clean source boundary.

Conceptually:

```ts
interface ResearchSource {
  sourceType: string
  discover(input): Promise<RawSource[]>
  fetch(source): Promise<FetchedSource>
  normalize(source): NormalizedSource
}
```

Potential adapters:
- company website
- Google/Serper
- Tavily
- Firecrawl
- news
- filings
- jobs
- LinkedIn/public profile discovery
- browser-based LinkedIn enrichment
- other public sources

Downstream evidence logic should consume normalized sources rather than provider-specific objects.

Do not implement until current provider boundaries are audited.

---

# 7. Evidence architecture

Evaluate a unified evidence object along these lines:

```ts
{
  id,
  companyId,
  personId?,
  quote,
  sourceUrl,
  sourceType,
  origin,
  publishedAt?,
  retrievedAt,
  companySubject,
  verificationStatus,
  verificationMethod,
  confidence,
  signalType?,
  sourceTier?,
  firstSeenAt?,
  lastSeenAt?
}
```

The exact type must be adapted to Epitaxy's existing model.

**Discovery is not verification.**

Correct:

```text
Search / Gemini / other discovery
        ↓
discovered URL
        ↓
retrieve source
        ↓
verify quote
        ↓
verified evidence
        ↓
opportunity
```

Never:

```text
LLM says company raised money
        ↓
confirmed evidence
```

---

# 8. LinkedIn / People Intelligence

Investigate a dedicated People Intelligence layer.

Desired flow:

```text
Opportunity
    ↓
Relevant role categories
    ↓
Candidate discovery
    ↓
Company association verification
    ↓
Role relevance scoring
    ↓
LinkedIn URL
    ↓
Optional enrichment
    ↓
Best-contact ranking
```

Evaluate:

### A. Search discovery
Google/Serper queries such as:

`site:linkedin.com/in/ "Company Name" "VP Operations"`

### B. Company website
- team pages
- leadership pages
- about pages
- JSON-LD Person schema
- LinkedIn anchors
- card heuristics

### C. Browser automation
- Playwright
- CDP
- logged-in LinkedIn session

### D. Third-party enrichment
- Apify or equivalent

Compare:
- accuracy
- cost
- reliability
- rate limits
- maintenance
- terms/compliance risk
- duplicate handling

**LinkedIn must be an enrichment/discovery source, not the sole source of truth.**

---

# 9. Person-to-opportunity matching

Propose a system that can produce:

```text
Opportunity:
Workflow Automation

Evidence:
12 automation roles
new facility
operational complexity

Contacts:
VP Operations — 94
Head of Digital Transformation — 91
CIO — 87
COO — 79
```

The ranking must be explainable from:
- role ownership
- opportunity type
- company context
- evidence
- seniority
- verified company association

Not merely an opaque LLM score.

---

# 10. Business-event architecture

Evaluate a common event model:

```text
BusinessEvent
├── type
├── company
├── date
├── source
├── evidenceIds
├── confidence
├── firstSeenAt
├── lastSeenAt
└── impact
```

Examples:
- funding
- hiring surge
- leadership change
- facility expansion
- product launch
- layoffs
- restructuring
- acquisition
- partnership

Goal: opportunities and Why Now should consume a common evidence-backed event layer instead of duplicating event logic.

---

# 11. Cost-aware research

Evaluate a staged research model:

### Tier 0 — cheap
- cache
- domain normalization
- metadata
- existing evidence
- search snippets

### Tier 1 — targeted
- search queries
- limited fetches
- high-value sources

### Tier 2 — deep
- Firecrawl
- multi-page crawl
- people discovery
- technology detection
- LinkedIn enrichment

### Tier 3 — expensive
- LLM reasoning
- outreach generation
- paid enrichment APIs

Only escalate when the previous tier is insufficient.

Do not optimize cost at the expense of evidence quality.

---

# 12. Provider fallback

Map every current provider by capability.

Desired conceptual model:

```text
Capability
    ↓
Primary provider
    ↓
Failure / insufficient result?
    ↓
Fallback
    ↓
Normalize
```

Potential examples:
- direct website → Jina → Firecrawl
- search provider A → search provider B
- company team page → public search → LinkedIn enrichment
- primary LLM → configured fallback

Only recommend a fallback if:
- the failure is measurable
- it solves the same problem
- cost is acceptable
- output can be normalized
- evidence quality remains acceptable

Do not add providers just because another repo uses them.

---

# 13. Deduplication

Study reference implementations for:

### Companies
- canonical domain
- canonical URL
- normalized company name
- aliases

### Evidence
- normalized URL
- quote/content hash
- source/date

### People
- LinkedIn URL
- email
- name + company + role

Prevent multiple providers from creating duplicate intelligence objects.

---

# 14. Research refresh and change detection

Evaluate incremental research:

```text
previous research
       ↓
new sources
       ↓
diff
       ↓
new evidence/events
       ↓
changed opportunities
```

Desired result:

```text
Last researched: 2026-08-20

New:
+ funding announced
+ 8 automation roles
+ new COO

Unchanged:
= ERP stack
= manufacturing footprint

Opportunity:
Workflow Automation
Medium → High
```

This can reduce research cost and improve monitoring.

---

# 15. Grounded outreach

Outreach generation should receive:

```text
Opportunity
+
verified evidence
+
person role
+
why-now event
↓
personalization context
↓
LLM
↓
draft
```

The LLM must not invent:
- company facts
- metrics
- projects
- pain points
- responsibilities
- dates

Provide explicit evidence IDs/quotes where practical.

---

# 16. Do NOT copy blindly

Do not:
- replace deterministic qualification with LLM scoring
- remove quote verification
- trust model-generated citations automatically
- loosen disqualifiers
- create opportunities from sector matching
- add providers without a measured need
- introduce Airtable just because a repo uses it
- introduce Apollo just because a repo uses it
- make LinkedIn mandatory
- violate source/platform restrictions
- add dozens of speculative signals
- rewrite D.1–D.5 without evidence of a deficiency
- optimize opportunity count as the primary metric

---

# 17. Benchmark methodology

Any implementation must be measured against the existing benchmark.

Track:
- opportunity precision
- opportunity recall
- false positives
- false negatives
- evidence coverage
- evidence verification rate
- source diversity
- origin correctness
- company identity accuracy
- Why-Now correctness
- contact accuracy
- latency
- provider failure rate
- API calls
- estimated cost/run

**Do not use increased opportunity count as proof of improvement.**

---

# 18. Required final audit report

Before changing code, Claude must produce:

## A. Executive verdict
Is Epitaxy better, worse, or mixed versus these systems?

## B. Top 10 improvements
Rank P0/P1/P2/P3.

## C. What to copy
For every selected pattern:
- repo
- source/file/module
- pattern
- adaptation plan

## D. What not to copy
Explain why.

## E. LinkedIn strategy
Give 2–3 viable architectures and recommend one.

## F. Data model
Propose only necessary schema/type changes.

## G. Research pipeline
Show the recommended end-to-end flow.

## H. Evidence lifecycle
Show discovery → retrieval → verification → signal → opportunity.

## I. Provider strategy
Primary/fallback providers and escalation conditions.

## J. Cost strategy
Where paid API usage can be reduced without reducing quality.

## K. Reliability strategy
Largest failure modes and isolation strategies.

## L. Implementation roadmap

### Phase 0 — correctness/reliability
Fix evidence-loss, identity, normalization and provider-failure issues.

### Phase 1 — research/evidence architecture
Unify sources, dates, events, verification and refresh.

### Phase 2 — people/LinkedIn
Add person discovery, role matching and enrichment.

### Phase 3 — monitoring
Add event timelines, change detection and incremental refresh.

### Phase 4 — outreach
Tie opportunity + person + verified evidence into grounded outreach.

Do not implement all phases simultaneously.

---

# 19. Claude's operating rules

1. Audit first.
2. Do not change code until the audit is complete and prioritized.
3. Read actual repository source where possible.
4. Do not assume README claims are accurate.
5. Separate proven behavior from inference.
6. Preserve Epitaxy's strongest evidence architecture.
7. Every proposed change must have a measurable reason.
8. Every implementation must have regression tests.
9. Run `tsc --noEmit`.
10. Run the full test suite.
11. Research/provider changes require fresh benchmark companies.
12. Report untested areas.
13. Do not hide uncertainty.
14. Keep scope bounded.
15. Implement one architectural phase at a time.

---

# 20. Final success definition

Epitaxy vNext should reliably answer:

**1. Is this company worth pursuing?**
Evidence-backed ICP and service fit.

**2. What can we sell?**
A confirmed service line supported by evidence.

**3. Why now?**
A real, traceable trigger, preferably dated.

**4. Who should we contact?**
A verified person whose role plausibly owns the problem.

**5. What should we say?**
A concise outreach draft grounded only in verified evidence and the person's role.

The objective is not to make Epitaxy resemble these repositories.

The objective is to take the best architectural ideas from each, combine them with Epitaxy's stronger evidence discipline, and build a system that is:

- more accurate
- more reliable
- more explainable
- better at buying-signal discovery
- better at decision-maker identification
- better at LinkedIn/person discovery
- cheaper where possible
- faster where possible
- resilient to provider failures
- substantially better for real outbound sales.

**First deliver the audit and prioritized architecture plan. Do not code until that plan is complete.**
