# Demaze AI Outbound Intelligence Platform — Project Context

## What this is
A **Company Intelligence Engine** for Demaze outbound sales — NOT a website
analyzer. Historically also described as "NOT a lead-discovery tool"; as of
the 2026-07-14 scope pivot below, company-level lead discovery (ICP → matching
companies) IS in scope. What's still true: a lead row's buyer is input data,
not something this pipeline determines — a specific named person + title
arrives ALREADY attached where the row came from a Sales Navigator-style
export, and this pipeline never infers or ranks WHO the buyer is. Target
industries: Manufacturing, Automotive, Industrial, SaaS, Financial
Institutions, SMBs.

## SCOPE PIVOT — 2026-07-14: FULL AutoGTM loop now IN SCOPE (contact + send included)
Two explicit product-direction decisions made the same day, in sequence —
recorded as they happened rather than collapsed into one, since the second
one reverses part of the first:

**Decision A (earlier, 2026-07-14):** company-level lead discovery unlocked
(given an ICP, find matching companies), 5-field output schema unlocked.
Buyer/contact discovery and email work were explicitly kept out of scope at
this point.

**Decision B (later same day, supersedes the "still out of scope" line from
Decision A):** after being shown live screenshots of explee.com's actual
AutoGTM product (all 6 phases, run against demazetech.com itself:
research company → explore competitors → define campaigns/ICP → find
potential customers → **find decision makers** → **outreach send**), the
user was asked directly whether phases 5-6 (contact discovery, email
generation+send) should also come into scope, given they're contact/email
work the original 2026-07-10 boundary permanently excluded. Answer: **yes,
the full loop, including send.** This is a full reversal of the original
scope boundary, not just the company-discovery carve-out from Decision A.

**What this means concretely — the target is now Explee's full 6-phase loop:**
1. Research company — **HAVE**, this is the existing 4-step pipeline
2. Explore competitors — not built (Priority 1)
3. Define campaigns / ICP segments — not built (Priority 2). Distinct from
   the existing demoted `company_fit` score in `normalize.ts` (that scores
   "is this company a good lead for Demaze," a single number; this is "who
   does *the researched company* sell to," a set of named segments with
   pain/criteria/example companies) — reconcile, don't build a parallel
   duplicate system
4. Find potential customers (company discovery) — not built (Priority 3)
5. **Find decision makers — NOW IN SCOPE, not built.** Named-contact
   discovery per matched company. Tavily/Serper/Firecrawl (the only search
   infra this repo has) cannot match Explee's shown accuracy/scale here —
   Explee's own homepage claims a 105M+ company / 218M+ Google-Maps-scale
   database. This needs a real people-data API (Apollo/PDL/Proxycurl/Hunter
   or similar) — a new paid vendor dependency, a separate decision (which
   provider, what it costs) before any code gets written
6. **Outreach: personalized email + send — NOW IN SCOPE, not built.**
   Needs real sending infrastructure: domain warming, deliverability/inbox-
   rate management, an actual sending provider, reply handling. This is
   infrastructure and vendor selection, not an LLM prompt — a separate
   architecture decision, not something to wire up opportunistically inside
   another item

**Operational rule for when phase 6 gets built (not a scope note, a standing
safety rule):** once send infrastructure exists, actually sending real
emails to real prospects requires explicit, per-batch user confirmation
every time — same as any other action that sends messages on the user's
behalf. Building the *capability* to send is in scope now; that does not
imply standing authorization to *actually send* once it exists.

**Reference product**: explee.com (AutoGTM) — the full 6-phase loop above is
now the literal target, not just UX inspiration for the front half.

**Priority order** (from the "Development Execution Plan" doc, extended with
phases 5-6 confirmed by Decision B — one deliverable per session, architecture
before implementation, per that doc's own session-management rules):
1. Competitor Discovery Engine — competitors, why they compete, market
   position, differentiators
2. ICP Generator — target-company ICPs with reason/signals/buying indicators
3. Company Discovery Engine — given an ICP, find matching companies
   (search/public-web to start; may need a firmographic API later for
   Explee-level accuracy — not decided yet)
4. Research Quality Framework — scoring methodology for signal/pain-point/
   opportunity/competitor accuracy
5. Research Evaluation Framework — 0-100 objective scoring for future
   benchmarking
6. Market Intelligence Layer — industry trends, growth indicators, market
   challenges, industry shifts
7. Outreach Intelligence Layer — why_contact / why_now / likely_problem /
   recommended_service / conversation_angle. **Already substantially built**
   — see `OutreachIntelligence` in `lib/pipeline/analysis-sections.ts`
   (`trigger/problem/service/opening_angle/why_now`), populated live by the
   prompt in `lib/prompts/analyze-v2.ts` and rendered in `ResearchCard.tsx`.
   Confirm/rename field alignment with this doc's naming, don't rebuild
8. **Decision-maker discovery** (Explee phase 5) — needs a people-data
   vendor decision first, not started
9. **Outreach send** (Explee phase 6) — needs a sending-infra vendor
   decision first, not started

Nothing past item 1 (the existing pipeline) is implemented yet. Items 8-9
specifically cannot start until their vendor questions are answered — that's
its own near-term session, separate from writing any pipeline code.

## Output schema — SUPERSEDED 2026-07-14 (was LOCKED 2026-07-11), matches the sheet's own column names
Original 5 fields, still the core of every report:
- **Company Description**
- **Pain Points**
- **AI Opportunities**
- **Recent News**
- **Personalization Summary**

No buyer/stakeholder field — that's provided as input (name + title, already on
the row), never generated. No email-finding, generation, QA, or send — those
stay permanently out of scope per the boundary below.

This is NOT a chatbot. Output feeds real Demaze sales outreach.

## Scope boundary — SUPERSEDED 2026-07-14 for lead discovery only (was LOCKED 2026-07-10, buyer clarification added 2026-07-11)
The real architecture is:
```
Sales Navigator export (company + named person/title ALREADY attached to the row)
  -> company identified, buyer already decided — NOT built here, NOT our job
  -> Demaze Intelligence Engine        (THIS is what we build)
       find website -> enrich -> find problem -> AI research
  -> [find person's email -> personalized email generation -> QA agent -> send]  (downstream, NOT built here)
```

**Read this paragraph as history, not current rule — see the "SCOPE PIVOT"
section above for what actually holds now.** As originally written: Demaze's
job is exactly four steps: find website -> enrich -> find problem -> AI
research. Everything before that (lead discovery, including WHO the buyer
is — that arrives on the row, never inferred or ranked by us) and everything
after that (finding a person's email, generating a full email, QA'ing it,
sending it) is **permanently out of scope** — not deferred, not "later,"
genuinely not ours to build. Do not add buyer-ranking/contact-selection logic,
email-finding, email-generation, a QA agent, or a send mechanism to this
codebase without an explicit, separate decision to change this scope boundary.
If a future session proposes building toward LinkedIn/Sales-Navigator-style lead
discovery, that's a different business — stop and flag it rather than
proceeding.

**What actually changed 2026-07-14**: first, company-level lead discovery
(ICP → matching companies, search-based) came into scope — this is exactly
the case the last sentence above told a future session to flag, and it was
flagged, and the user made the call to proceed. Then, later the same day
(Decision B in the "SCOPE PIVOT" section above), the user was shown Explee's
full live product and explicitly extended the decision further: buyer/
contact-level discovery AND email-finding/generation/send are now **also in
scope** (as future work, vendor-dependent, not built) — this paragraph's
"UNCHANGED — still permanently out of scope" no longer holds. LinkedIn
scraping/automation specifically stays excluded regardless (see below) — the
reversal is about contact discovery and email/send generally, via
non-LinkedIn sources (a people-data API), not about LinkedIn access.

**LinkedIn**: stays excluded (see `source-prioritizer.ts`'s `isFetchable()`).
Explicitly demoted — LinkedIn support is optional and future-only, and must NOT
drive architecture decisions. We are not trying to replace Sales Navigator.

**Why this matters, concretely** (the "find website -> enrich" part, which IS in
scope): Ador Welding can be researched through public web sources without ever
scraping adorwelding.com — named directors, executive changes, financial
performance, investor-call transcripts, operational pain points, industry
challenges, news coverage, third-party data. Some of this is more valuable for
outreach than anything on the company's own site. This is the actual argument
for investing in enrichment depth, not LinkedIn access.

**Current implementation gaps vs. this vision**:
- `lib/enrichment/` (`web-enricher.ts`, `discovery-engine.ts`,
  `source-prioritizer.ts`) already does real multi-source search (Tavily/Serper →
  investor relations, annual reports, press releases, CEO interviews, news,
  sustainability reports). Its *discovery* stage already runs unconditionally
  whenever search API keys are present — it is NOT purely a scrape-quality
  fallback, only its deeper *recovery* path-probing sub-stage is gated on content
  quality. (Correcting an earlier overstatement of this gap.) Repositioning it to
  a fully parallel, always-on stage is item 2 below — not started yet.
- Public-source category gaps (item 4, not started): no dedicated query template
  for executive-change announcements; investor-call transcripts and financial
  disclosures only surface incidentally, not targeted; government-filings APIs
  (EDGAR/MCA) are a future category, explicitly not being built now.
- ~~`isFetchable()` still skips PDFs entirely~~ **RESOLVED (2026-07-12, Item 3)** —
  PDFs (annual reports / investor presentations, the highest-priority source
  types) are no longer dropped; they route through `pdf-parse` in
  `web-enricher.ts` instead of Firecrawl. See Item 3 in the implementation
  sequence below. Live end-to-end PDF run still pending.

## Why this exists — read this before touching signals/opportunities code
This is not a generic industry classifier. The report is only useful if a Demaze
salesperson reads it and immediately knows: why talk to this company, what pain they
likely have, which Demaze capability fits, who to contact, and what the first message
should say. Everything else (industry label, company size, generic "digital
transformation" tags) is supporting data, not the output.

**Anti-pattern to avoid**: `opportunities: ["Digital transformation"]` for every
manufacturer. That's a schema passing, not a sales-useful signal.

**Target pattern**: evidence -> specific operational problem -> named Demaze
capability -> stakeholder -> outreach angle. Example (Ador Welding — 6 manufacturing
facilities found in evidence):
```yaml
Signal: 6 manufacturing facilities, no unified reporting mentioned
Likely Problem: cross-location production visibility, delayed plant-to-HQ reporting
Demaze Fit: operational dashboards, plant reporting automation, workflow coordination tools
Stakeholder: Plant Ops Head / VP Manufacturing / CTO (not generic "Marketing")
Outreach Angle: "Coordinating reporting across 6 facilities usually means someone is
  still stitching Excel sheets together weekly — worth 15 min to see how that gets automated?"
Confidence: medium (facility count confirmed, reporting gap inferred not confirmed)
```

## Business context: capability map and outreach schema — see the dedicated files
Do NOT use inline business-context content in this file as authoritative anymore.
Two files now hold this, and supersede any earlier inline version here:
- **DEMAZE_CAPABILITY_MAP.md** — the 8 confirmed service lines (ground truth, given
  directly, not inferred), mapped against known delivered work. NOTE: "Virtual CTO /
  Dedicated Team Model" is NOT one of the 8 confirmed services — that was an earlier
  guess from a single proposal's framing and has been removed. Don't reintroduce it.
- **SERVICE_TO_OUTREACH_MAPPING.md** — Evidence -> Disqualifiers -> Likely Pain ->
  Why Demaze -> Threshold -> Outreach Angle for all 8 services, now VALIDATED
  against real scraped data from all 6 benchmark companies (not just
  hypothesis). This is the actual blueprint `generateDeterministicOpportunities()`
  and the challenge engine should target. (No buyer/stakeholder mapping — that's
  input data, see "Output schema" above.)

## Cross-cutting rules from real-data validation — apply these before touching
## signal/opportunity code, they change what "correct" output looks like
1. **Customer-facing evidence != internal pain.** A company's own product/service
   copy (what it sells to ITS customers) must not be scored as evidence of the
   company's own internal operational gap. Real false positives found: Ace
   Pipeline's "Pipeline Integrity Management" (a service Ace sells), A-1 Fence's
   FenSense/Liminal-F products, ATE Group's EcoAxis/SuperAxis™ platform. Reuse the
   evidence-extractor's existing `classifySubject()` distinction between
   `product_capability` and `company_operations`/`company_strategy` — don't
   re-derive this per service in SERVICE_TO_OUTREACH_MAPPING.md.
2. **9th outcome: insufficient evidence.** Not every company clears a "weak"
   threshold on any service (see AS Agri & Aqua). The correct output in that case
   is no forced fit and no forced outreach angle — not a template stretched over
   thin evidence.
3. **Superseded (2026-07-11) — buyer identity is input, not something we generate.**
   Every real lead row (Sales Navigator export) already has a named person and
   title attached — there is no "find/rank/select the buyer" problem for this
   pipeline to solve, and no buyer/contact logic belongs anywhere in it. The
   named-individual evidence extraction this rule used to describe (Ace
   Pipeline's Director Tarun Singh, AITG's Dr. Sunil Deshpande) is still valid as
   general company evidence, but it does not feed a buyer field — there isn't
   one. Do not reintroduce buyer-title inference or "buyer: unconfirmed"-style
   output anywhere.
4. **The real root cause of live zero-signal results (AITG, Ace Pipeline, A-1
   Fence) is a `SIGNAL_PATTERNS` coverage gap, not the subject-classifier floor.**
   Manual read-through of real scrape-cache content found STRONG-qualifying
   evidence for all three that the live pipeline currently extracts 0 signals
   from. Fold these into the Signal library section below — they're confirmed
   present in real sites, not hypothesized categories.

## Sequencing note re: business-context work vs. current engineering work
The scraper fallback chain (Session 1) and classifier activation (Session 2) do NOT
need to wait on business-context work — getting content and correct page selection
is prerequisite regardless of what schema the eventual report uses. Signal
extraction and opportunity generation (Sessions 3-4) target the now-validated
SERVICE_TO_OUTREACH_MAPPING.md schema — see rule 4 above for what needs to happen
in the extractor before that mapping can actually surface live signals.

## Pipeline (in order)
Current implemented pipeline (URL-only input, enrichment as scrape-quality fallback):
```
Company URL
  -> Scraper (multi-tier fallback)
  -> Company identification
  -> CompanyProfile classification
  -> Signal extraction
  -> Challenge generation
  -> Opportunity generation
  -> Validation gate (PASS / WARN / PARTIAL — never hard FAIL)
  -> Final report
```

Target pipeline per the "not a website analyzer" reframe above (NOT yet built —
requires a flexible input/identity-resolution stage and promoting multi-source
research from fallback to parallel first-class stage):
```
Company identity (URL, name, LinkedIn, domain, CRM/Apollo/Clay export)
  -> Identity resolution (canonical company name + domain, however input arrived)
  -> Scraper (multi-tier fallback)      \
  -> Multi-source research (parallel)    } both feed evidence extraction, neither is a fallback for the other
  -> CompanyProfile classification
  -> Signal extraction
  -> Challenge generation
  -> Opportunity generation
  -> Validation gate (PASS / WARN / PARTIAL — never hard FAIL)
  -> Final report
```

## Current architecture facts (do not re-derive, just build on these)
- Business model classification runs through `CompanyProfile`, NOT the old `BusinessModel` type. That migration is done.
- `clusterSignals()` and `generateDeterministicOpportunities()` are active in the pipeline, not dead code.
- Validation stage returns PASS / WARN / FAIL today. Task in flight: add PARTIAL so we never hard-fail when any fallback source returned content.
- `ENRICHMENT_TIMEOUT_MS` is 70000 (raised from 45000 — enrichment reliably completes ~50s).
- LLM JSON responses are fence-stripped (```json ... ``` stripped, first `{` to last `}` extracted) before `JSON.parse()`. Considered fixed — don't re-solve this.

## Known environment gotcha — READ THIS BEFORE DEBUGGING "WHY ISN'T MY FIX WORKING"
The Next.js dev server on Windows does NOT pick up file changes made from a Linux shell
(cross-OS file watcher issue). After any edit to scraper/classifier files, the dev server
must be restarted (`npm run dev`) before the fix is live. If a benchmark run doesn't
reflect a change you just made, restart the server FIRST before assuming the fix is wrong.

## The scraper (root cause of most historical failures)
How it's supposed to work:
1. Firecrawl `mapUrl` -> all URLs on site
2. Score each URL by category (investor=100, corporate=90, manufacturing=85, b2b_services=75, etc.)
3. Select top 15 highest-scoring pages
4. Scrape those 15
5. If insufficient/low-diversity results, probe known B2B paths (`/about/`, `/industries/`, etc.)

Multi-tier fallback chain (target architecture, being implemented):
```
Firecrawl -> fail -> Jina Reader (https://r.jina.ai/<url>, free, no key, renders JS,
             handles Google Sites/Wix/Cloudflare) -> fail -> Tavily Search -> fail -> Direct Fetch
```

## URL classifier — critical bug class
Short keywords (<=3 chars: 'ir', 'sec', 'ai', 'bse', 'nse') were matching as plain
substrings, causing false positives:
- `/barbed-wire.php` contains "ir" (in "w**ir**e") -> was scored investor/100
- `/blog/anti-climb-fence-for-high-security-fencing` contains "sec" (in "**sec**urity") -> was scored investor/100

Fix: short keywords require word-separator boundaries (`/ - _ .`) instead of substring match.
`matchesKeyword()` is the function. **Stale reference corrected (2026-07-12)**:
this used to point at `tests/url-classifier.test.ts` as the place holding the
adversarial matrix — confirmed via search that no such file (or `tests/`
directory at all) existed until this session's `tests/batch-quota-pause.test.ts`
(item 7 verification, see below) became the first real test file in this repo.
The adversarial matrix this note describes was never actually written down as
an automated test — don't assume it exists; write it fresh in `tests/` if
`matchesKeyword()` needs to be touched again, using vitest (now set up).

New category added: `b2b_services` (score 75) for: solutions, services, industries,
industry, application, capabilities, warranty, partner — these previously scored 0.

Probe trigger fires when EITHER:
- Fewer than 4 high-value pages selected (blog-heavy sites), OR
- Fewer than 3 distinct categories in selection (single-category sites, e.g. all-leadership pages)

## Known unfixable-by-keyword-classification cases (need a different approach, not more keywords)
- `.php` URL structures (probe guesses `/products/`, site is `/products.php`)
- Google Sites (nav is plain text, not `<a href>` links — no links to discover at all)
- Sites where key pages have no recognizable URL keyword (`/p1.php`, numeric IDs, custom CMS slugs)
- Planned fix, NOT yet built: anchor-text scoring — score using the link's visible text
  (e.g. `<a href="/p1.php">Warranty</a>` -> "Warranty" signal) in addition to the URL path.
  This reuses data already returned by Firecrawl/Jina mapUrl and should be built into
  `anchor-text-scorer.ts` before inventing more URL-keyword heuristics.

## Benchmark set (current)
Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence Products, ATE Group
(earlier/reference set: Bharat Forge, Muthoot Finance, Chargebee — all currently PASS,
do not regress these)

**Known gap (2026-07-11, not blocking, needs proper fixing later):** the files in
`benchmarks/companies/*.json` no longer match their filenames — `bharat-forge.json`
now holds the AITG spec, `hdfc-bank.json` holds A-1 Fence, `zoho.json` holds ATE
Group. The original 3-company reference set (Bharat Forge, Muthoot Finance,
Chargebee) is NOT in the active `npm run benchmark` run at all — "do not regress
these" above is currently unenforced by automation. Manual spot-check on 2026-07-11
(hand-run via the admin API) found: Bharat Forge and Chargebee classify correctly
(`manufacturer` / `software_saas`, zero conglomerate false-positive risk). **Muthoot
Finance's direct scrape fails entirely** (`successfulUrls: []`, stub content only,
`primary_type: unknown`) — this is a pre-existing, separate scraper-reliability gap
for muthootfinance.com specifically, unrelated to any classifier work, and needs its
own investigation (anti-bot/slow-site/redirect — same diagnostic discipline as A-1
Fence's `fetch failed` below). Fix the filename/content mismatch and re-add real
regression coverage for the reference set before trusting "do not regress" again.

## Company-specific known issues (context for whoever debugs these next)
- **AITG**: superseded (2026-07-11) — the "signals=0, opportunities=0" state
  described below is resolved. Real root causes were, in order: (1) the
  `SIGNAL_PATTERNS` coverage gap (see "second-biggest architectural weakness"
  below, fixed earlier this session), (2) `primary_type`'s cascade bug (fixed
  in two passes — conglomerate, then the 5 other soft categories, see "ATE
  Group" below), (3) the opportunity engine inventing fake services instead of
  using the real 8 (fixed via `service-evidence.ts`, see "Item 5"). AITG now
  correctly resolves `primary_type: manufacturer` and surfaces 1 real,
  evidence-backed opportunity.
- **A-1 Fence**: `fetch failed` — determine if Cloudflare/SSL/slow site/regional block
  before assuming it's fixed by the fallback chain alone.
- **AS Agri & Aqua**: Google Sites URL. URL normalization bug (losing company identity
  by stripping to bare `sites.google.com`) is fixed. Tavily search fallback parser bug
  (`SearchData has no '.data'`, results actually under `.web`) needs verification —
  check this before assuming Google Sites support is done.
- **ATE Group**: root-caused 2026-07-11. Two bugs converged: (1) `evidence-extractor.ts`'s
  `primary_type` if/else cascade checks `conglomerate` FIRST, before `manufacturer`/
  `industrial_vendor` — so ATE's real fabrication/machining evidence lost to a generic
  "diverse sectors" marketing phrase that also fires `conglomerate`. Confirmed the same
  bug silently affects AITG too (masked — benchmark didn't assert on `primary_type`, only
  the boolean flag, which AITG's real manufacturer evidence also satisfies). (2) The
  `manufacturer` regex required direct word-adjacency to plant/facility/unit, missing
  ATE's actual list-style copy ("fabrication, machining, control system design facility").
  Bug 2 is FIXED (2026-07-11) — enumerated-capability-list pattern added, verified against
  live content, `company_type.manufacturer` now correctly `true` for ATE. Also fixed in the
  same pass: bare `\bbank\b` false-positive (was matching "data bank" in a job posting) —
  now excludes data/food/test/word/blood/piggy/river bank compounds, same bug class as the
  historical 'ir'/'sec' URL-classifier substring fix. Bug 1 is FIXED (2026-07-11) —
  `conglomerate` moved to the end of the `primary_type` cascade (checked only when
  nothing more specific matched). Verified: ATE Group now resolves to `primary_type:
  manufacturer` (both the `profile_flag:manufacturer` and new `primary_type` benchmark
  checks pass); Bharat Forge and Chargebee re-verified live post-fix and stay
  `manufacturer` / `software_saas` respectively — zero regression. Muthoot still
  inconclusive due to its unrelated scrape failure (see above).
  **Bug 1 follow-up, same day**: the first fix was incomplete — only reordered
  `conglomerate`, leaving `financial_institution`/`pharma_biotech`/
  `healthcare_provider`/`logistics_operator`/`retailer` still checked BEFORE
  `manufacturer`/`industrial_vendor`/`services_provider`, i.e. the exact same bug
  class, just uncaught in the first pass. Surfaced when AITG showed
  `primary_type: healthcare_provider` in a later run — traced to a genuine
  founder-history anecdote ("Nanasaheb chanced upon many imported hospital
  equipment lying unused") on AITG's own about page, real content, not a scraper
  error. A-1 Fence Products had the identical bug via its own CSR section
  ("...rural development, water and sanitation, **healthcare services**. ##
  CSR INITIATIVES...") — a fencing company listing healthcare as a corporate-
  giving cause, misread as its business line. Checked before implementing: no
  benchmark company correctly depends on any of these 5 categories winning
  today. Bharat Forge (reference set) had a spurious `retailer` match in
  historical runs that could have silently mislabeled it under the old order;
  Muthoot Finance (reference set, genuinely a financial institution) has zero
  competing manufacturer/industrial_vendor/services_provider evidence so the
  reorder doesn't change its outcome. **Fixed**: all 5 soft categories moved
  after the operational categories, same principle as conglomerate.
  `software_saas` stays first — its patterns are multi-word/specific
  ("software-as-a-service", "subscription billing platform"), not this bug
  class. Verified: AITG and A-1 Fence Products both now resolve to
  `primary_type: manufacturer` (confirmed the actual label, not just "doesn't
  say healthcare_provider" — `company_type.healthcare_provider` still
  legitimately fires as a boolean, it just no longer wins the primary_type
  cascade). Full benchmark re-run clean, no regressions.
- **Ace Pipeline**: classified as conglomerate — same Bug 1 above, but unlike ATE/AITG,
  NOTHING else fires for Ace Pipeline's scraped content (no manufacturer/industrial_vendor
  evidence at all), so we genuinely don't know its correct classification yet. Do not
  assume "manufacturer" — needs its own content review before assigning an
  `expectedPrimaryType` in the benchmark spec (deliberately left unset in
  `acepipeline.json`, unlike the other 5 companies).
- **Scraper flakiness observed 2026-07-11**: re-running AITG and A-1 Fence back-to-back
  produced different `successfulUrls` sets between runs — one run's Firecrawl `mapUrl`
  discovery returned nothing (`discoveryMethod: 'homepage_only'`, `urlsSelectedForScraping:
  []`), falling back to a generic probe (`/about`, `/about-us`, `/company`, `/products`,
  `/services`) that missed the actual evidence-bearing pages found on other runs. This is
  the existing documented scraper-reliability gap manifesting concretely, not a new bug —
  don't diagnose a `manufacturer`/`primary_type` FAIL as a classifier regression without
  retrying first (same discipline as the LLM JSON-malformation lesson below).

## The second-biggest architectural weakness (after scraping): companySubjectCount=0
When this fires: 0 subjects -> 0 signals -> 0 opportunities -> WARN/FAIL. IMPORTANT
CORRECTION from real-data validation: for AITG specifically, this was mis-diagnosed
as a subject-classifier problem. Manual read-through of real scrape-cache content
found STRONG-qualifying evidence the pipeline should have caught — the actual gap is
in `SIGNAL_PATTERNS` regex coverage (see below), not subject classification. Keep
the subject-classifier floor fix (it's still needed for genuinely thin sites like
AS Agri & Aqua), but don't assume it alone fixes AITG-shaped failures.

## Signal library — CONFIRMED gaps from real-data validation (supersedes the
## earlier guessed category list below it)
Manual read-through of real scrape-cache content for Ace Pipeline, Ador Welding,
AITG, and A-1 Fence found these evidence categories present and high-quality, with
ZERO pattern coverage in `SIGNAL_PATTERNS` today:
1. **Named ERP/CRM tools embedded in job postings** — e.g. AITG job listings
   requiring "SAP MM," "SAP FICO" as mandatory skills. Directly evidences the
   "AI integrations and intelligent automation" service (see
   SERVICE_TO_OUTREACH_MAPPING.md #8) — confirms existing ERP with no AI layer on top.
2. **Job-posting task/responsibility bullet lists as workflow evidence** — ATE
   Group's entire BOQ->procurement->compliance chain came from a job listing, not
   marketing copy. Treat job postings as a Tier-1-quality structured source, not
   just a hiring-signal indicator.
3. **Training/workshop/consultant-engagement mentions as an indirect pain signal**
   — AITG's cross-company data-interpretation workshop with an external consultant
   is near-explicit first-hand pain language.
4. **Named individual + explicit stated portfolio** — e.g. "Director, Bid Strategy,
   Business Development and New Technology/Innovation" is strong general company
   evidence (leadership structure, strategic focus areas). This does NOT feed a
   buyer field — buyer identity is input data, not generated (see "Output schema"
   and "Cross-cutting rules" #3 above). Never trust a URL-derived name without
   confirming against rendered content — ATE Group's own site has a live bug
   where a URL slug doesn't match the rendered name.

Original guessed categories (lower priority than the 4 above — add only after
the confirmed gaps are addressed, since these were hypothesis, not validated):
multi-location operations, distribution complexity, vendor ecosystem, product
diversification, industrial partnerships.

## Global disqualifier — validated, high priority
Evidence describing what a company SELLS to its own customers must not be scored
as evidence of that company's own internal operational gap. Real false positives
found: Ace Pipeline's "Pipeline Integrity Management" (sold to clients, not Ace's
internal process), A-1 Fence's FenSense/Liminal-F products, ATE Group's EcoAxis/
SuperAxis™ platform. Reuse the existing `classifySubject()` distinction between
`product_capability` and `company_operations`/`company_strategy` rather than
building new per-service logic for this — see SERVICE_TO_OUTREACH_MAPPING.md Rule 1.

## classifySubject() — confirmed 'about' vs 'other' pageType asymmetry (investigated, not fixed)
Two separate mechanisms exist. The vendor-aware rule (fires for `industrial_vendor:
true` companies) is already symmetric across 'about'/'other' — not the issue. The
generic third-person rule (built originally for enrichment/search content, matching
"the company/the group/the firm") is scoped to `pageType === 'other'` only — this IS
the asymmetry, confirmed as an oversight (no evidence 'about' was deliberately excluded).

**Measured impact (diagnostic pass, all 6 benchmark companies)**: 2 of 6 affected —
AITG (1 evidence snippet) and A-1 Fence (3 snippets, 2 duplicate). Ace Pipeline, AS
Agri, ATE Group, Ador Welding unaffected (Ador's evidence happens to already work via
an unrelated bug, see below).

**Important negative result**: widening the pageType condition ALONE rescues zero
new evidence — both affected companies use their own literal name in third person
("A-1 Fence's operations...", "Companies under AITG...") not the generic "the
company/group/firm" pattern. The bottleneck is the pattern, not the pageType scope.

**If this gets fixed** (thread company name into `classifySubject()` so it can
recognize third-person self-reference by name): scope it to `'about'` pages ONLY,
never `'other'`/enrichment content — this avoids the two biggest false-positive
risks (third-party/negative mentions, partner/competitor bleed-through) entirely,
since those only apply to external content. Reuse the URL-classifier's word-boundary
matching approach for the name match itself (same bug class as 'ir' matching inside
"wire" — a short/generic company name would collide the same way via naive substring
match). Source the company name from whatever the pipeline's company-identification
stage already resolved — do not derive it fresh a second time.

Separately, low-risk, no design decision needed: A-1 Fence's "We offer end-to-end
support..." evidence is stuck because "offer" isn't in the recognized first-person
verb list — just add it.

**Priority note**: this fix rescues 4 evidence snippets across 2 companies. The
confirmed SIGNAL_PATTERNS gaps above (job-posting ERP mentions, job-posting task
lists, training/workshop mentions) affect more companies with stronger evidence per
company. Sequence this behind those unless it's cheap to fold into the same session.

## Known, deliberately deferred bug — do NOT fix opportunistically
`detectPageType()` receives the full URL (e.g. `https://adorwelding.com`) instead of
a bare path, so the homepage regex never matches — homepages get mislabeled
`pageType: 'other'` instead of `'homepage'`. This is currently *accidentally helpful*:
Ador Welding's homepage evidence gets correctly classified only because it qualifies
for the `'other'`-scoped third-person rule. Fixing the mislabeling naively would be a
REGRESSION for Ador Welding, because `pageType === 'homepage'` hits an unconditional
`return 'generic_marketing'` a few lines later. Do not fix either half of this in
isolation — needs a dedicated session that fixes both the URL-path bug AND the
unconditional homepage->generic_marketing return together, or benchmark regressions
will follow.

## Model quality verdict — DO NOT relitigate this
Evaluated whether model quality is the bottleneck. Conclusion: no.
Estimated impact: architecture fixes ~+30%, model upgrade ~+5-10%.
Current open/free models (DeepSeek, GLM, Qwen, Llama) are sufficient.
Failures are scraping, classification, signals, timeouts, parsing — not reasoning quality.

## DO NOT WORK ON RIGHT NOW
- More model changes
- More classifier tweaking beyond the specific fixes listed above
- More regexes as a first resort, EXCEPT the 4 confirmed SIGNAL_PATTERNS gaps
  above — those are validated against real data, not speculative, and are now the
  highest-priority signal-extraction work
- **Email-finding, generation, QA, or send implementation** — in scope as of
  the 2026-07-14 "SCOPE PIVOT" Decision B, but blocked on a sending-infra
  vendor decision (domain warming, deliverability, sending provider) that
  hasn't happened yet. Don't wire up a send mechanism opportunistically
  inside another item — it needs its own architecture session
- **Decision-maker/contact discovery implementation** — also in scope as of
  Decision B, but blocked on a people-data vendor decision (Apollo/PDL/
  Proxycurl/Hunter or similar) that hasn't happened yet, same reasoning
- **LinkedIn-driven architecture decisions**. LinkedIn scraping/automation
  stays excluded regardless of the above — contact discovery should go
  through a people-data API, not LinkedIn
- Government-filings APIs (EDGAR/MCA) — logged as a future source category
  (item 4's scope note), not being built now.
- RESOLVED (2026-07-10): the "more enrichment work — needs an explicit decision"
  note that used to be here is resolved. The decision was made: enrichment gets
  repositioned to a parallel, always-on stage (item 2), new source categories get
  added (item 4), PDF handling gets fixed (item 3). Work order and status are
  tracked in "Implementation sequence" below.

## Implementation sequence — CURRENT (2026-07-10), supersedes any earlier version
## of this section. One item per session, benchmark after each, CLAUDE.md updated
## in the same commit as any code change.

**Decision 1 (done)**: scope boundary locked — see "Scope boundary" section above.

**Decision 2 (done)** — removals/deprioritizations:
- `business-model-classifier.ts` retirement: **deferred**. Verified 3 real
  consumers before deciding: `normalize.ts` (functional — `classifyBusinessModel()`,
  `getBusinessModelProfile()`, `filterSignalsForBusinessModel()`; `strategic_challenges`
  in the live API response comes directly from `modelProfile.strategic_challenges`;
  `filterSignalsForBusinessModel()` actively suppresses false-positive detected_factors,
  e.g. `industry_40_initiative` for SaaS), plus `signal-clustering.ts` and
  `opportunity-engine.ts` (type-only imports of `BusinessModelType`). Do not remove
  this file without replacing what `strategic_challenges` reads from.
- `company_fit` / ICP scoring: **demoted, not removed**. Verified it feeds
  `outreach_priority_score`'s weighting formula (`normalize.ts`, 35% weight) but
  found no code path that skips/gates any pipeline stage based on its value —
  there was nothing to un-gate. Stays as informational-only output by design;
  leads arrive pre-qualified from upstream, so a low fit score should never skip
  research.
- `icp_score_modifier` field on `business-model-classifier.ts`'s PROFILES table:
  **deleted**. Verified it was never read anywhere outside its own definition —
  genuinely dead code, not wired to anything (including `company_fit`).
- Admin UI (`app/admin/*`): stays as-is. It's the testing harness, not the
  production flow. No further investment planned.

**Item 1 (done)** — company-name -> website discovery. **Scope narrowed
(2026-07-11): this ONLY runs when a company has NO website listed at all.** If a
lead row has a website given, trust it as-is and scrape it directly — no
verification against alternates, no reconciling conflicting values even if the
input data itself has more than one website for the same company (that's a
data-quality problem for whoever maintains the lead list, not ours to solve).
Website-conflict resolution was considered and explicitly rejected as
out-of-scope — do not build it. The code already matches this narrow scope
(`route.ts`: discovery only runs `if (!url && rawCompanyName)`) — this note just
makes the intended scope explicit in docs.
- New: `lib/enrichment/website-discovery.ts` — `discoverCompanyWebsite(companyName, knownDomain?)`.
  Content-based verification only (word-boundary match of the company's
  significant name-words against the candidate homepage's title/description/body
  — NOT URL/domain string similarity, same principle as `matchesKeyword()` and
  `classifySubject()`'s word-boundary fixes). Confidence tiers: high (full name
  match in title) / medium (partial title match or full match in
  description/body) / none. Two candidates tied at the same confidence tier ->
  `status: 'ambiguous'`, never silently pick one.
- Changed: `discovery-engine.ts` exports `searchTavily`/`searchSerper` for reuse;
  fixed a real bug found while wiring this up — `r.url.includes(domain)` with an
  empty `domain` is always `true` in JS (empty string is a substring of every
  string), which would have silently excluded 100% of search results the moment
  company-name-only input reached enrichment. Now guarded (`domain &&
  r.url.includes(domain)`).
- Changed: `route.ts` accepts `companyName` in the request body alongside `url`.
  When only a name is given, discovery runs first; `'confirmed'` proceeds through
  the normal scrape pipeline; `'ambiguous'`/`'not_found'` skips scraping entirely
  and reuses the existing empty-scrape stub-injection path (same code path a
  website that fails to scrape already goes through) so enrichment becomes the
  primary source — no new degradation logic needed, the graceful-degradation
  infrastructure built earlier this session already covered this case.
- Changed: `web-enricher.ts`'s recovery-path probing is skipped entirely when
  `domain` is empty (no domain to build probe URLs against).
- Run-history logging: new `website_discovery` JSONB column
  (`supabase/migrations/004_website_discovery.sql`), wired through
  `test-runs/route.ts` and the admin UI's `saveRun()`. **Migration applied
  2026-07-11 (item 0.7)** — user ran it directly in the Supabase dashboard.
  Verified end-to-end: `pipeline_test_runs` table existed already (002 was
  applied earlier), the missing `website_discovery` column was the sole cause
  of every run-save failing (the insert unconditionally references it), a real
  POST to `/api/admin/test-runs` with `website_discovery` populated now
  succeeds, test row deleted after verification.
- Validated against the 6 known benchmark company names (ground-truth check:
  already know the correct domain for each) plus 3 deliberately hard cases
  (generic name, small/weak-web-presence name). Results were genuinely mixed,
  not a clean sweep, and that's consistent with this session's "prefer under-
  confidence" design philosophy: 2/6 clean high-confidence passes, 2/6 correctly
  refused as `'ambiguous'` (Ace Pipeline: acepipeline.com vs .co.in both matched
  high-confidence; AITG: aitg.co vs .com) rather than guessing, 2/6 honest
  `'not_found'` (AS Agri and Aqua — Google Sites URLs collapse to bare
  `sites.google.com` once reduced to hostname, a known limitation, not yet
  fixed; ATE Group — the real domain wasn't surfaced by the search queries used).
  Hard cases: "Om Enterprises" correctly came back `'ambiguous'` (4 plausible
  domains); "Shree Balaji Fabricators" correctly downgraded to `'medium'`
  confidence rather than a false high (real title says "...Enterprises Pune",
  not "Fabricators" — partial word match, scored accordingly).
- **Found and fixed during end-to-end testing**: Tavily's monthly quota was
  exhausted mid-session (HTTP 432, confirmed by a direct curl against Tavily's
  API — "This request exceeds your plan's set usage limit"), which made
  discovery silently return `not_found` for a company (Ador Welding) that had
  correctly resolved earlier in the same session. `searchCandidateDomains()`
  had the same "prefer Tavily unconditionally, only use Serper if the Tavily
  key is absent" shape as `discoverEvidenceSources()` in `discovery-engine.ts`
  — neither falls back to Serper when Tavily's call *fails* (as opposed to not
  being configured). Fixed in `website-discovery.ts` only (new
  `searchWithFallback()` — falls back to Serper per-query when Tavily returns
  zero results). **Stale note removed (2026-07-12)**: this used to say
  `discovery-engine.ts` had the identical gap and was NOT touched. Re-checked
  while working item 2 — `discoverEvidenceSources()` in `discovery-engine.ts`
  already has the same per-query Tavily→Serper fallback
  (`if (raw.length === 0 && serperKey) { raw = await searchSerper(...) }`).
  Someone fixed it since this note was written; the note just never got
  updated. No code change needed here. Re-verified end-to-end after the
  original fix: Ador Welding
  resolves correctly via the Serper fallback, hits the existing scrape cache,
  produces real signals, `evidence_sufficiency: sufficient`. Also re-verified
  the ambiguous path end-to-end ("Om Enterprises" -> `domain: null`,
  `scrapeSource: 'none'`, pipeline completes with `success: true`,
  `evidence_sufficiency: insufficient` — no crash, no hard fail, honest output).
- **Real false positive found and fixed via post-commit live testing** (once
  Tavily's quota ran out, re-tested all 6 benchmark companies via the Serper
  fallback path — this incidentally became a full regression pass): "AITG"
  wrongly resolved to `aitg.miraheze.org` (an unrelated wiki) at `'confirmed'`/
  `'medium'` confidence, because "AITG" normalizes to a single significant
  word (acronym-shaped) and a body-text-only match trivially satisfies
  ratio=1 for a 1-word name, with no competing candidate to trigger ambiguity
  detection. This was a known, explicitly-flagged limitation in the original
  design ("single-word names, ratio can only be 0 or 1") that manifested for
  real. **Fixed**: single-word company names now require an actual title
  match to reach any confidence above `'none'` — a body/description-only
  match is no longer sufficient to auto-confirm. Verified: AITG now correctly
  returns `'not_found'`; Ador Welding (title match, 2 words) and A-1 Fence
  Products (body match, 3 words) both unaffected — the fix is scoped to
  single-word names only, not medium-confidence matches generally.
- **Genuine real-world ambiguity found in the same re-test, not a bug**:
  "A-1 Fence Products" (our benchmark company, India,
  a-1fenceproducts.com) ties at medium confidence against "A-1 Fence
  Company" — a real, different company in Anaheim, CA (a1fence.com).
  Correctly returned `'ambiguous'` rather than guessing. Validates the
  disambiguation design against a real same-name collision, not just the
  synthetic "Om Enterprises" test case.
- **Separately noted, not yet fixed**: for ATE Group, Serper *did* surface the
  correct domain (ategroup.com) as a candidate, but the lightweight `fetch()`
  verification step failed to retrieve its content ("homepage fetch failed or
  timed out"), so it scored `'none'` and the request correctly (but not
  optimally) fell through to `'not_found'`. The plain `fetch()` used for
  candidate verification is less robust than Firecrawl (used elsewhere in the
  pipeline) against sites with anti-bot protection or slow responses. Safe
  failure mode (no wrong guess), but a real precision gap worth revisiting —
  not blocking, noted for a future pass.

**Item 2 (done 2026-07-12)** — enrichment discovery+fetch repositioned from
"starts after scrape finishes" to genuinely parallel with scrape. Root
finding before touching code: the framing in this doc's earlier text
("implicit-fallback") was already stale — discovery already ran
unconditionally whenever search keys were present (correctly noted above).
The real gap was purely a *sequencing* one: `enrichCompanyIntelligence()` in
`lib/enrichment/web-enricher.ts` bundled 4 internal stages (discover →
prioritize → fetch → recovery) into one function that only got *called*
after the website scrape finished in `app/api/admin/test-analysis/route.ts`
— even though stages 1-3 need only `domain` + a company-name guess, both
already known before scraping starts. Only stage 4 (recovery path-probing)
genuinely needs scrape output (`isConsumerSite`, content-quality).
Split `web-enricher.ts`'s monolithic function into two exports —
`discoverAndFetchExternalSources(domain, companyName)` (stages 1-3, no scrape
dependency) and the now-exported `probeRecoveryPaths()` (stage 4, unchanged
body) — plus a pure `buildEnrichmentResult(...)` assembler so the final
`EnrichmentResult` shape everything downstream depends on
(`.sources_used`, `.enriched_context`, `.recovery_paths_probed`, etc.) is
byte-for-byte identical to before, just assembled from pieces computed at
different times. Confirmed via grep that `enrichCompanyIntelligence` and
`EnrichmentOptions` were referenced nowhere outside these two files — both
removed outright rather than left as dead code. In route.ts: a
`discoverAndFetchExternalSources()` call is now kicked off (not awaited)
immediately after `domain` is resolved, before Stage 1 SCRAPE even begins —
new `guessCompanyNameFromDomain()` helper (same domain-prettification regex
already used for empty-scrape stub injection, now shared instead of
duplicated) supplies the pre-scrape name guess when the caller didn't
already give one. The existing soft-timeout (8s) / hard-timeout (70s) /
late-arrival race machinery in route.ts — verified working correctly earlier
this session in the live batch-upload test — was **not touched at all**;
only what runs *inside* the raced promise changed (it now awaits the
already-in-flight discovery promise instead of starting a fresh sequential
call). `detectConsumerSite` was being imported into route.ts but never
called (dead import, an artifact of the old code structure where it only
ran inside `enrichCompanyIntelligence`) — now genuinely called, since
route.ts computes `isConsumerSite` itself to decide on recovery.
Accepted trade-off, not fixed further: the pre-scrape company-name guess is
lower-precision than the post-scrape, title-derived `companyNameFromScrape`
(kept unchanged for everything else that already used it — signal
extraction's self-reference matching, final report naming). Not worth the
complexity of re-running discovery once a better name is known.
**Verified**: `tsc --noEmit` clean, all 17 `vitest` assertions still pass
(unaffected file, confirmed anyway). Two cached-scrape correctness runs
(A-1 Fence Products, AITG) — zero quota cost, scrape returns near-instantly
from cache so this doesn't exercise the overlap, but confirms
`EnrichmentResult` assembly, all 7 pipeline gates, and final report quality
are unchanged (`SCRAPE/PROFILE/SIGNAL/ENRICHMENT/LLM_PARSE/NORMALIZATION`
all `PASS`, same as pre-refactor). Live dev-server pass over
`/admin/intelligence-lab` — no console/server errors. **Latency win directly
measured** with one FORCE_FRESH run against Ador Welding (this doc's own
reference case for this item, real API quota spent with explicit
confirmation first): scrape took 45,563ms (real-world failure chain —
homepage timeout, Jina timeout, search-fallback bug — an existing, separate,
unrelated issue, not caused by or fixed in this item). Discovery+fetch took
19,622ms total and — because it started before scrape instead of after —
had **already fully resolved by the time scrape finished**, logged as
`"already resolved before scrape finished (45563ms), fully overlapped, zero
added wait"`. Knock-on quality win beyond speed: because enrichment was
already done, it reached the LLM's *first* prompt attempt
(`prompt_enriched=true`, enrichment wait `3ms`) instead of arriving "late"
(post-prompt, re-extraction-only) — on the old sequential timing, a scrape
this slow would have blown well past the 8s soft-timeout and missed the
initial prompt entirely. Total pipeline time: 71,904ms. Under the old
sequential design this same run would have been roughly scrape (45.6s) +
discovery+fetch (19.6s, now would run sequentially after) + LLM (26.2s) ≈
91.5s — a measured ~20s / ~22% reduction, entirely attributable to the
overlap, on top of the enriched-first-prompt quality improvement. All other
gate outcomes for this run (`SCRAPE:WARN` ×2, `PROFILE:WARN`, `SIGNAL:WARN`,
0 opportunities surviving normalization) are pre-existing, separate, known
behavior — Ador Welding's real scrape failure chain and the "insufficient
evidence -> no forced opportunities" outcome are both already-documented,
correct pipeline behavior, not something this item touched or regressed.

**Item 3 (done 2026-07-12, code + unit tests; live PDF run pending)** — fixed
the PDF drop. Root shape confirmed before touching code: `isFetchable()` in
`source-prioritizer.ts` was the *only* real `.pdf` gate (the
`discovery-engine.ts:215` comment claimed a PDF skip the code never did — both
comments now corrected). The three highest-value `very_high` source types
(`annual_report`/`investor_presentation`/`earnings_release`) are the `mustHave`
Pass-1 selections AND disproportionately PDF-published, so the gate was silently
discarding exactly the evidence enrichment exists to capture.
- `isFetchable()`: removed the `.pdf` early-return (LinkedIn/Glassdoor skips
  kept). PDFs now survive prioritization and compete for the 5 fetch slots.
- `web-enricher.ts`: PDFs no longer go through Firecrawl (unreliable markdown
  conversion is *why* they were excluded). New route: `isPdfUrl()` (pure,
  query/fragment-tolerant extension check) → `fetchPdfText()` (plain `fetch()`
  with a 15s `AbortController` timeout, content-type + 10 MB size guards) →
  `extractPdfText()` (pure, no-I/O, `pdf-parse` v2 `PDFParse`
  → `getText()` → `destroy()` in try/finally). Both `extractPdfText` and
  `isPdfUrl` are exported specifically so they're unit-testable without network.
  New dispatcher `fetchSourceContent(url)` routes `.pdf` → `fetchPdfText`, else →
  `fetchWithFirecrawl`; both `fetchPrioritizedSources()` and
  `probeRecoveryPaths()` now call it. Text cap stays 6000 → `formatSourceBlock`
  5500, so `enriched_context` assembly is byte-identical in shape. `null`-on-any-
  failure contract preserved, so the existing snippet-fallback path is unchanged.
- **Known simplification (not a bug):** large annual-report PDFs are truncated to
  their first 6000 chars like every other source — no smart section extraction.
  That's a possible future refinement, deliberately not built now.
- **pdf-parse v2 note:** it's the `PDFParse` *class* API
  (`new PDFParse({ data: buffer })`), NOT the classic `pdf(buffer)` default
  function — `@types/pdf-parse@1.x` typings in package.json are stale for this.
  Same call pattern already proven in `lib/batch/file-parser.ts`.
- **Verified:** `tsc --noEmit` clean; `npm test` green (27 = 17 existing + 10 new
  in `tests/enrichment-pdf.test.ts`, covering `isPdfUrl` routing incl. the
  mid-path-"pdf" false-positive guard + `extractPdfText` against a committed
  `tests/fixtures/sample.pdf` and graceful `null` on garbage/empty buffers).
- **NOT yet done — needs a live run** (deferred to a quota-spending session with
  explicit confirmation): prove a real annual-report PDF that was previously
  dropped now fetches, parses, and lands in `enriched_context` end-to-end, plus a
  cached-scrape regression check that gate outcomes are unchanged. Windows
  dev-server-restart gotcha applies before that run.

**Item 4 (not started)** — add executive-change-announcement query template +
dedicated investor-call-transcript/filings targeting pass. Explicitly skip
government-filings APIs (EDGAR/MCA) — logged as a future category, not built.

**Item 5 (done 2026-07-11)** — `generateDeterministicOpportunities()` rebuilt
against the 8 confirmed services. Root cause of the old fake-opportunity bug:
`normalize.ts` builds the final `opportunities` array EXCLUSIVELY from
`deterministic_opportunities` — the LLM only enriches a matching title, and any
LLM-only title that doesn't match a catalog entry is discarded. So "Predictive
Maintenance AI"/"Production Optimization AI" weren't LLM hallucinations, they
were literal entries in the old `OPPORTUNITY_CATALOG` (~20 invented, never-real
services). The old catalog's trigger mechanism (`signal-clustering.ts`'s
clusters, built from generic `detected_factors` like `growth_signal`/
`ai_mention`) doesn't map onto what the 8 real services need as evidence at
all — new file `lib/pipeline/service-evidence.ts` replaces it with direct
regex-based Evidence/Disqualifier/Threshold detection per service, run against
raw content, matching SERVICE_TO_OUTREACH_MAPPING.md's spec exactly. Threshold
is a real gate: 'weak' matches are computed (kept in the evidence trail for
debugging) but never surface in the report — only 'medium'/'strong' do,
specifically to avoid recreating the generic "Digital Transformation for
everyone" anti-pattern via boilerplate weak-tier matches (confirmed a real risk
during design: ATE Group's "trusted partner to the Indian textile industry"
marketing copy would have false-positived "Marketplace platforms" at weak tier
— correctly suppressed). No cap on qualifying services — a company clearing 2+
services shows all of them, ranked by evidence strength, not forced to one.
Two disqualifiers from the doc are explicitly NOT enforced (flagged in code
comments, not silently dropped): "very small company/team" thresholds (10/15
employees) aren't reliably present in typical scraped prose.
**Verified**: AITG now surfaces exactly 1 real opportunity (`AI integrations and
intelligent automation`, evidence = named "SAP (MM)" module in a job posting,
threshold=medium) instead of the old invented titles. Pressure-tested against
all 6 benchmark companies' real content — no false positives found at
medium/strong tier; Ace Pipeline and AS Agri correctly surface zero
opportunities (genuinely thin real evidence, not a detection gap — verified by
hand against their actual scraped content). `min_opportunities` benchmark
checks now show WARN more often than before — this is expected: the old system
always found ~7 because it invented them, the new one only surfaces real
evidence. Since `min_opportunities` is WARN-severity not a hard gate, this
isn't a regression, it's the new system being honest about thinner cases.

**Item 6 (done 2026-07-11)** — buyer/contact-field removal completed in code,
not just docs. The "Output schema" lock (2026-07-11) removed buyer/stakeholder
fields from the spec; this pass finished removing them from the actual
pipeline: `recommended_contacts`, `recommended_contact_roles`,
`recommended_contact_roles` fallback from `modelProfile.default_target_buyers`,
`target_buyer`, `target_contact`, `who_to_contact`, `target_contacts`, and the
synthesis-layer `OutreachCard`/`outreachCards` concept (its own file,
`lib/synthesis/outreach-engine.ts`, deleted) removed from
`lib/pipeline/normalize.ts`, `lib/prompts/analyze-v2.ts`,
`lib/prompts/system-v2.ts`, `lib/synthesis/types.ts`, `lib/synthesis/index.ts`,
and the admin UI (`intelligence-lab/page.tsx`). Old v1 prompt files
(`lib/prompts/analyze.ts`, `schema.ts`, `system.ts` — pre-dated the `-v2` files
and were never fully retired) deleted outright; their two still-used helpers
(`formatScrapedPages`, `estimateTokenCount`) extracted into a new
`lib/prompts/scrape-utils.ts` first so `scraper.ts` and `test-scraper/route.ts`
keep working. Verified via `tsc --noEmit` (clean) and a live dev-server pass
over all three admin pages — no dangling imports, no console/server errors.

**Item 7 (done 2026-07-11)** — batch lead-list upload, the first concrete piece
of the "flexible input" half of the target pipeline (see "Pipeline" section
above — company identity can now arrive as a file, not just a single URL).
New `/admin/batch-upload` page: upload an xlsx/csv/docx/pdf lead-list export ->
`lib/batch/file-parser.ts` parses it into `LeadRow[]` (header-aliasing column
detection, three-tier graceful degradation: file-level / structure-level /
row-level — never a hard crash on a malformed row) -> `lib/batch/company-dedup.ts`
collapses multi-contact-per-company rows into one entry per company (tiered
domain/exact-name/acronym-squash matching, same word-boundary discipline as
`website-discovery.ts`; anything weaker is flagged `possibleDuplicateOf` for
manual review, never silently auto-merged) -> user selects which companies to
research -> existing 4-step pipeline runs **sequentially, one company at a
time by design** (batch-level parallelism was considered and rejected given
real Firecrawl/Tavily quota limits already hit live this session) via the
existing `/api/admin/test-analysis` endpoint (`mode: 'lightweight'`) -> each
completed result is persisted to run-history immediately as it finishes, so a
closed tab mid-batch never loses already-completed (already-paid-for)
research. Includes consecutive-quota-hit detection (3 companies in a row
matching a known Firecrawl/Tavily/rate-limit error signature) that pauses the
batch with an explainable message rather than burning through the rest of the
queue against an exhausted quota. `ResearchCard` (the SDR-facing single-result
view) extracted out of `intelligence-lab/page.tsx` into its own component file
so both pages render results identically. New API route
`/api/admin/batch-parse` (parse + dedupe only, no research — kept separate
from the research loop, which reuses `test-analysis` rather than duplicating
pipeline-invocation logic). New deps: `exceljs`, `papaparse`, `mammoth`,
`pdf-parse` (parsing), `docx` (devDependency, unused by this feature — check
before assuming it's wired up if referenced elsewhere later).
Verified: parse+dedupe tested end-to-end against a real generated xlsx fixture
(4 companies with deliberately similar names to exercise the
`possibleDuplicateOf` partial-match path — correctly flagged, not
auto-merged). `tsc --noEmit` clean. All three admin pages load with no
console/server errors on a live dev-server pass.

**"Research Selected" sequential loop — genuinely re-verified 2026-07-12**
(superseding the "manually exercised in a prior session, not re-verified"
note this replaced). Real browser test, real API calls, no mocking: 3
already-benchmarked companies (A-1 Fence Products, AITG, AS Agri & Aqua) run
through the actual button click (file input driven via native
File/DataTransfer injection since the available browser tool couldn't drive
an OS file picker — this still fires React's real `onChange` handler, not a
shortcut around it). Confirmed by direct observation, not inference: progress
indicator advanced correctly ("Researching 1 of 3" -> "2 of 3" -> "3 of 3",
current-company name updated each step), each row's status flipped
pending -> running -> done in the UI as the corresponding
`POST /api/admin/test-analysis` calls completed server-side (matched against
live server logs), each completed result persisted to run-history
immediately (`POST /api/admin/test-runs 200` fired after each company, not
batched at the end) — confirmed independently by checking run-history's count
(21 -> 24) and seeing all 3 new entries at the top with timestamps/domains/
durations matching what was observed live. `ResearchCard` rendered the real
5-field output correctly with zero buyer/contact fields present, confirming
the schema lock holds through this new entry point too. Incidentally
exercised the `LLM_PARSE_FAIL` retry-with-larger-token-budget fix (from an
earlier session) live against a real `finishReason=length` truncation — it
recovered correctly on retry rather than hard-failing.
**Quota-pause was NOT observed live** — none of the 3 real runs produced an
actual Firecrawl/Tavily/rate-limit error signature (all 3 completed, one with
an internal LLM parse retry that correctly did NOT get miscounted as a quota
hit). Deliberately did not force this by burning real API quota against
already-exhausted limits.

**Quota-pause — closed via unit test, not a live burn (2026-07-12)**. The
detection logic (`quotaSignatureIn`, the consecutive-hit counter, the
3-in-a-row pause threshold) was pulled out of `batch-upload/page.tsx`'s inline
functions into a new pure module, `lib/batch/quota-pause.ts` — same pattern as
`lib/batch/company-dedup.ts`/`file-parser.ts` (pure logic in `lib/`, UI state
in the page component), no behavior change, `tsc --noEmit` clean and a live
dev-server pass confirmed the page still renders correctly post-extraction.
Added `vitest` (project had zero test infrastructure before this — resolves
the stale `tests/url-classifier.test.ts` reference elsewhere in this doc,
which pointed at a file that doesn't actually exist; that specific test still
needs writing separately, not done here) and `npm test` script. New
`tests/batch-quota-pause.test.ts`, 17 assertions, all passing: every known
signature (Firecrawl "insufficient credits", Tavily "exceeds your plan"/HTTP
432, generic "quota exceeded"/"rate limit"/429) correctly detected across all
three haystack sources (`scrapeResult.debug.errors`, `validation.gates`
reason/diagnostics, top-level `error`); a generic `LLM_PARSE_FAIL`/truncation
error and a generic network failure correctly do NOT match (this is the exact
distinction the live run surfaced — the real retry that happened live must
never count as a quota hit); the consecutive-hit counter increments on a hit
and resets on any non-hit; the pause threshold is false below 3 and true at/
above 3; and a full loop simulation confirms both the pause-at-3rd-company
case and the streak-broken-by-a-success case, plus a simulation of the actual
2026-07-12 live run (3 successes) correctly never pausing. This is the
honest way to confirm the pause logic — re-testing against real quota limits
to force the condition would have been a bad way to verify this deliberately.

**Phase 1 — complete (2026-07-12).** Items 1, 6, and 7 done and verified
(live browser passes plus this unit test); items 2–4 were explicitly deferred,
not abandoned — see their own entries above for what's next.
If parse+dedupe behavior specifically is in question later, re-test with a fresh fixture of fake
`.example.com` domains rather than assuming the prior manual pass still holds.

**Phase 2 — items 1-2 (Competitor Discovery Engine, ICP Generator) done,
items 3-9 not started (scope decided 2026-07-14).** See "SCOPE PIVOT" near
the top of this file for the decision and the 9-item priority order
(Competitor Discovery Engine → ICP Generator → Company Discovery Engine →
Research Quality Framework → Research Evaluation Framework → Market
Intelligence Layer → Outreach Intelligence Layer → Decision-maker discovery
→ Outreach send). Phase 1's items 2-4 (parallel enrichment repositioning
already done as Item 2; items 3 PDF done; item 4 executive-change/investor-
transcript targeting still open) are independent of Phase 2 and can proceed
in either order — Phase 2 doesn't block on them.
Living-memory note: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`,
`docs/DECISIONS.md`, and `docs/CURRENT_TASK.md` are the current canonical,
kept-current status/decision record as of 2026-07-15 — check those first for
"what's true right now," this CLAUDE.md file's own dated history below is
kept for narrative detail but can lag.

**Item 1, Competitor Discovery Engine — sessions so far:**
- **Architecture session (done 2026-07-14):** flow design, pipeline
  placement (parallel with `discoverAndFetchExternalSources()`, same timing
  as Item 2), search-grounded-not-LLM-narrated discipline, new sibling module
  `lib/enrichment/competitor-discovery.ts`, filtering/confidence-tiering
  rules, output shape, LLM integration via the existing single narrative
  call, new non-critical `COMPETITOR` gate, explicit non-goals (no
  market-share data, no scraping competitor sites, not recursive). No code
  written. Full detail in `Latest Session Handoff.md`'s history (superseded
  by the schema session below, but the design itself still holds).
- **Schema session (done 2026-07-14):** formalized the architecture as real
  TypeScript — `CompetitorProfile`, `CompetitorCandidate`,
  `CompetitorDiscoveryResult`, `CompetitorConfidence`,
  `CompetitorSufficiency` in the new `lib/enrichment/competitor-discovery.ts`
  (types only, no search/HTTP logic — that's the next session). Wired into
  `NormalizedAnalysis` (`lib/pipeline/normalize.ts`): added `competitors:
  CompetitorProfile[]` and `competitor_sufficiency: CompetitorSufficiency`
  fields, populated with safe "nothing found" defaults (`[]` /
  `'insufficient'`) since no producer exists yet — same "insufficient means
  no forced output" discipline as `evidence_sufficiency`. Marked
  `competitive_context` `@deprecated` in place (confirmed dead/unrendered by
  grep, per the architecture session) rather than removing it, since nothing
  produces `competitors` yet — premature removal now would just be a
  regression with no replacement live. Added the matching loose-optional
  `CompetitorProfile` type + `getCompetitors()` / `getCompetitorSufficiency()`
  getters to `lib/pipeline/analysis-sections.ts`, following that file's
  existing getter convention, so both `AnalysisViewer` and
  `buildAnalysisAppendix` can pick this section up later without another
  shape-plumbing pass — the actual "Competitors" UI section itself is still
  deferred, not built this session. Verified: `tsc --noEmit` clean, all 52
  `vitest` assertions still pass.
- **Prompt Design session (done 2026-07-14):** added the LLM-narration half
  of the deterministic-list + LLM-merge pattern to
  `lib/prompts/analyze-v2.ts`, mirroring how `opportunities` already merges
  `deterministic_opportunities` with LLM enrichment in `normalize.ts`
  (~line 646, `titleMatch()`). `NarrativePromptInput` gained
  `competitorCandidates: CompetitorCandidate[]` (imported from
  `competitor-discovery.ts`). `buildNarrativePrompt()` renders a new
  `[COMPETITOR CANDIDATES]` block (name, mention count, explicit-vs-framing
  tag, up to 2 truncated snippets per candidate; defensive `.slice(0, 5)`
  mirroring the architecture's confidence-tiering cap even though the
  not-yet-built producer should already enforce it; "None found" text when
  empty). `NARRATIVE_SCHEMA` gained a `"competitors"` output array
  (`name`/`why_they_compete`/`market_position`/`differentiator`) plus a
  RULES bullet requiring one output entry per input candidate name, in the
  same order, nothing added or dropped, and explicitly forbidding the model
  from adding competitors "known" from its own training data — the same
  anti-hallucination shape as the opportunity catalog's discard-LLM-only-
  misses rule. Confidence is deliberately NOT an LLM-output field here (same
  as `opportunities`' `relevance`) — it stays code-derived, set later by the
  Implementation session's confidence-tiering step, not narrated.
  `buildNarrativeInput()` gained a 5th, optional, defaulted (`= []`)
  parameter so the one real call site (`app/api/admin/test-analysis/route.ts`)
  needed zero changes — there is still no `discoverCompetitors()` producer,
  so every live prompt today renders the "None found" branch of the new
  block. Verified: `tsc --noEmit` clean, all 52 `vitest` assertions still
  pass (prompt-text-only change, no new test file — nothing here is
  behavior to unit-test yet since the candidate list is always empty until
  Implementation lands). Not a UI-observable change, browser verification
  skipped per this repo's own guidance (no producer wired, no UI section
  reads it yet).
- **Implementation session (done 2026-07-15) — Competitor Discovery Engine
  is now COMPLETE.** Real logic added to
  `lib/enrichment/competitor-discovery.ts`: `discoverCompetitors()` runs 4
  Tavily/Serper-fallback search queries (`"${name}" competitors`, `"vs"`,
  `"alternatives"`, `top competitors of`), extracts candidate names via two
  regex strategies — `extractVsPair()` ("X vs Y" title pattern, case-
  insensitive on the trigger word only, names stay case-sensitive/proper-
  noun-shaped) and `extractListAfterTrigger()` (capitalized-word list
  following "competitors include"/"alternatives to"/"rivals are"/etc,
  window-bounded to the next sentence so it can't bleed into unrelated
  text) — then filters via `classifyRejection()` (self-name via
  `isSelfName()`'s word-overlap check, a `NON_COMPETITOR_NAMES` list of
  known directories/aggregators/news outlets/certifying bodies checked
  BEFORE the generic length/stopword checks so e.g. "G2" reports the
  specific reason not just "too short", and `RELATIONSHIP_DISQUALIFIER_PATTERNS`
  for customer/supplier/certifying-body/association/partner framing found
  in the candidate's own snippets), tiers confidence via `tierConfidence()`
  (high = 2+ mentions AND "vs"-framing; medium = either alone; low =
  neither), caps at 5. `why_they_compete` on the returned `CompetitorProfile[]`
  is a code-derived fallback (`fallbackWhyTheyCompete()`) — same
  "LLM-narrative, code-text-as-fallback" shape as
  `DeterministicOpportunity.strategic_challenge`. `CompetitorDiscoveryResult`
  gained a `candidates: CompetitorCandidate[]` field (same survivors as
  `competitors`, pre-final-shaping) not anticipated by the Schema session —
  needed because the prompt block (Prompt Design session) consumes the
  richer `CompetitorCandidate` shape (mention_count/snippets/
  explicit_vs_framing) while the merge step needs the tiered `CompetitorProfile`
  shape, and both come from the same call.
  Wired into `app/api/admin/test-analysis/route.ts`: `competitorDiscoveryPromise`
  kicked off at the same point as `discoveryPromise` (parallel with
  `discoverAndFetchExternalSources()`, before Stage 1 SCRAPE starts, per
  architecture decision 1), awaited with its own bounded 12s race (simpler
  than ENRICHMENT's soft/hard/late-arrival machinery — deliberately NOT
  entangled with that existing timing-critical code, since competitor
  discovery is a handful of search calls, not a multi-stage pipeline, and
  has no "late" continuation path) right before the narrative prompt is
  built, feeding `buildNarrativeInput()`'s `competitorCandidates` param.
  New non-critical `COMPETITOR` gate added (WARN-only, same tier as
  `ENRICHMENT`). Result threaded to `normalize.ts` via `merged._competitor_discovery`
  (same underscore-prefixed internal-passthrough convention as `_extractor`/
  `_service_evidence_content`).
  `normalize.ts`'s merge step replaced the old hardcoded `[]` default:
  code-derived `CompetitorProfile` skeletons are matched against the LLM's
  parsed `competitors` narration (`flat.competitors`) via a new
  `competitorNameMatch()` (normalized near-exact match — lowercase, strip
  punctuation, collapse whitespace — deliberately NOT the fuzzy keyword-
  overlap `titleMatch()` opportunities use, since two different companies
  sharing one word, e.g. two "X Industries", must never cross-merge
  narration). LLM-only names with no code-derived match are discarded, same
  anti-hallucination discipline as the opportunities merge.
  `ResearchCard.tsx` gained a "Competitors" section using the existing
  `getCompetitors()` getter, rendered only when the list is non-empty (same
  "no forced empty-state message" pattern as Recent News).
  New `tests/competitor-discovery.test.ts` (27 assertions) caught two real
  bugs during this session: `extractVsPair()`'s "vs" trigger was
  case-sensitive (missed "Company A Vs. Company B") — fixed by making only
  the trigger characters case-insensitive, not the name-shape requirement;
  and `classifyRejection()`'s check order reported "too short" for
  known-2-char directory names like "G2" instead of the more specific
  directory reason — fixed by moving the `NON_COMPETITOR_NAMES` check before
  the length check.
  **Verified**: `tsc --noEmit` clean, full suite 79/79 pass (52 pre-existing
  + 27 new). Live dev-server pass over `/admin/intelligence-lab` — page
  compiles and renders with zero console/server errors (empty state only;
  no live `discoverCompetitors()` call was exercised, since that spends
  real Tavily/Serper quota and needs the same explicit-confirmation
  discipline as every other quota-spending run in this repo).
  **Live end-to-end run — done (2026-07-15).** Ran `discoverCompetitors()`
  against real benchmark companies via the actual `/admin/intelligence-lab`
  UI with real Tavily/Serper + LLM quota (explicit user confirmation given
  first). Confirmed the full path works: real search → filtered candidates
  → LLM narration → merged `competitors` rendered in `ResearchCard`, with
  `COMPETITOR:PASS` firing correctly. Two real bugs found and fixed in the
  same session (both now covered by regression tests, 81/81 passing):
  1. **Trigger word extracted as a candidate name.** A "Top Alternatives to
     Bharat Forge" -style heading caused `extractListAfterTrigger()` to
     re-match "Alternatives" itself (the trigger word) as a proper-noun
     candidate, surfaced at medium confidence with no real company behind
     it. Fixed: `STOPWORDS` in `competitor-discovery.ts` now includes the
     `LIST_TRIGGER` vocabulary itself (alternative/alternatives/competitor/
     competitors/rival/rivals), so a name that reduces to just the trigger
     word is rejected as "generic/stopword phrase."
  2. **Self-name filter missed a domain-derived company-name guess.**
     Running Ace Pipeline listed "Ace Pipeline" as its own competitor.
     Root cause: `guessCompanyNameFromDomain("acepipeline.com")` (route.ts)
     produces the single word `"Acepipeline"` — there's no case boundary in
     an all-lowercase domain for the camelCase-split regex to act on — while
     search results use the real two-word "Ace Pipeline". `isSelfName()`'s
     word-overlap check requires shared individual words, so `["ace",
     "pipeline"]` vs `["acepipeline"]` shares zero words and never matched.
     Fixed: `isSelfName()` now also checks the space-collapsed form of both
     names (`"ace pipeline"` vs `"acepipeline"` → equal → self-match), same
     "domain-guess-is-imprecise" limitation class as Item 1's single-word
     company-name handling in `website-discovery.ts`.
  **Separately observed, not a code bug, not fixed**: Ace Pipeline's real
  search results repeatedly named "Ace Pipeline Contracts Pvt. Ltd." (an
  unrelated Indian company with a near-identical name) as the entity Bechtel/
  Fugro/Geosyntec compete with — a genuine name-collision limitation of a
  generic two-word company name, same class of ambiguity `website-discovery.ts`
  already documents and handles by refusing to guess. Competitor discovery
  has no equivalent disambiguation step today; worth a future look if this
  recurs, not blocking.

**Competitor Discovery Engine (Phase 2 item 1) is now COMPLETE, including
live verification.**

**Item 2, ICP Generator — done (2026-07-15), code + unit tests; live
end-to-end run pending.** Given an already-researched company, surfaces
0-5 real, search-grounded target-customer segments (who the researched
company itself sells to — distinct from `company_fit`, which scores
whether this company is a good lead FOR DEMAZE, a single 0-100 number; see
`lib/enrichment/icp-generator.ts` header for the full reconciliation note).
Architecture is a direct mirror of Competitor Discovery Engine (documented
as the reference pattern for this repo's deterministic-list + LLM-narration
features — see `docs/DECISIONS.md`), done in one session rather than four
separate architecture/schema/prompt/implementation sessions, since the
pattern was already proven and the risk of re-deriving it from scratch was
low.
- New `lib/enrichment/icp-generator.ts`: `ICPSegment`/`ICPCandidate`/
  `ICPDiscoveryResult` types, `discoverICPSegments()`. Search queries built
  around explicit serve/customer framing (`"we serve"`, `"clients
  include"`, `"industries served"`, `"customers include"`). Extraction
  (`extractSegmentsAfterTrigger`) differs from competitor extraction in one
  real way: segment names are frequently lowercase industry terms
  ("automotive manufacturers", "food and beverage"), not proper nouns, so
  extraction splits a comma/and-delimited list after the trigger phrase
  rather than matching PROPER_NOUN shapes. A real gap found while writing
  this: a trigger match sometimes leaves a leftover connector word right
  after it (e.g. "industries we serve" matches, but the source text
  continues "...serve include automotive..." since "include" wasn't part of
  the matched trigger) — fixed with a `LEFTOVER_CONNECTOR` post-processing
  strip rather than trying to enumerate every trigger+connector combination
  in the regex itself. Self-name filtering reuses the exported `isSelfName()`
  from `competitor-discovery.ts` directly (not duplicated) — segment names
  can occasionally collide with the researched company's own name via a
  loose trigger match, same failure mode competitor discovery already
  solved.
- `lib/pipeline/normalize.ts`: `icp_segments`/`icp_sufficiency` added to
  `NormalizedAnalysis`. Merge-by-name step reuses the same normalized-exact-
  match identity check the competitors merge uses — the function was
  renamed `competitorNameMatch` → `identityNameMatch` since it's now shared
  by both, rather than duplicating it under a second name.
- `lib/pipeline/analysis-sections.ts`: `getICPSegments()`/
  `getICPSufficiency()` getters, same convention as `getCompetitors()`.
- `lib/prompts/analyze-v2.ts`: new `[ICP CANDIDATES]` block and
  `icp_segments` output array in `NARRATIVE_SCHEMA`, with the same
  anti-hallucination RULES bullet shape as `competitors` (one entry per
  candidate name, same order, nothing invented, no populating from general
  industry knowledge).
- `app/api/admin/test-analysis/route.ts`: `icpDiscoveryPromise` kicked off
  at the same point as `competitorDiscoveryPromise` (before Stage 1 SCRAPE
  starts), bounded 12s race, new non-critical `ICP` gate (WARN-only, same
  tier as `COMPETITOR`/`ENRICHMENT`), threaded to `normalize.ts` via
  `merged._icp_discovery`.
- `app/admin/intelligence-lab/ResearchCard.tsx`: new "Target Customer
  Segments" section using `getICPSegments()`, rendered only when non-empty
  (same discipline as "Competitors").
- New `tests/icp-generator.test.ts` (19 assertions): extraction (including
  the leftover-connector-stripping fix), self-name/generic-term filtering,
  confidence tiering, fallback-text generation.
- **Verified**: `tsc --noEmit` clean, full suite 98/98 pass (79 pre-existing
  + 19 new). Live dev-server pass over `/admin/intelligence-lab` — page
  compiles and renders with zero console/server errors (empty state only;
  no live `discoverICPSegments()` call was exercised, since that spends
  real Tavily/Serper quota — same "verify via tsc+tests+dev-server, defer
  live run" pattern as Competitor Discovery Engine's own implementation
  session and Phase 1 Item 3).
**Live end-to-end run — done (2026-07-15).** Ran `discoverICPSegments()`
against Ador Welding via the real `/api/admin/test-analysis` endpoint with
real Tavily/Serper/LLM quota (explicit user confirmation given first).
Confirmed the full path works: real search → filtered candidates → LLM
narration → merged `icp_segments` in the API response, `icp_sufficiency:
"sufficient"`, 5 segments (`shipbuilding`, `oil and gas`, `infrastructure`,
`power`, `railways`), all `confidence: "high"`, each with real source URLs
(adorwelding.com, trendlyne.com). Incidentally re-verified Competitor
Discovery Engine stays regression-free on the same run (ESAB, CenterLine,
Autometers Alliance, Telsonic, Migatronic, all medium confidence,
`competitor_sufficiency: "sufficient"`).
**One real bug found and fixed in the same session**: `splitSegmentList()`
in `icp-generator.ts` split on every `\band\b`, so idiomatic two-word
industry terms broke apart — "oil and gas" surfaced as two separate
segments, `oil` and `gas`. Fixed by swapping each of a known-idiom list
(`COMPOUND_SEGMENT_IDIOMS` — oil and gas, food and beverage, textile and
apparel, iron and steel, pulp and paper, health and wellness, travel and
tourism, media and entertainment, sales and marketing, research and
development, arts and crafts, hotels and resorts) for an "and"-free token
before the list split, then restoring the original text afterward. A first
attempt (replacing only the idiom's internal spaces with a placeholder
character) did not work — `\b` is a `\w`/`\W` transition, so `\band\b` still
matched "and" on either side of a non-word placeholder character; the fix
needed a full-idiom token swap instead. Re-verified live after the fix: "oil
and gas" now surfaces as one segment. Two new regression tests added to
`tests/icp-generator.test.ts` (100 total, up from 98).

**ICP Generator (Phase 2 item 2) is now COMPLETE, including live
verification.**

**Item 3, Company Discovery Engine — done (2026-07-15), code + unit tests;
live end-to-end run pending.** Reverse direction from Competitor Discovery
Engine / ICP Generator: given an ICP segment (free text — typed, or copied
from a prior run's `icp_segments`), finds NEW candidate companies to
research, rather than enriching a report for a company already being
researched. No LLM narration step at all in this module — every candidate
name comes from search-result regex extraction only.
New `lib/enrichment/company-discovery.ts`: `discoverCompanies(icpSegment,
excludeCompanyName?)`. Two extraction strategies — trigger-phrase list
(`extractCompaniesAfterTrigger`, "top companies in X"/"companies like
X, Y, Z") and numbered-list (`extractNumberedListCompanies`, "1. Zoho
2. Freshworks…" — real "Top 10 X Companies" search snippets frequently
flatten to this shape with no single trigger sentence). Filtering
(`classifyCompanyRejection`) reuses `isSelfName()` from
`competitor-discovery.ts` directly, plus a local directory/aggregator name
list (G2/Crunchbase/LinkedIn/etc., same duplication-over-sharing precedent
as the other discovery modules). Confidence tiers by mention count only
(no "vs"/"serve"-framing signal exists for company-list results). Domain
resolution — the one genuinely expensive new step — reuses
`discoverCompanyWebsite()` from `website-discovery.ts` directly, run
sequentially against only the capped (6) survivor set; a candidate with no
confirmed domain still surfaces (name + reason), just gets researched by
name instead of URL downstream.
New route `POST /api/admin/company-discovery`
(`{ icpSegment, excludeCompanyName? }`). New standalone page
`/admin/company-discovery` (added to `nav-config.ts` between Research and
Batch) rather than embedding into `ResearchCard` — the ICP Generator
session already flagged company-matching as a separate later milestone.
The page's "Research Selected" loop is copied verbatim in shape from
`batch-upload/page.tsx` (`DedupedCompany` handoff type, `quota-pause.ts`
detection, as-you-go `persistResult` to run-history).
New `tests/company-discovery.test.ts` (20 assertions): both extraction
strategies, self-name/directory/generic-term rejection, confidence
tiering, fallback-reason text.
**Verified**: `tsc --noEmit` clean, full suite 120/120 pass (100
pre-existing + 20 new). Live dev-server pass over the new
`/admin/company-discovery` page — compiles and renders with zero
console/server errors (empty state only; no live `discoverCompanies()`
call was exercised, since that spends real Tavily/Serper quota — same
"verify via tsc+tests+dev-server, defer live run" pattern as every prior
discovery-module implementation session).
**Live end-to-end run — done (2026-07-15).** Ran `discoverCompanies()`
against the real `/api/admin/company-discovery` endpoint with real Tavily/
Serper quota (explicit user confirmation given first), segment "oil and
gas", excluding "Ador Welding" (the company this segment was copied from,
per the ICP Generator's own live run earlier the same day). Confirmed the
full path works: real search → both extraction strategies exercised on real
snippets → self-name/directory filtering → confidence tiering → sequential
`discoverCompanyWebsite()` domain-resolution pass. Result: 2 of 2 raw
candidates survived filtering (`Anadarko Petroleum` high confidence,
`Hess Corp` high confidence), `sufficiency: "sufficient"`.
**One real false positive found, not fixed (same known bug class, not new
code)**: `discoverCompanyWebsite()` resolved Anadarko Petroleum to
`petroleum.gov.gy` (a Guyana government petroleum-industry info site, not
Anadarko's real corporate domain) at `medium` confidence — the same loose
body-text-match limitation `website-discovery.ts` already documents
elsewhere in this file (e.g. the AITG/miraheze false positive), now
confirmed manifesting through the Company Discovery Engine's reuse of that
function too. Hess Corp correctly returned with no domain (`domain not
confirmed`) rather than guessing. Not blocking, not fixed this session —
logged as a precision gap in the shared `discoverCompanyWebsite()` path,
same "known, not urgent" status as ATE Group's unresolved domain case above.

**Company Discovery Engine (Phase 2 item 3) is now COMPLETE, including live
verification.**

Items 1-3 of Phase 2 (Competitor Discovery Engine, ICP Generator, Company
Discovery Engine) are all now complete with live verification.

**Stale pointer corrected (2026-07-15)**: this used to say "next session
should move to item 4." Items 4 (Research Quality Framework) and 5 (Research
Evaluation Framework) are now also COMPLETE with live/verified checks. This
file's own narrative history is allowed to lag — `docs/CURRENT_TASK.md`,
`docs/ROADMAP.md`, and `docs/DECISIONS.md` are the canonical, kept-current
record; check those first, not this section, for what's actually done.

**Item 6, Market Intelligence Layer — live end-to-end run done (2026-07-15).**
Code + unit tests were already complete going into this session (pure
deterministic search -> regex-classify -> dedupe -> confidence-tier module,
see `lib/enrichment/market-intelligence.ts` header for why this one
diverges from the competitor/ICP "code extracts, LLM narrates" pattern — no
LLM layer here). Ran `discoverMarketIntelligence()` against Ador Welding via
the real `/api/admin/test-analysis` endpoint (real Tavily/Serper quota,
explicit user confirmation given first, reusing the existing scrape cache
for that company). A dev server for this project was already running on
port 3000 from another session — hit its API directly via `curl` rather
than starting a second `next dev` instance (which the directory-scoped lock
would have refused anyway); no process was started or killed to do this.
Confirmed the full path works: `MARKET_INTEL:PASS`, `4 item(s) found | 4 of
4 raw candidate(s) survived filtering`, `market_intelligence_sufficiency:
"sufficient"` in the normalized `analysisResult`. All 4 surfaced items were
real, source-attributed `growth_indicator` statements at `medium`
confidence (mention_count=1 each, so correctly short of `high` per
`tierConfidence`'s >=2-mentions requirement) — e.g. "growing from USD 18.86
billion in 2025 to USD 22.53 billion by 2030...CAGR of 3.62%" sourced to a
real Yahoo Finance article, and a CAGR growth-forecast sourced to Ador's own
2021-22 annual-report PDF. No `challenge`/`trend`/`shift` items surfaced
this run — plausible given real search results, not evidence of a category
bug. Competitor Discovery and ICP Generator both stayed regression-free on
the same run (`COMPETITOR:PASS` 5 found, `ICP:PASS` 5 found — consistent
with their own prior live runs against this company). Verified the
`ResearchCard.tsx` render path (`marketIntel.length > 0` gate, `statement`/
`category`/`confidence` fields) matches the live response shape exactly by
reading the component against the actual returned JSON, rather than
re-spending quota on a second UI-driven run just to see the same data
rendered — a full browser-driven pass with real data was already done for
Competitor Discovery/ICP Generator earlier this phase, establishing that
`ResearchCard`'s render conventions work; this module's section follows the
identical pattern.

**Market Intelligence Layer (Phase 2 item 6) is now COMPLETE, including live
verification.**

## The actual goal
NOT "6/6 benchmark PASS." The goal is: any company URL -> pipeline always returns
usable intelligence -> no hard crashes -> no hard FAILs -> graceful degradation on
ugly real-world sites.

## Benchmark workflow
Run `benchmark/run-benchmark.ts` after every change to this pipeline. Write output to
`benchmark/results-history/<date>.json`. Compare against the previous snapshot before
claiming a fix worked — a fix for one company should not silently regress Bharat Forge,
Muthoot, or Chargebee (all currently PASS).