# Demaze AI Outbound Intelligence Platform — Project Context

## What this is
A **Company Intelligence Engine** for Demaze outbound sales — NOT a website
analyzer, and NOT a lead-discovery tool. Input: a company that has ALREADY been
identified as a lead by something upstream of Demaze (a Sales Navigator export),
with a specific named person + title ALREADY attached to that row — buyer
identity is input data, not something this pipeline determines. Every real lead
row arrives pre-decided on "who." Target industries: Manufacturing, Automotive,
Industrial, SaaS, Financial Institutions, SMBs.

## Output schema — LOCKED (2026-07-11), matches the sheet's own column names
Research each company ONCE. Output is exactly these 5 fields, nothing more:
- **Company Description**
- **Pain Points**
- **AI Opportunities**
- **Recent News**
- **Personalization Summary**

No buyer/stakeholder field — that's provided as input (name + title, already on
the row), never generated. No email-finding, generation, QA, or send — those
stay permanently out of scope per the boundary below.

This is NOT a chatbot. Output feeds real Demaze sales outreach.

## Scope boundary — LOCKED (2026-07-10, buyer clarification added 2026-07-11)
The real architecture is:
```
Sales Navigator export (company + named person/title ALREADY attached to the row)
  -> company identified, buyer already decided — NOT built here, NOT our job
  -> Demaze Intelligence Engine        (THIS is what we build)
       find website -> enrich -> find problem -> AI research
  -> [find person's email -> personalized email generation -> QA agent -> send]  (downstream, NOT built here)
```

**Demaze's job is exactly four steps: find website -> enrich -> find problem ->
AI research.** Everything before that (lead discovery, including WHO the buyer
is — that arrives on the row, never inferred or ranked by us) and everything
after that (finding a person's email, generating a full email, QA'ing it,
sending it) is **permanently out of scope** — not deferred, not "later,"
genuinely not ours to build. Do not add buyer-ranking/contact-selection logic,
email-finding, email-generation, a QA agent, or a send mechanism to this
codebase without an explicit, separate decision to change this scope boundary.
If a future session proposes building toward LinkedIn/Sales-Navigator-style lead
discovery, that's a different business — stop and flag it
rather than proceeding.

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
- `isFetchable()` still skips PDFs entirely — annual reports and investor
  presentations (the two highest-priority source types) are disproportionately
  PDF-published and are being silently dropped. Item 3, not started yet.

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
`matchesKeyword()` is the function. See tests/url-classifier.test.ts for the adversarial matrix —
extend that file, don't rewrite the matching logic without re-running it.

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
- **Anything past the scope boundary above**: email-finding, email generation,
  a QA agent, or a send mechanism. Permanently out of scope, not just deferred.
- **LinkedIn-driven architecture decisions**. LinkedIn stays excluded/optional.
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
  zero results). **`discovery-engine.ts` has the identical gap and was NOT
  touched** — out of scope for item 1, worth fixing when item 2 (repositioning
  enrichment) is worked. Re-verified end-to-end after the fix: Ador Welding
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

**Item 2 (not started)** — reposition enrichment discovery+fetch from
implicit-fallback framing to an explicitly parallel, always-on stage (its
discovery sub-stage already runs unconditionally today, see "Current
implementation gaps" above — this is about making that intentional and correct,
plus fixing the sequencing so scraping and enrichment run together, not
scrape-then-maybe-enrich). Ador Welding is the reference case.

**Item 3 (not started)** — fix the PDF drop in `isFetchable()`. Add PDF text
extraction to the fetch path.

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
**Quota-pause was NOT observed** — none of the 3 real runs produced an actual
Firecrawl/Tavily/rate-limit error signature (all 3 completed, one with an
internal LLM parse retry that correctly did NOT get miscounted as a quota
hit). Deliberately did not force this by burning real API quota against
already-exhausted limits — genuinely triggering it needs either live quota
exhaustion (not manufactured on purpose) or a mocked/unit-level test of
`quotaSignatureIn()`/the consecutive-hit counter in `batch-upload/page.tsx`,
which hasn't been done. If quota-pause behavior is ever in question, that unit
test is the safe way to confirm it — re-testing live against real quota
limits is not a good way to verify this deliberately.
If parse+dedupe behavior specifically is in question later, re-test with a fresh fixture of fake
`.example.com` domains rather than assuming the prior manual pass still holds.

## The actual goal
NOT "6/6 benchmark PASS." The goal is: any company URL -> pipeline always returns
usable intelligence -> no hard crashes -> no hard FAILs -> graceful degradation on
ugly real-world sites.

## Benchmark workflow
Run `benchmark/run-benchmark.ts` after every change to this pipeline. Write output to
`benchmark/results-history/<date>.json`. Compare against the previous snapshot before
claiming a fix worked — a fix for one company should not silently regress Bharat Forge,
Muthoot, or Chargebee (all currently PASS).