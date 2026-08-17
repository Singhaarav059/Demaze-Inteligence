# Demaze AI Outbound Intelligence Platform
## Production Hardening, Reliability, Differentiation & Validation Master Plan

**Purpose:** This document is an execution plan for Claude Code to take the existing Demaze codebase from a feature-complete AutoGTM prototype to a reliable, measurable, production-ready outbound intelligence product.

**Execution rule:** Work strictly in the order defined below. Do not jump ahead because a later item looks easier or more interesting. Do not add unrelated features. After each phase, run the specified checks, inspect the results, fix failures, and only then continue.

---

# 0. Current Product Baseline

Demaze is a six-phase AI-driven go-to-market platform:

1. Research company
2. Explore competitors
3. Define ICP/customer segments
4. Find potential customer companies
5. Find decision makers
6. Generate and send outreach, track replies, and follow up

Current stack:

- Next.js App Router
- TypeScript
- Supabase/Postgres
- Tailwind v4
- Railway
- Google Gemini via Vertex AI Express Mode as primary LLM
- NVIDIA NIM/OpenAI-compatible fallbacks
- Firecrawl
- Tavily
- Serper
- Jina Reader
- Apollo.io for organization search/enrichment
- Prospeo for people data
- Gmail OAuth for sending
- SEC EDGAR for filings
- Vitest
- Existing benchmark suite
- Existing CI/env validation/rate limiting/structured logging

The core research pipeline is already mature:

```text
Company URL/name
  -> scraping fallback chain
  -> multi-source enrichment
  -> evidence extraction
  -> signal detection
  -> pain/opportunity generation
  -> validation
  -> final research report
```

The six-phase loop is largely implemented.

The project should now shift from **feature construction** to:

```text
Reliability
+
Evidence quality
+
Safety
+
Deliverability
+
Measurable evaluation
+
Real-world validation
```

---

# 1. Non-Negotiable Project Rules

Claude must follow these throughout the implementation.

## 1.1 Do not expand scope casually

Do NOT add:

- LinkedIn automation
- New LLM providers unless required to fix a proven failure
- New scraping providers unless existing providers demonstrably cannot solve the problem
- New CRM integrations
- New email providers
- New scoring systems without a measured need
- Cosmetic agent abstractions
- Destructive vendor changes

LinkedIn is permanently excluded.

## 1.2 Preserve working functionality

Before modifying an existing subsystem:

1. Read the relevant implementation.
2. Identify current tests.
3. Run the tests.
4. Understand current data contracts.
5. Make the smallest change necessary.
6. Re-run regression tests.

Do not rewrite working systems merely to make them look cleaner.

## 1.3 Evidence beats model confidence

A model saying something confidently is not evidence.

Every important research conclusion should be traceable to:

```text
Source
  -> Evidence
  -> Signal
  -> Problem
  -> Opportunity
  -> Stakeholder
  -> Outreach angle
```

## 1.4 Sending safety

The ability to send email is not authorization to send email.

Batch sends must continue to require explicit user confirmation.

Never remove this safeguard.

## 1.5 Fail closed where external communication is involved

If any of these are uncertain:

- recipient identity
- email validity
- unsubscribe state
- reply state
- campaign state
- evidence supporting a claim
- Gmail authentication
- tracking configuration

the system should stop or mark the record for review rather than guessing.

---

# 2. Target Architecture After This Plan

The desired architecture is:

```text
                         ┌──────────────────────┐
                         │ Target Companies     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │ Company Discovery    │
                         └──────────┬───────────┘
                                    │
                                    ▼
                  ┌─────────────────────────────────┐
                  │ Evidence-Grounded Research      │
                  │                                 │
                  │ Retrieval                       │
                  │ Relevance                       │
                  │ Evidence                         │
                  │ Signals                          │
                  │ Problems                         │
                  │ Opportunities                    │
                  └───────────────┬─────────────────┘
                                  │
                                  ▼
                       ┌────────────────────┐
                       │ ICP Validation     │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Company Fit        │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Decision Maker     │
                       │ Discovery          │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Outreach Angle     │
                       │ Evidence Check     │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Email QA           │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Explicit Approval  │
                       └─────────┬──────────┘
                                 │
                                 ▼
                       ┌────────────────────┐
                       │ Gmail Send         │
                       └─────────┬──────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │ Campaign State Machine               │
              │                                     │
              │ Delivered                            │
              │ Opened                               │
              │ Replied                              │
              │ Follow-up                            │
              │ Bounce                               │
              │ Unsubscribe                          │
              │ Stop                                 │
              └─────────────────────────────────────┘
```

---

# 3. Execution Strategy

Execute the work in exactly this order:

```text
PHASE 1  -> Baseline audit
PHASE 2  -> Pipeline observability
PHASE 3  -> Scrape relevance
PHASE 4  -> Evidence provenance
PHASE 5  -> Research/opportunity QA
PHASE 6  -> 100-company evaluation harness
PHASE 7  -> Email safety and deliverability
PHASE 8  -> Follow-up/campaign state hardening
PHASE 9  -> Apollo decision
PHASE 10 -> Product UX simplification
PHASE 11 -> Real-world pilot
PHASE 12 -> Final production gate
```

Do not skip directly to UX or new features before the data/reliability phases are complete.

---

# PHASE 1 — BASELINE AUDIT

## Goal

Understand the existing system before changing anything.

## Step 1.1 — Map the repository

Inspect:

- app routes
- API routes
- services
- agents
- database schema
- Supabase migrations
- research pipeline
- scraper implementation
- source adapters
- evidence extraction
- opportunity generation
- ICP generation
- company discovery
- Prospeo integration
- Apollo integration
- Gmail integration
- tracking
- follow-up engine
- campaign state
- QA
- benchmark suite
- tests
- environment configuration
- CI

Create a private implementation map before editing.

## Step 1.2 — Run the existing validation suite

Run:

```bash
npm test
npm run benchmark
npm run build
```

If scripts differ, inspect package.json and use the equivalent commands.

Record:

- test count
- failures
- benchmark failures
- build errors
- warnings
- flaky tests

Do not fix unrelated failures yet.

## Step 1.3 — Establish a baseline report

Create:

```text
docs/production-hardening/baseline.md
```

Include:

- current test status
- benchmark status
- build status
- known failures
- existing technical debt
- known external vendor blockers
- current feature inventory

This document becomes the baseline for measuring improvement.

---

# PHASE 2 — PIPELINE OBSERVABILITY

## Goal

Stop silent failures.

The recurring "silent zero" bug class must become impossible to miss.

A pipeline stage returning zero results is not automatically an error, but it must always be observable.

## Step 2.1 — Define a standard pipeline result contract

Create a consistent internal result structure similar to:

```ts
type PipelineResult<T> = {
  status: "success" | "partial" | "empty" | "failed";
  data: T;
  counts?: Record<string, number>;
  warnings: string[];
  errors: string[];
  durationMs: number;
  sources?: string[];
};
```

Adapt to existing architecture rather than blindly introducing duplicate abstractions.

## Step 2.2 — Instrument every major stage

Track at minimum:

```text
company_discovery
scraping
scrape_relevance
source_enrichment
evidence_extraction
signal_detection
pain_point_generation
opportunity_generation
research_validation
competitor_discovery
icp_generation
company_matching
people_discovery
email_generation
email_qa
email_send
tracking
followup
```

For each stage record:

- start time
- end time
- duration
- input count
- output count
- status
- warning count
- error count
- provider used
- fallback used
- confidence where relevant

## Step 2.3 — Add explicit empty-state diagnostics

Example:

```text
signals: 0
status: empty
reason: no qualifying evidence found
```

NOT:

```text
signals: []
```

For every zero result, provide a machine-readable reason.

Possible reasons:

```text
NO_RELEVANT_CONTENT
NO_EVIDENCE
SOURCE_FAILURE
PARSER_FAILURE
LANGUAGE_MISMATCH
IDENTITY_MISMATCH
LOW_CONFIDENCE
PROVIDER_FAILURE
VALIDATION_REJECTED
```

## Step 2.4 — Add structured pipeline logs

Logs must allow a developer to reconstruct:

```text
Company
-> sources attempted
-> sources succeeded
-> relevant pages
-> evidence extracted
-> signals created
-> opportunities created
-> validation result
```

Never log secrets, OAuth tokens, passwords, API keys, or private email content unnecessarily.

## Step 2.5 — Verification

Run all tests and confirm:

- zero-result stages are visible
- provider failures are visible
- fallback usage is visible
- no secret leakage occurs
- existing API behavior remains compatible

---

# PHASE 3 — SCRAPE RELEVANCE ENGINE

## Goal

Fix the biggest research-quality weakness.

Current problem:

`assessScrapeQuality()` primarily evaluates quantity such as page/character count and lacks meaningful content relevance.

That means a large pile of irrelevant content can look healthy.

## Step 3.1 — Define page relevance categories

Create a deterministic relevance taxonomy.

High priority:

```text
ABOUT
PRODUCT
SERVICE
SOLUTION
INDUSTRY
OPERATIONS
MANUFACTURING
FACILITY
TECHNOLOGY
DIGITAL_TRANSFORMATION
LEADERSHIP
INVESTOR_RELATIONS
ANNUAL_REPORT
PRESS_RELEASE
CASE_STUDY
CUSTOMER
SUSTAINABILITY
STRATEGY
CAREERS
```

Low priority:

```text
PRIVACY
COOKIE
TERMS
LOGIN
SIGNUP
SEARCH
NAVIGATION
DUPLICATE
EMPTY
GENERIC_ERROR
```

Keep room for unknown/neutral pages.

## Step 3.2 — Build relevance scoring

A page score should consider:

```text
URL semantics
+
title
+
heading text
+
content density
+
company identity match
+
keyword/signal density
+
source type
+
recency where available
+
duplicate similarity
```

Do not use an LLM for every page.

Prefer deterministic scoring first.

Example conceptual score:

```text
relevance =
  url_score
  + title_score
  + heading_score
  + identity_score
  + signal_density
  + source_authority
  - duplicate_penalty
  - boilerplate_penalty
```

Tune values empirically rather than assuming perfect weights.

## Step 3.3 — Company identity validation

Detect cases where a page belongs to:

- another company
- a similarly named company
- a directory
- a news article unrelated to the target
- a regional site for another entity

Identity mismatch should sharply reduce relevance.

## Step 3.4 — Deduplication

Detect:

- exact duplicates
- URL duplicates
- canonical URL duplicates
- near-identical pages
- regional clones

Do not let 20 copies of the same content appear to be 20 independent sources.

## Step 3.5 — Research corpus selection

Before evidence extraction, produce:

```text
selectedPages
rejectedPages
rejectionReasons
relevanceScores
```

Use only the strongest corpus for downstream reasoning.

## Step 3.6 — Tests

Add fixtures for:

- correct company
- wrong company
- duplicate regional pages
- cookie pages
- login pages
- investor report
- product page
- manufacturing page
- non-English content
- similarly named companies

Required behavior:

- relevant pages score above irrelevant pages
- wrong-company pages are rejected or heavily penalized
- duplicates do not inflate source count
- non-English content does not become zero-result

---

# PHASE 4 — EVIDENCE PROVENANCE SYSTEM

## Goal

Make every important conclusion explainable.

Implement the chain:

```text
SOURCE
  ↓
EVIDENCE
  ↓
SIGNAL
  ↓
PROBLEM
  ↓
OPPORTUNITY
  ↓
STAKEHOLDER
  ↓
OUTREACH ANGLE
```

## Step 4.1 — Define evidence object

Use or adapt an object such as:

```ts
type Evidence = {
  id: string;
  sourceUrl: string;
  sourceTitle?: string;
  sourceType?: string;
  retrievedAt: string;
  publishedAt?: string;
  excerpt: string;
  claim: string;
  relevanceScore: number;
  confidence: number;
};
```

Do not duplicate existing schemas if an equivalent already exists.

## Step 4.2 — Every signal must reference evidence

A signal should not exist without evidence unless explicitly classified as inference.

```ts
type Signal = {
  id: string;
  description: string;
  evidenceIds: string[];
  confidence: number;
  classification: "confirmed" | "inference";
};
```

## Step 4.3 — Opportunities must reference signals

```ts
type Opportunity = {
  id: string;
  title: string;
  problem: string;
  signalIds: string[];
  evidenceIds: string[];
  stakeholderRoles: string[];
  demzeService?: string;
  confidence: number;
  classification: "confirmed" | "reasonable_inference";
};
```

Use the project's existing naming conventions.

## Step 4.4 — Outreach angle must reference the opportunity

Every generated outreach angle must be traceable back to evidence.

The system should be able to answer:

```text
Why this company?
Why this problem?
Why now?
Why this person?
Why Demaze?
What evidence supports this?
```

## Step 4.5 — UI evidence inspection

Expose enough information for the user to inspect the source.

Do not dump huge documents into the UI.

Show:

- evidence statement
- source
- date where available
- confidence
- source link
- what conclusion it supports

---

# PHASE 5 — RESEARCH AND OUTREACH QUALITY GATES

## Goal

Prevent hallucinations and weak personalization from reaching the user or sending system.

## Step 5.1 — Unsupported claim detector

Before an opportunity or email is approved, identify factual claims.

For each claim:

```text
Can this claim be supported?
Which evidence supports it?
Does the evidence actually say this?
```

If not:

```text
REJECT
```

or downgrade to a clearly marked inference.

## Step 5.2 — Generic personalization detector

Reject phrases that could apply to almost any company.

Examples of bad patterns:

```text
"I was impressed by your commitment to innovation."
"I noticed your company is growing."
"Your digital transformation journey..."
"Given today's competitive environment..."
```

The detector should not depend only on a blacklist.

Measure specificity against the available evidence.

## Step 5.3 — Stakeholder relevance check

Verify:

```text
problem
→ role
```

Example:

Plant reporting automation:

Good:

- COO
- Head of Operations
- Plant Operations Director
- Manufacturing Transformation Lead

Potentially weak:

- unrelated HR role
- generic marketing role

Use role mappings as guidance, not absolute rules.

## Step 5.4 — Company identity check

Before generating outreach:

```text
target company
==
research company
==
decision-maker company
```

If mismatch:

```text
BLOCK
```

## Step 5.5 — Confidence gate

Recommended conceptual policy:

```text
HIGH
Enough direct evidence
→ eligible

MEDIUM
Strong inference with multiple supporting signals
→ eligible with review

LOW
Weak or indirect evidence
→ do not auto-send
```

Tune thresholds using the 100-company evaluation rather than arbitrary numbers.

---

# PHASE 6 — BUILD THE 100-COMPANY EVALUATION HARNESS

## Goal

Prove the complete pipeline works.

This is the most important engineering milestone.

## Step 6.1 — Create three datasets

### A. Regression dataset

10–20 stable companies.

Used for every code change.

### B. Adversarial dataset

Companies chosen specifically to break the system:

- German/non-English
- multinational
- subsidiaries
- similar names
- weak websites
- JavaScript-heavy websites
- multiple domains
- regional domains
- recently acquired businesses
- companies with sparse public information

### C. Real target dataset

At least 100 realistic companies Demaze could actually target.

## Step 6.2 — Define evaluation metrics

### Research

```text
research_success_rate
relevant_source_rate
evidence_coverage
unsupported_claim_rate
research_latency
```

### ICP

```text
icp_validity
segment_specificity
false_positive_rate
```

### Company discovery

```text
match_precision
match_recall
duplicate_rate
```

### People

```text
decision_maker_accuracy
email_coverage
email_validity
```

### Outreach

```text
personalization_score
unsupported_claim_rate
qa_rejection_rate
```

### Campaign

```text
delivery_rate
bounce_rate
spam_rate
reply_rate
positive_reply_rate
meeting_rate
```

## Step 6.3 — Build a machine-readable evaluation output

Create something like:

```text
evaluation-results/
  latest.json
  latest.md
  history/
```

Do not hard-code fake results.

## Step 6.4 — Per-company trace

Each evaluation should be inspectable:

```text
Company
Sources
Relevant pages
Evidence
Signals
Problems
Opportunity
ICP
Decision maker
Email
QA
Final status
Failure reason
```

## Step 6.5 — Failure taxonomy

Every failure must be categorized.

Examples:

```text
RETRIEVAL_FAILURE
RELEVANCE_FAILURE
IDENTITY_FAILURE
EVIDENCE_FAILURE
EXTRACTION_FAILURE
CLASSIFICATION_FAILURE
ICP_FAILURE
MATCH_FAILURE
PEOPLE_DATA_FAILURE
EMAIL_FAILURE
QA_FAILURE
EXTERNAL_PROVIDER_FAILURE
AUTH_FAILURE
```

This prevents "AI quality issue" from becoming a meaningless catch-all.

## Step 6.6 — Acceptance criteria

Do not invent universal numerical targets before seeing the baseline.

First establish the baseline.

Then set thresholds based on:

- observed failure distribution
- business requirements
- vendor limitations
- acceptable manual-review rate

---

# PHASE 7 — EMAIL SAFETY AND DELIVERABILITY

## Goal

Do not scale outbound until sending is trustworthy.

## Step 7.1 — Gmail authentication

Resolve:

- expired OAuth token
- refresh flow
- reauthorization
- production/test mode behavior
- token storage
- CSRF protection
- account identity

Never expose credentials.

## Step 7.2 — Domain authentication checklist

Verify the sending setup supports:

```text
SPF
DKIM
DMARC
```

Document the actual configuration.

Do not assume it is correct.

## Step 7.3 — Sending controls

Implement or verify:

```text
per-mailbox limits
per-domain limits
campaign limits
rate limiting
randomized legitimate pacing
duplicate prevention
```

Do not implement deceptive engagement behavior.

## Step 7.4 — Suppression system

Before every send, check:

```text
unsubscribed?
bounced?
negative reply?
already replied?
already contacted?
campaign stopped?
company stopped?
domain stopped?
```

Any positive suppression condition must prevent sending.

## Step 7.5 — Global kill switch

Implement a clearly accessible server-side kill switch.

Example conceptual state:

```text
OUTBOUND_SEND_ENABLED=false
```

This must override campaign-level permissions.

## Step 7.6 — Campaign pause

Allow:

```text
pause campaign
resume campaign
stop company
stop mailbox
stop domain
```

Stopping should prevent queued follow-ups too.

## Step 7.7 — Deliverability test

Use a controlled small test set.

Record:

```text
sent
delivered
bounced
spam
opened
replied
```

Do not interpret a small sample as statistically definitive.

---

# PHASE 8 — CAMPAIGN STATE MACHINE AND FOLLOW-UP HARDENING

## Goal

Make follow-ups deterministic and safe.

## Step 8.1 — Explicit state machine

Use a state model similar to:

```text
DRAFT
→ QA_PASSED
→ AWAITING_APPROVAL
→ APPROVED
→ QUEUED
→ SENT
→ DELIVERED
→ OPENED
→ REPLIED
```

Terminal/stop states:

```text
BOUNCED
UNSUBSCRIBED
STOPPED
FAILED
```

Follow-up states should be explicit rather than inferred from scattered fields.

## Step 8.2 — Event log

Every transition must create an immutable event:

```text
event
timestamp
company
contact
campaign
previousState
newState
reason
metadata
```

## Step 8.3 — Reply detection

If a reply is detected:

```text
STOP ALL AUTOMATIC FOLLOW-UPS
```

unless the user explicitly configures another behavior.

## Step 8.4 — Bounce handling

Bounce:

```text
STOP CONTACT
MARK EMAIL INVALID
DO NOT FOLLOW UP
```

## Step 8.5 — Unsubscribe handling

Unsubscribe:

```text
PERMANENT SUPPRESSION
```

Do not rely solely on campaign state.

## Step 8.6 — Idempotency

A retry must never send the same email twice.

Use an idempotency key based on the appropriate immutable identifiers.

---

# PHASE 9 — APOLLO DECISION

## Goal

Do not spend money simply because an integration exists.

Apollo organization search and People Match are code-complete but currently plan-blocked.

## Step 9.1 — Test Prospeo baseline first

Measure:

```text
people coverage
email coverage
accuracy
latency
cost
```

## Step 9.2 — Upgrade Apollo only if justified

If the account must be upgraded, test Apollo on a representative sample.

Compare:

```text
Prospeo
vs
Apollo
vs
Prospeo + Apollo
```

Measure:

- coverage improvement
- accuracy improvement
- cost/contact
- latency
- duplicate rate
- failure rate

## Step 9.3 — Decision rule

Keep Apollo only if the measured improvement justifies:

```text
subscription cost
+
integration complexity
+
maintenance cost
```

Otherwise leave the integration available but non-essential.

---

# PHASE 10 — PRODUCT UX SIMPLIFICATION

## Goal

Make the product feel like one intelligent workflow rather than six agents.

Do not redesign the whole app.

Refine the existing interface around user decisions.

## Step 10.1 — Main workflow

The primary user journey should feel like:

```text
Who do you want to sell to?
        ↓
Demaze finds companies
        ↓
Demaze explains why they fit
        ↓
Demaze identifies the right person
        ↓
Demaze prepares evidence-backed outreach
        ↓
User approves
        ↓
Demaze sends
        ↓
Demaze tracks
        ↓
Demaze follows up safely
```

## Step 10.2 — Center the UI around six questions

Every target company should clearly answer:

### Why this company?

Evidence-backed reason.

### Why now?

Recent signal where available.

### Why this problem?

Specific operational issue.

### Why this person?

Role-to-problem relationship.

### Why Demaze?

Relevant Demaze service/capability.

### What supports this?

Evidence and sources.

## Step 10.3 — Evidence display

Use concise cards.

Avoid huge research dumps.

Recommended structure:

```text
Company
Fit score / confidence

Why this company
[2–4 strongest evidence-backed reasons]

Opportunity
[problem + opportunity]

Why this person
[role relationship]

Evidence
[source] [date] [excerpt]

Outreach
[email]

QA
[passed / review required]

Action
[Approve] [Edit] [Reject]
```

## Step 10.4 — Do not hide uncertainty

Use clear labels:

```text
Confirmed evidence
Reasonable inference
Needs review
```

Never present inference as fact.

---

# PHASE 11 — REAL-WORLD PILOT

## Goal

Prove business value.

Do not immediately run hundreds of emails.

## Step 11.1 — Select a small pilot

Use approximately:

```text
20–30 highly relevant prospects
```

selected from a real target market.

## Step 11.2 — Manually inspect every prospect

For the first pilot, verify:

- company
- evidence
- opportunity
- stakeholder
- email
- outreach angle

This is not a failure of automation.

It is how the system is validated before increasing automation.

## Step 11.3 — Track outcomes

At minimum:

```text
sent
delivered
bounce
spam
open
reply
positive reply
meeting
negative reply
unsubscribe
```

## Step 11.4 — Analyze failures

Do not optimize only for open rate.

The key downstream metrics are:

```text
positive reply rate
meeting rate
qualified opportunity rate
```

## Step 11.5 — Identify the bottleneck

Example:

If:

```text
research quality = high
people accuracy = high
email QA = high
delivery = high
reply = low
```

the problem may be:

- wrong ICP
- weak opportunity selection
- poor offer
- weak positioning
- poor timing

Do not automatically blame the email model.

---

# PHASE 12 — FINAL PRODUCTION GATE

Before declaring the system production-ready, verify every category.

## Research

- [ ] Relevant pages are prioritized
- [ ] Wrong-company pages are detected
- [ ] Duplicate pages do not inflate evidence
- [ ] Non-English content works
- [ ] Zero-result failures are visible
- [ ] Evidence is traceable

## Intelligence

- [ ] Signals have evidence
- [ ] Problems have signals/evidence
- [ ] Opportunities have evidence
- [ ] Stakeholder mapping is defensible
- [ ] Confirmed vs inferred is explicit

## People

- [ ] Company identity matches
- [ ] Decision maker belongs to target company
- [ ] Role is relevant
- [ ] Email quality is measured

## Outreach

- [ ] Unsupported claims are blocked
- [ ] Generic personalization is rejected
- [ ] Wrong-stakeholder outreach is blocked
- [ ] Email QA is deterministic enough to audit

## Sending

- [ ] Explicit approval remains mandatory
- [ ] Kill switch works
- [ ] Campaign pause works
- [ ] Suppression works
- [ ] Reply stops follow-up
- [ ] Bounce stops follow-up
- [ ] Unsubscribe suppresses future contact
- [ ] Duplicate sends are impossible under retry
- [ ] Gmail OAuth refresh/re-auth works

## Tracking

- [ ] Every send creates an event
- [ ] State transitions are auditable
- [ ] Follow-ups are idempotent
- [ ] Failures are visible

## Evaluation

- [ ] Regression dataset exists
- [ ] Adversarial dataset exists
- [ ] 100-company dataset exists
- [ ] Metrics are calculated
- [ ] Failures are categorized
- [ ] Results can be compared over time

## Business

- [ ] Small real-world pilot completed
- [ ] Positive reply rate measured
- [ ] Meeting rate measured
- [ ] Major failure modes documented
- [ ] Clear ICP identified
- [ ] Clear product differentiation articulated

---

# 4. Recommended Data Model Additions

Only add these if equivalent structures do not already exist.

## Evidence

```text
id
company_id
source_url
source_title
source_type
excerpt
claim
retrieved_at
published_at
relevance_score
confidence
```

## Signal

```text
id
company_id
description
classification
confidence
evidence_ids
```

## Opportunity

```text
id
company_id
title
problem
demaze_service
classification
confidence
signal_ids
evidence_ids
stakeholder_roles
```

## Pipeline Run

```text
id
company_id
run_type
started_at
completed_at
status
stage_results
warnings
errors
```

## Pipeline Event

```text
id
run_id
stage
event_type
timestamp
duration_ms
status
provider
metadata
```

## Outreach Event

```text
id
campaign_id
company_id
contact_id
event_type
previous_state
new_state
timestamp
metadata
```

Use existing database naming conventions and migration patterns.

---

# 5. Testing Strategy

Every implementation phase must add tests.

## Unit tests

Test:

- relevance scoring
- identity matching
- deduplication
- evidence linking
- claim verification
- stakeholder mapping
- suppression
- state transitions
- idempotency

## Integration tests

Test:

```text
scraper
→ relevance
→ evidence
→ opportunity
```

and:

```text
opportunity
→ person
→ email
→ QA
```

and:

```text
approval
→ send
→ event
→ reply
→ follow-up stop
```

## Regression tests

Every bug discovered must become a permanent regression fixture where practical.

The Lechler/non-English fixture must remain.

## Failure tests

Explicitly test:

- provider timeout
- provider 403
- malformed response
- empty result
- wrong company
- duplicate company
- invalid email
- expired Gmail token
- reply before follow-up
- unsubscribe before follow-up
- retry after successful send
- tracking unavailable
- database timeout

---

# 6. What NOT to Optimize Yet

Do not spend time on:

### More model providers

The current model stack is sufficient for validation.

### Fancy autonomous agents

The system already has enough agent-like stages.

### More scraping providers

Fix retrieval relevance before adding retrieval sources.

### LinkedIn

Permanently excluded.

### Huge database

Not necessary for the current validation phase.

### Massive email volume

Not until deliverability and targeting are proven.

### Cosmetic UI redesign

Only improve UX where it directly improves the decision workflow.

---

# 7. Definition of "Done"

Demaze is not "done" when all six phases have green checkmarks.

Demaze is ready for the next stage when:

```text
A real list of target companies
        ↓
can be processed end-to-end
        ↓
with measurable success/failure at every stage
        ↓
using evidence-backed research
        ↓
with defensible opportunity selection
        ↓
with accurate decision-maker selection
        ↓
with safe email generation
        ↓
with explicit approval before sending
        ↓
with reliable campaign state tracking
        ↓
without duplicate/unsafe follow-ups
        ↓
and produces measurable positive outbound outcomes.
```

---

# 8. Claude Execution Instructions

Claude Code should execute this plan autonomously, but with strict boundaries.

## Before each phase

1. Inspect the relevant existing code.
2. Identify existing abstractions.
3. Reuse them where possible.
4. Run relevant tests.
5. Write down the implementation approach.
6. Implement.
7. Add tests.
8. Run tests.
9. Run build where appropriate.
10. Only then move to the next phase.

## After each phase

Produce a short internal completion report:

```text
PHASE:
STATUS:

Changed:
- ...

Tests:
- ...

Failures:
- ...

New files:
- ...

Database changes:
- ...

External dependencies:
- ...

Known limitations:
- ...

Next phase:
- ...
```

Do not stop merely because a test fails.

Determine whether the failure is:

```text
implementation bug
test bug
environment issue
external provider limitation
pre-existing failure
```

Fix implementation bugs.

Do not hide or weaken tests just to obtain a green result.

---

# 9. Critical Decision Rules for Claude

## Rule 1

If an existing feature works, preserve it.

## Rule 2

If a bug can be fixed deterministically, do not solve it by adding another LLM call.

## Rule 3

If a conclusion cannot be supported by evidence, downgrade it or reject it.

## Rule 4

If external communication could happen accidentally, fail closed.

## Rule 5

If a vendor is blocked by account plan, document the blocker and test the rest of the system without pretending it is verified.

## Rule 6

If a metric does not exist, build measurement before optimization.

## Rule 7

If a feature does not improve reliability, quality, safety, or measurable business outcome, defer it.

## Rule 8

Do not turn every problem into an AI problem.

---

# 10. Final Priority Stack

The entire project should now follow this priority order:

```text
P0 — MUST DO

1. Baseline audit
2. Pipeline observability
3. Scrape relevance
4. Evidence provenance
5. Research/outreach quality gates
6. 100-company evaluation
7. Gmail/auth reliability
8. Deliverability
9. Suppression + kill switch
10. Follow-up state machine hardening


P1 — DO AFTER P0

11. Apollo cost/coverage evaluation
12. UX simplification
13. Real-world 20–30 prospect pilot
14. Outcome analysis
15. ICP refinement
16. Positioning refinement


P2 — ONLY AFTER VALIDATION

17. Additional integrations
18. More sectors
19. More automation
20. Additional data providers
21. Additional AI features
```

---

# 11. The Core Product Thesis

Do not position Demaze as:

> "An AI that writes personalized cold emails."

That is easy to copy.

The stronger thesis is:

> **Demaze explains exactly why a specific company should be contacted, proves the reason with evidence, identifies the relevant decision maker, and turns that evidence into defensible outbound.**

The core chain is:

```text
Company
   ↓
Evidence
   ↓
Operational Signal
   ↓
Problem
   ↓
Opportunity
   ↓
Relevant Stakeholder
   ↓
Evidence-backed Outreach
   ↓
Measured Outcome
```

That chain should become the center of the architecture, evaluation system, UI, and product positioning.

---

# 12. Final Instruction

Start with **PHASE 1**.

Do not start building new features.

Do not skip the baseline.

Do not assume existing functionality is correct simply because tests pass.

The objective is to turn the existing Demaze system into a product that can answer, with evidence and measurable reliability:

> **Why should we contact this company, why now, who should we contact, what should we say, and did it actually work?**

Execute the phases sequentially and keep the implementation grounded in the existing codebase.
