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
   (originally `trigger/problem/service/opening_angle/why_now` — **renamed
   to match this line's naming, see the 2026-07-23 entry in the Phase 2
   item 7 section below**), populated live by the prompt in
   `lib/prompts/analyze-v2.ts` and rendered in `ResearchCard.tsx`.
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
- ~~Public-source category gaps (item 4, not started): no dedicated query
  template for executive-change announcements; investor-call transcripts and
  financial disclosures only surface incidentally, not targeted~~
  **RESOLVED (2026-07-23, Item 4)** — 5 new dedicated query templates (2
  investor-call-transcript, 3 executive-change) plus 2 new classified
  `SourceType`s. See Item 4 in the implementation sequence below.
  Government-filings APIs (EDGAR/MCA) remain a future category, explicitly
  not being built now.
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

## RESOLVED 2026-07-24 — multi-locale sites (lechler.com): non-English page
## duplicates were crowding out English content, zeroing out pain_points/opportunities
User reported lechler.com (a German spray-nozzle manufacturer, real, content-rich
site) coming back with 0 pain points and 0 opportunities. Root-caused via a live
force-fresh run (not guessed): the scrape itself was fine (7 pages, quality
95/100) — but `classifyUrl()`'s keyword scoring has no language awareness, and
lechler.com is a heavily multi-locale TYPO3 site (`/de/`, `/fr/`, `/es/`, `/it/`,
`/ru/`, `/se/`, `/fi/`, plus `-en`-suffixed English variants like `/de-en/`,
`/in-en/`, `/be-nl/`). A French `/fr/solutions/secteurs/...` page scores
identically to its English equivalent purely on keyword match, so 11 of the top
15 selected pages were German/French/Spanish/Finnish/Dutch. `evidence-
extractor.ts`'s subject-classification and `SIGNAL_PATTERNS` regexes are
English-only, so those non-English pages contributed real scraped content but
zero usable signal — `companySubjectCount` and `signals.length` both came back
0, which fired the `insufficientEvidence` gate (see the "Insufficient Evidence
outcome" section above) and force-suppressed both `pain_points` and
`opportunities` even though the LLM's own narrative output that run actually
had 4 of each (`LLM_PARSE` stage reported "4 pain_points | 4 opportunities";
`NORMALIZATION` reported "0 pain_points and 0 opportunities" — that gate's own
existing WARN message, working as designed).

**Fixed** in `lib/pipeline/scraper.ts`: `detectLocalizedUrlStructure()` scans
the full candidate URL list, finds first-path-segments that (a) look
locale-shaped (`/^[a-z]{2}(-[a-z]{2})?$/i` — 2 letters, or 2+hyphen+2) AND (b)
repeat across 3+ distinct URLs (same "require repeated structural evidence, not
a single match" discipline as the historical `matchesKeyword()` word-boundary
fix, applied to a new false-positive shape: a genuine one-off `/ir/` investor-
relations page must never be mistaken for a locale switcher). Segments
colliding with an existing short (<=3 char) category keyword (`ir`, `ai`) are
excluded outright regardless of repetition. `selectUrlsToScrape()` then applies
a 40-point score penalty to any URL whose first segment is a confirmed
non-English locale (English = segment `en` or ending `-en`) — this
deprioritizes, not excludes, so a genuinely non-English-only site still gets
scraped rather than coming back empty. Both new functions
(`detectLocalizedUrlStructure`, `isEnglishLocaleSegment`) plus
`selectUrlsToScrape` itself exported for testability, same precedent as
`isPdfUrl`/`buildDiscoveryQueries` elsewhere in this codebase.

New `tests/scraper-locale.test.ts` (11 assertions): confirms/rejects locale
segments by repeat count, the `ir`/`ai` collision guards specifically, no
penalty on unlabeled paths, non-English pages still selected when nothing else
exists, and a scoring reproduction of the exact lechler.com regression.
`tsc --noEmit` clean, full suite 551/551 (540 pre-existing + 11 new).

**Live-verified end-to-end, not just via unit test.** Re-ran lechler.com
force-fresh after restarting the dev server (per this file's own Windows
file-watcher gotcha): `linkScores` confirmed the penalty firing correctly in
production — German/French/Spanish pages that previously scored 90/75/65 now
score 35/30/25/0, while English pages (`de-en/company/events`, `in-en/
products/process-technology`, etc.) kept their original unpenalized scores and
now rank at the top of the selection. End result: `PAIN_POINTS` gate went from
`"0 pain_point(s) | evidence_sufficiency=insufficient"` to `"4 pain_point(s) |
evidence_sufficiency=sufficient"`, `NORMALIZATION` from `"0 pain_points and 0
opportunities"` to `"4 pain_points | 4 opportunities"` — both driven purely by
one new deterministic signal now being detected from the improved English-page
mix (`companySubjectCount` is still 0 for this company; the fix improved
`signals.length` from 0 to 1, which was enough to flip the insufficientEvidence
AND-gate). Rendered report now shows 4 real, specific pain points (nozzle
production quality consistency, custom-order engineering lead time, spray
equipment downtime, multi-site visibility) and 4 opportunities, each tied to a
named Demaze-shaped capability — not the generic-padding anti-pattern this
repo's opportunity engine exists to avoid.

**Known residual gap, not fixed**: `MIN_LOCALE_REPEAT=3` is deliberately
conservative — a locale segment appearing only 1-2 times in the candidate list
won't get flagged (e.g. lechler.com's `/fr/` only appeared twice among the 59
candidates and stayed unpenalized this run). This is an intentional
under-confidence tradeoff (same philosophy as `website-discovery.ts`'s
ambiguous-match handling) to avoid false-positiving on a genuine one-off
content path — not worth tightening unless a future company shows this
under-catching a real multi-locale structure.

## 2026-07-24 — "silent zero" bug class audit + first fix (Evidence & Opportunity Debug UI)
After the lechler.com locale fix above, user asked how to make fixes like this
"foolproof" and to find other similar problems. Answer given: no literal
foolproof for heuristic/pattern-matching systems, but the practical fix is
making silent failures loud. Ran two parallel research-agent audits (not
guessed, actual code-reading investigations):

**Audit 1 — language-blindness beyond the scraper fix.** CONFIRMED risks
found in `evidence-extractor.ts` (`LEADERSHIP_TITLE_VOCAB` is English-only
titles — a non-English leadership page produces `leadershipContacts: []`,
independently able to trigger the same silent 0 pain_points/opportunities
failure via the `insufficientEvidence` gate) and `website-discovery.ts` (name
normalization uses bare `\w`, which is ASCII-only in JS — `"Möller Group"`
becomes `"m ller group"`, corrupting company-identity matching at Step 0,
before anything else runs; same bug duplicated across
`evidence-extractor.ts`'s `firstSignificantWord()`, `competitor-discovery.ts`,
`icp-generator.ts`, `company-discovery.ts`). `discovery-engine.ts`'s search
query templates are also English-only, amplifying the above. THEORETICAL/LOW
risk (graceful degradation confirmed, doesn't touch `insufficientEvidence`):
`competitor-discovery.ts`, `icp-generator.ts`, `company-discovery.ts`,
`market-intelligence.ts` triggers. **Confirmed benchmark blind spot**: all 9
benchmark/reference companies are English-primary with plain ASCII names —
none of these risks can ever be caught by `npm run benchmark`/CI today.

**Audit 2 — non-language silent-degradation patterns.** CONFIRMED:
`business-profile.ts` has **zero pipeline gate** — every other discovery
stage (`COMPETITOR`/`ICP`/`MARKET_INTEL`) gets a WARN with a reason string;
business-profile failure is invisible beyond an ephemeral console log, despite
feeding the competitor/ICP fallback path. `scraper.ts`'s
`assessScrapeQuality()` scores purely on page/char count with zero
content-relevance signal (15 pages of the *wrong* content scores identically
to 15 right ones — the general case the locale fix above patched one instance
of), and its rich `ScrapeDebugInfo` trail never reaches the saved run at all
(orphaned in the separate `company_scrape_cache` table, unreachable without
raw SQL). `evidence-extractor.ts`'s `classifySubject()` also excludes
`'products'`/`'blog'` pageTypes from subject matching even though
`scraper.ts` scores `/solutions/`/`/services/`/`/capabilities/` pages
(`b2b_services`, 75) as high-priority — same shape as the already-fixed
homepage pageType bug, never extended to this page type. And: the
`_service_evidence_debug` diagnostic (added 2026-07-18) already exists,
already persists into every saved run — it was just never rendered anywhere
in the UI. Cheapest fix in the whole audit, chosen to ship first.

**Fixed this session**: `_service_evidence_debug` is now surfaced in
`/admin/intelligence-lab`'s Debug tab. New `getServiceEvidenceDebug()` getter
in `lib/pipeline/analysis-sections.ts` (loosened-optional local type mirror
of normalize.ts's `ServiceEvidenceDebug`, per this file's own no-cross-import
convention). New "Evidence & Opportunity Debug" card in `DebugPanel`
(`app/admin/intelligence-lab/page.tsx`) shows: the `insufficientEvidence`
4-condition breakdown as badges (which of `companySubjectCount_zero`/
`signals_zero`/`leadershipContacts_zero`/`no_facility_evidence` actually
fired), and a per-service list (all 8 confirmed Demaze services) with
threshold/surfaced/disqualified badges and expandable weak-tier evidence
snippets — the same view this session used via raw API-response inspection
to root-cause the Lechler bug, now reachable in a few clicks from any saved
run going forward. `tsc --noEmit` clean, full suite 551/551 (no new tests —
this is a pure read/render of already-validated data, no new logic to
regression-test).

**Live-verified in the browser, not just compiled.** Re-ran lechler.com
(cached scrape, real LLM call), opened Debug tab, confirmed real data
rendered: `leadershipContacts_zero: true`, `no_facility_evidence: true`,
`companySubjectCount_zero: false`, `signals_zero: false` (2 of 4, correctly
did not fire — matches this run's real 4 pain_points/5 opportunities), and
all 8 services listed with real thresholds (7 `none`, 1 `weak` —
"Marketplace platforms", evidence: a generic "partners" data-processing
mention, correctly NOT surfaced). Confirmed the expand/collapse interaction
works and reveals the real evidence snippet. Needed to dispatch synthetic
pointer events via `javascript_tool` rather than the `computer` tool's click
— base-ui Tabs/collapsible triggers didn't respond to the computer tool's
click in this environment, consistent with this session's prior browser-
automation gotcha notes elsewhere in this project's memory.

**Not done — remaining audit findings, ranked, for a future session**:
(1) `evidence-extractor.ts` leadership-title vocab — highest remaining blast
radius, independently triggers the exact silent-zero failure on non-English
companies; (2) the shared `\w`-ASCII name-normalization bug across 5 files —
corrupts company identity at Step 0 for any accented company name; (3)
`business-profile.ts` missing a pipeline gate; (4) `scraper.ts`'s
`assessScrapeQuality()` having no content-relevance signal, and its debug
trail never reaching the saved run; (5) `classifySubject()`'s `'products'`/
`'blog'` pageType exclusion. A non-English/diacritic-name benchmark fixture
(flagged by both audits independently) would be needed before any of these
fixes could be regression-tested — none of the current 9 fixtures can
exercise this bug class.

## RESOLVED 2026-07-24 — leadership-title vocab gap (audit item ranked #1)
`LEADERSHIP_TITLE_VOCAB` in `evidence-extractor.ts` was English-only
(Chairman/CEO/Director/President/etc.), so a real German/French/Spanish/
Italian/Portuguese/Dutch leadership page produced zero leadership contacts —
one of the four ANDed conditions in `normalize.ts`'s `insufficientEvidence`
gate, so this alone could force-suppress pain_points/opportunities on a
non-English company, same failure shape as the lechler.com locale bug via a
different mechanism.

**Fixed**: extended `LEADERSHIP_TITLE_VOCAB` with real, common top-level
titles from the same 6 languages (Geschäftsführer/Vorstandsvorsitzende(r)/
Vorstand/Direktor(in) — German; Directeur/Directrice (Général(e))/Président(e)/
PDG — French; Directora (General)/Presidente/Presidenta/Consejero(a) Delegado(a)
— Spanish; Amministratore Delegato/Direttore(-trice) Generale — Italian;
Diretor(a) (Geral) — Portuguese; Algemeen Directeur/Voorzitter/
Bestuursvoorzitter — Dutch) — deliberately the same rough depth as the
existing English list, not an exhaustive per-country title hierarchy.
**Deliberately did NOT touch `PORTFOLIO_CLAUSE`** (the English-only
"heads/leads/oversees" verb list `extractLeadershipEvidence()`'s narrative,
high-confidence strategy requires) — translating verb-clause grammar across 6
languages is a much higher-risk regex problem than extending a title noun
list, and `extractStructuralLeadershipEvidence()` (medium confidence, name+
title adjacency only, no portfolio clause required) already exists as the
lower-confidence path this fix relies on for non-English titles. This is an
honest reflection of weaker evidence for non-English leadership pages, not a
workaround — narrative/high-confidence stays English-only for now.

Also fixed the accented-name half of the same real-world symptom (a German
"Björn Müller" or French "Étienne Lefevre" — same `\w`-ASCII bug class this
file's audit section flagged for `website-discovery.ts`, confirmed here too):
`STRUCTURAL_NAME_TITLE_PATTERN`'s name-capture group changed from `[A-Z]
[a-zA-Z'.-]+` to `\p{Lu}[\p{L}'.-]+` (Unicode letter classes, `u` flag added),
and `LEADERSHIP_TITLE_PATTERN`'s leading-capital check changed from `[A-Z]` to
`\p{Lu}` (`u` flag added) so a name starting with an accented capital
("Étienne") matches. **Found and fixed a real bug while wiring the `u` flag
in**: `extractLeadershipEvidence()` reconstructed `LEADERSHIP_TITLE_PATTERN`
per-segment via `new RegExp(LEADERSHIP_TITLE_PATTERN.source, 'g')` — hardcoding
just `'g'` silently dropped the new `u` flag every time, which would have
either thrown or silently failed to match `\p{Lu}`. Fixed to
`LEADERSHIP_TITLE_PATTERN.flags` (the structural strategy's equivalent
reconstruction already did this correctly, no bug there).

**Known pre-existing limitation, confirmed unchanged, not part of this fix**:
a name with a lowercase nobiliary particle ("Jan de Vries", "Ludwig von Мises"
-shaped) still doesn't match — every space-separated word in the name group
requires a leading capital, true under both the old ASCII pattern and the new
Unicode one. Not a regression; documented via its own test case rather than
silently left unverified.

New tests in `tests/evidence-extractor-leadership.test.ts` (8 added, 15
total): German/French/Spanish/Italian/Dutch structural-title extraction,
an accented-name narrative (heading + portfolio-clause) match, the
single-word non-English false-positive guard still holding, and the
nobiliary-particle non-match documented as expected. `tsc --noEmit` clean,
full suite 559/559 (551 pre-existing + 8 new). Dev-server sanity pass (no
live company re-run — this is a pure regex/vocab change already covered by
realistic unit-test content shapes, same "verify via tsc+tests+dev-server"
precedent used elsewhere in this file for changes that don't need fresh
network-dependent verification): zero console/server errors.

**Not done — still open from the ranked audit list**: (1) the shared
`\w`-ASCII name-normalization bug in `website-discovery.ts`/
`competitor-discovery.ts`/`icp-generator.ts`/`company-discovery.ts` (this
session only fixed the two leadership-extraction regexes, not the other 4
files sharing the same bug shape); (2) `business-profile.ts` missing a
pipeline gate; (3) `scraper.ts`'s `assessScrapeQuality()` having no
content-relevance signal; (4) `classifySubject()`'s `'products'`/`'blog'`
pageType exclusion. A non-English/diacritic-name benchmark fixture is still
needed before any of these (including this session's own fix) can be
regression-tested by `npm run benchmark`/CI — this session's verification
was unit tests + dev-server only, per the same "no benchmark fixture exists
yet" gap flagged in the original audit.

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

**RESOLVED 2026-07-23 — filename/content mismatch fixed, reference set now
in the automated run.** Read `benchmarks/benchmark-runner.ts`'s `loadSpecs()`
first, as instructed, before changing anything: it reads every `*.json` file
in `benchmarks/companies/` via `fs.readdirSync(...).filter(f =>
f.endsWith('.json'))` and parses each independently — filename is never used
for anything, only `spec.name`/`spec.url`/`spec.expectations` from the file's
own content. So the mismatch was purely cosmetic/organizational, not a
functional bug — renaming was safe and required no runner changes. Fixed via
`git mv`: `bharat-forge.json` → `aitg.json`, `hdfc-bank.json` →
`a1-fence-products.json`, `zoho.json` → `ate-group.json` (confirmed no
existing file already held these correct names before renaming — no
duplicates). Three new fixture files created for the original reference set,
so `benchmarks/companies/` now has 9 files total and `npm run benchmark`
picks up all 9 automatically with zero other wiring needed:
- `bharat-forge.json` — bharatforge.com, `requiredProfileFlags:
  ["manufacturer"]`, `expectedPrimaryType: "manufacturer"` — matches the
  2026-07-11 manual spot-check finding ("Bharat Forge... classify correctly
  manufacturer").
- `chargebee.json` — chargebee.com, `requiredProfileFlags:
  ["software_saas"]`, `expectedPrimaryType: "software_saas"` — matches the
  same spot-check finding for Chargebee. `forbiddenTerms` flipped relative to
  the manufacturer fixtures (guards against manufacturing/industrial terms
  leaking into a SaaS company's narrative instead of the other way round).
- `muthoot-finance.json` — muthootfinance.com, **deliberately** leaves
  `requiredProfileFlags: []` and no `expectedPrimaryType` set, same pattern
  as `acepipeline.json`'s genuine-uncertainty case. Not because the correct
  classification is unknown (it's obviously `financial_institution`) — because
  whether the scrape reliably succeeds is still unconfirmed even after this
  session's fix (see the root-cause note under "Company-specific known
  issues" below): asserting a FAIL-severity classification check against a
  company whose scrape success is still an open question would reintroduce
  exactly the kind of false-FAIL noise this fixture work exists to avoid.
  `minSignals`/`minOpportunities`/`minChallenges` are all set to 0 (WARN-only
  anyway) so the fixture still runs and reports real numbers without gating
  on them.

New `tests/benchmark-fixtures.test.ts` (5 assertions, pure fs + JSON.parse,
no network, no server) verifies: every fixture file is valid JSON matching
`BenchmarkSpec`; no duplicate names/URLs; the 3 renamed files carry the
filename matching their content AND the old wrong-content filenames
(`hdfc-bank.json`/`zoho.json`) no longer exist; the 3 reference-set companies
are present with the expected classification; and the full 9-company set
(6 current benchmark + 3 reference) is exactly what's on disk. Did NOT run
the real `npm run benchmark` (would spend real Tavily/Serper/LLM quota, per
this session's own instructions) — verified structurally instead:
`tsc --noEmit` clean, full suite 488/488 passing (was 483 pre-existing + 5
new from this test file — actual pre-existing count re-confirmed live, not
assumed from a stale note elsewhere in this file).

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

  **RESOLVED / root-caused 2026-07-23 (direct network diagnosis, no API keys or
  quota spent).** Used plain `curl` (status/headers/redirects/timing) and
  `openssl s_client` (TLS handshake) against `a-1fenceproducts.com` directly.
  Found: the domain is healthy right now — valid TLS 1.3 handshake (`Verify
  return code: 0 (ok)`), consistent `200 OK` in ~1.8-3.3s across the default
  curl UA, this codebase's old self-identifying `DemazeBot` UA, and a real
  browser UA, both with and without `www.`, both with and without a `Range`
  header (mirrors exactly what `probeCorporateSeeds()`/`probeUniversalPaths()`
  send) — real page content every time (confirmed by inspecting the response
  body, a genuine `.php`-based fencing-company site behind Cloudflare, not an
  interstitial/challenge page). No anti-bot block, no slow-site symptom, no
  DNS/redirect problem, no rate limiting reproduces today from this
  environment. **Conclusion**: the historically-reported `fetch failed` is
  most likely (a) the same one-off scraper/network flakiness this file
  already documents extensively elsewhere for AITG/A-1 Fence/Ador Welding (a
  transient failure at the original test time, not a persistent block), or
  (b) Cloudflare's bot-management triggering specifically against
  Firecrawl's headless-browser fingerprint in a way plain HTTP requests
  don't reproduce — genuinely unconfirmable without spending real Firecrawl
  quota, since Firecrawl's SDK controls its own request internals, outside
  this codebase's reach. Per this investigation's own scope, NOT forcing a
  workaround for a cause that doesn't reproduce and can't be confirmed
  outside this codebase's control — documenting instead, per the "if the
  real cause is outside reasonable control, document don't force" rule.
  **One real, narrowly-scoped fix WAS found and applied though** (see the
  Muthoot Finance entry immediately below for the actual root cause it
  targets) — this codebase's own direct-fetch tiers (sitemap fetch, B2B/
  corporate path probing, Jina reader, website-discovery.ts's candidate
  verification, web-enricher.ts's PDF fetch) now send a real browser User-
  Agent instead of no UA or the old self-identifying `DemazeBot` string,
  which is a legitimate, in-our-control improvement to the fallback tiers
  even though it isn't what was blocking A-1 Fence specifically (that domain
  never showed a UA-based block in this session's testing).

- **Muthoot Finance**: root-caused 2026-07-23, same investigation session as
  A-1 Fence above, same direct-`curl`-only diagnostic discipline (no API
  keys/quota needed). Found a real, confirmed, reproducible cause:
  `muthootfinance.com` sits behind a CloudFront WAF rule that hard-blocks
  (`403 Forbidden`, body: "Request blocked... We can't connect to the server
  for this app or website at this time") any request whose User-Agent is
  either absent (Node's `fetch()` default) or self-identifies as a bot.
  Proved this precisely via 4 isolated curl requests against the identical
  URL: default curl UA → `403`; this codebase's old
  `'Mozilla/5.0 (compatible; DemazeBot/1.0)'` UA → `403`; a real modern
  Chrome UA → `200 OK` with 383,932 bytes of real Drupal-rendered content;
  same real UA against the bare (non-`www`) domain → `301` redirect to
  `www.`, also healthy. This is a textbook case of "missing/wrong
  User-Agent header causing a bot-block" — exactly the fixable class of
  issue this investigation was asked to look for. **Fixed**: every direct
  `fetch()` call this codebase makes against a target site or PDF now sends
  a real browser-shaped User-Agent (`Mozilla/5.0 ... Chrome/124.0.0.0
  Safari/537.36`) instead of no UA or the old bot-shaped string —
  `lib/pipeline/scraper.ts` (`fetchXml`/sitemap fetch, `probeCorporateSeeds`,
  `probeUniversalPaths`, `fetchViaJina`), `lib/enrichment/website-
  discovery.ts` (`fetchHomepageIdentityPlain`, the candidate-verification
  fetch already flagged elsewhere in this file as a known precision gap for
  ATE Group), and `lib/enrichment/web-enricher.ts` (`fetchPdfText`, which
  previously sent no UA at all). `tsc --noEmit` clean; this is a pure
  request-header change with no new branch logic, so no new unit test was
  needed — the existing `tests/enrichment-pdf.test.ts` /
  `tests/evidence-extractor-*` suites (which don't hit the network) stayed
  green. **Not fully verified end-to-end**: this fixes every DIRECT-fetch
  code path in this codebase, but the PRIMARY scraper for Muthoot Finance
  (and every company) is Firecrawl's managed SDK, which controls its own
  request headers internally — whether Firecrawl's own outbound requests
  already send a browser-shaped UA (likely, given it's a headless-browser
  service) or whether this same WAF rule also blocks Firecrawl on some other
  signal (IP reputation/datacenter ASN, a common WAF heuristic independent
  of UA) is unconfirmed without spending real Firecrawl quota against
  muthootfinance.com — a live pipeline re-run is the natural next step for
  whoever picks this up next, with explicit confirmation first per this
  repo's quota-spending discipline. `benchmarks/companies/muthoot-
  finance.json` (new, see "Benchmark set" above) deliberately does not
  assert `requiredProfileFlags`/`expectedPrimaryType` given this remaining
  uncertainty, so the automated benchmark won't false-FAIL if Firecrawl
  itself still can't get through.

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

## RESOLVED 2026-07-19 — detectPageType() URL-vs-path bug + homepage fallback
Was: `detectPageType()` receives the full URL (e.g. `https://adorwelding.com`) instead of
a bare path, so the homepage regex never matches — homepages get mislabeled
`pageType: 'other'` instead of `'homepage'`. This is currently *accidentally helpful*:
Ador Welding's homepage evidence gets correctly classified only because it qualifies
for the `'other'`-scoped third-person rule. Fixing the mislabeling naively would be a
REGRESSION for Ador Welding, because `pageType === 'homepage'` hits an unconditional
`return 'generic_marketing'` a few lines later. Do not fix either half of this in
isolation — needs a dedicated session that fixes both the URL-path bug AND the
unconditional homepage->generic_marketing return together, or benchmark regressions
will follow.

**Fixed, both halves together, as this note required.** `parseContentSegments()`
(evidence-extractor.ts) now extracts the bare path already present before the
`(url)` parens in the `--- PAGE: /path (https://url) ---` header — instead of
re-passing the full URL — so `detectPageType()`'s homepage regex correctly
matches. `classifySubject()`'s third-person self-reference block (the one
`'other'`/`'about'` pages already used) now also runs for `pageType ===
'homepage'`, so real homepage evidence that used to pass only by accident
(via the mislabeling) now passes on purpose, and doesn't fall through to the
unconditional `generic_marketing` return. New regression tests:
`tests/evidence-extractor-pagetype.test.ts`.

**Verified directly against real cached content, not just synthetically.**
Pulled Ador Welding's actual cached scrape (`company_scrape_cache` in
Supabase — only 1 page succeeded: the homepage, 5000 chars, matching this
repo's own documented scrape-reliability gap for this company) and ran it
through the fixed `extractSignals()` directly. Confirmed: the homepage is
now correctly labeled `page_type: 'homepage'`, and its "Ador produces
world-class products across six manufacturing facilities nationwide"
sentence is now correctly classified `subject: 'company_strategy'` (not
`generic_marketing`), producing a real `multi_location_operations` signal —
exactly the fix this note called for.

**A live full-benchmark run after this fix still showed `min_signals: 0` for
Ador Welding** (WARN, not FAIL — pipeline never hard-fails). Root-caused
this directly rather than assuming it was a regression: the third-person
self-reference match requires the LITERAL resolved company name
(`companyNameFromScrape`, which for this run resolved to "Ador Welding
Ltd" — confirmed via a direct Supabase query against the saved run) to
appear as an exact word-boundary phrase in the text. The real homepage
copy says "**Ador** produces..." (short form), not "Ador Welding Ltd
produces...", so the match never fires with the real resolved name even
though it fires correctly with a shorter name in isolation (verified: works
with `companyName="Ador"`, fails with `"Ador Welding"` or `"Ador Welding
Ltd"` against the identical real content). **This is a separate,
pre-existing precision gap — short-form self-reference vs. a longer
resolved legal name — not something today's fix introduced or was asked to
fix.** Same failure class as `website-discovery.ts`'s already-documented
single-word-name and `isSelfName()`'s domain-guess-imprecision gaps
elsewhere in this file. Logged here for a future session; not fixed now.

**RESOLVED 2026-07-23 — short-form self-reference vs. a longer resolved
legal name (the gap flagged directly above).** `classifySubject()`'s
third-person self-reference block now tries a short-form fallback when the
full resolved company name doesn't match verbatim: a new
`firstSignificantWord()` helper strips unambiguous legal-entity suffixes
(same `LEGAL_SUFFIXES`-style regex as `website-discovery.ts`'s
`normalizeCompanyName()`, deliberately duplicated rather than imported,
same precedent as the other discovery modules) and returns the resolved
name's first significant word — e.g. `"Ador"` from `"Ador Welding"` or
`"Ador Welding Ltd"` — ONLY when the name is genuinely multi-word (a
single-word resolved name has nothing shorter to try, so the existing
full-name check already covers it, unchanged). The short form is only ever
tried as a `\b`-anchored word-boundary regex, never `.includes()` — same
discipline as `matchesKeyword()` in `scraper.ts` (the 'ir'-inside-'wire'
bug class this whole section already warns against). Two guards prevent
reintroducing that exact bug class via the short form itself: a 4-char
minimum length (mirrors the existing floor on the full-name check), and a
new `GENERIC_LEADING_WORDS` stoplist (the/a/an/group/global/national/
international/united/american/indian/general/premier/prime/advanced/
modern/new/smart/digital/tech/star/sun/royal/elite/supreme/leading/first/
top/best/world/universal) — a company whose first word is on this list
(e.g. a hypothetical "Global Industries") does not get the short-form
rescue and falls back to the full-name-only behavior from before this fix;
that's an accepted false-negative trade-off, not a new gap.
Verified with real content from this file's own documented case: Ador
Welding's actual cached homepage copy ("Ador produces world-class products
across six manufacturing facilities nationwide") now correctly classifies
as `company_strategy` and produces a real `multi_location_operations`
signal for `companyName` resolved as `"Ador Welding"` AND `"Ador Welding
Ltd"` (both previously failed, per the paragraph directly above), while a
single-word `companyName="Ador"` continues to work exactly as before (non-
regression). New regression tests in
`tests/evidence-extractor-pagetype.test.ts`: full-name-still-matches
non-regression, both short-form cases (`"Ador Welding"` and `"Ador Welding
Ltd"`), single-word-name non-regression, a negative case confirming the
generic-word guard prevents a false match on an unrelated "Global
manufacturing trends..." sentence for resolved name `"Global Industries"`,
and a negative case confirming the 4-char minimum guard prevents a false
match via `"AS"` (from resolved name `"AS Agri"`) trivially appearing
inside ordinary text. `tsc --noEmit` clean, full suite passing (489/489 in
this branch's current test count, including the 6 new assertions here).

**Same live benchmark run showed a FAIL on ATE Group's `profile_flag:
manufacturer`** (`company_type.manufacturer: false`, contradicting this
file's own 2026-07-11 "verified... now correctly `true` for ATE" note).
Root-caused directly rather than assuming a regression: pulled ATE Group's
current cached scrape content and confirmed the enumerated-capability-list
phrase that fix depended on ("fabrication, machining, control system design
facility") is **not present anywhere in the current scrape** — and
`buildCompanyProfile()` (the function that sets `company_type.manufacturer`)
takes a raw content string directly, with zero dependency on
`detectPageType`/`classifySubject`/`parseContentSegments` (the three
functions touched by today's fix), so it cannot have been affected by this
session's change. This is the same "scraper/content non-determinism between
runs" class of flakiness already documented multiple times elsewhere in this
file for Ador Welding/AITG/A-1 Fence — ATE Group's site content has evidently
drifted since the validation run, not a code regression. Not fixed now (out
of scope — this session's mandate was the detectPageType bug specifically).

## RESOLVED 2026-07-19 — greedy "Head of X" leadership-title regex
The `LEADERSHIP_TITLE_VOCAB` regex's `Head\s+of\s+[A-Za-z\s]{2,40}` branch
used `\s` inside a character class, which matches newlines — so a "Head of
X" title match could greedily swallow across a line break into unrelated
following body text on a busy leadership page. This was flagged (see the
2026-07-18 precision-fixes session below) but deliberately left unfixed to
keep that session scoped. Fixed: the character class now only matches a
literal space (`[A-Za-z][A-Za-z &]{1,39}`), so it can't cross a line break.
New regression test in `tests/evidence-extractor-leadership.test.ts`.

## RESOLVED 2026-07-19 — Contacts-page decision-maker grounding backfill gap
Was: the standalone `/admin/outbound/contacts` page couldn't ground
decision-maker candidates against a company's own scraped leadership
evidence, because that data (`extractorResult.leadershipContacts`) was only
ever threaded through as a live Auto Flow state value, never persisted
anywhere a saved run could read it back — see the grounding fix's own
"Known gap, not fixed" note in the 2026-07-18 precision-fixes session below.

**Turned out to be closer than that note assumed.** The data WAS already
being saved — via `merged._extractor = extractorResult` in
`test-analysis/route.ts` and `_raw: raw` in `normalize.ts` — just buried
under an internal `final_result._raw._extractor.leadershipContacts` path
with no real accessor, the same "reachable only by reaching into an
underscore-prefixed internal field" shape this file already warns against
elsewhere. Fixed properly: promoted `leadership_contacts` to a real
top-level `NormalizedAnalysis` field (`lib/pipeline/normalize.ts`) with a
`getLeadershipContacts()` getter (`lib/pipeline/analysis-sections.ts`,
same convention as `getCompetitors()`/`getICPSegments()`), and wired the
Contacts page to use it. Works for any run saved from now on; a run saved
before this field existed still shows candidates ungrounded rather than
erroring (same as before).

## Production polish pass — 2026-07-19, Tracks 1-3 of a 6-track plan
User asked for a full UI/functionality/accessibility/process polish pass to
make the app production-ready. Explored current state first (12-component
design system, no error/loading/not-found boundaries anywhere, 7/41 files
using any `aria-*`, no CI) and proposed 6 tracks: (1) known-bug fixes —
see the three RESOLVED sections directly above this one, plus the migration/
PDF/model live-verification entries elsewhere in this file, (2) error/
loading states, (3) accessibility, (4) UI/UX consistency, (5) process
smoothness, (6) production hardening (CI, env validation, logging, auth).
Tracks 1-3 are done; 4-6 are not started.

**Track 2 — error & loading states (done).** Found and fixed 4 real silent-
failure bugs, not just added generic boilerplate: (1) `components/wizard/
WizardShell.tsx`'s `if (!result && !running) return null` guard meant a
network-error in `wizard/page.tsx`'s `run()` (which only ever set `error`,
never `result`) rendered nothing at all — the error banner code existed but
never mounted. Fixed the guard, added a `toast.error` too. Verified live by
overriding `window.fetch` to force a rejection — confirmed both the banner
and toast now appear. (2) intelligence-lab's "Clear cache" button had no
try/catch and no loading state, and worse, `lib/cache/scrape-cache.ts`'s
`deleteScrapeCache()` swallowed every DB error and the route always
returned `{success:true}` regardless — fixed both ends, the function now
returns a real boolean. (3) run-history's `deleteRun`/`fetchDetail` had no
error feedback at all — added toasts to both. (4) Auto Flow's
`enqueueAndSend()` (the real email-send path) had zero try/catch around 3
sequential fetches — a network failure was an unhandled promise rejection
with the spinner just stopping silently; wrapped it, and fixed
`sendAllContacts` so it no longer shows a misleading "0 sent, 0 skipped, 0
failed" success toast when the whole operation actually failed. Also added
`app/admin/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx` — none
existed before; a render-time throw anywhere in the app previously had no
boundary at all. All verified live (real 404, simulated network failure,
console-error checks on every touched page) — `tsc --noEmit` clean, 780/780
tests.

**`app/admin/loading.tsx` was added, then removed the same day — real
regression, root-caused, not guessed.** Added initially as a route-transition
loading shell (Track 2), it broke `/admin/auto-gtm` specifically: the whole
page got permanently stuck showing only the loading spinner, forever, no
console error, no server error, SSR HTML confirmed correct via `curl`, every
other page fine. This is the EXACT bug class `useAutoGtmFlow.ts`'s own header
comment already documents in detail: a real Next.js 16 Turbopack dev-mode bug
where a Suspense boundary around this specific page causes its streamed
content to get stuck inside a hidden server-streaming placeholder that never
reveals. That comment's fix was avoiding `useSearchParams()` (which requires
Suspense) — `loading.tsx` retriggered the identical bug via a different path,
since Next.js's App Router automatically wraps the whole route subtree in a
`<Suspense>` when a `loading.tsx` file exists, with no way to opt a single
nested route out of an ancestor's `loading.tsx` boundary short of moving it
to a different route grouping (not justified for a "nice to have" loading
shell). Confirmed by direct removal + re-test: page broke with the file
present, worked immediately once removed, `tsc`/tests unaffected either way.
**Do not re-add `app/admin/loading.tsx` (or any `loading.tsx` that would
wrap `/admin/auto-gtm`) without first re-reading `useAutoGtmFlow.ts`'s
header comment and either solving the underlying Turbopack bug or
structurally isolating that route from the boundary.** `error.tsx`/
`not-found.tsx`/`global-error.tsx` are unaffected — they're React error
boundaries, a different mechanism from Suspense, and don't wrap children in
`<Suspense>`.

**Track 3 — accessibility (done).** Delegated the initial audit to a
sub-agent, then fixed everything it found that was concrete and
verifiable, not speculative. Real functional blockers fixed: (1)
run-history's card row used `role="button" tabIndex={0}` with no
`onKeyDown` — a genuine keyboard dead end (Tab reaches it, Enter/Space do
nothing) — and it wrapped other real `<button>`s inside it, invalid
regardless; removed the fake role, the real "View Report" button already
did the same job accessibly. (2) `components/shell/MobileNav.tsx`'s drawer
had `aria-modal="true"` (a hint to AT, not real enforcement) but no actual
focus trap, no Escape handler, and no focus restore — added all three,
verified live: opening the drawer moves focus to its first link, Escape
closes it and returns focus to the hamburger trigger, confirmed via
`document.activeElement` checks in the browser, not just by reading the
code. Also added: a skip-to-content link (`app/admin/layout.tsx`, none
existed — every keyboard user had to tab through 9+ sidebar links on every
page load), `aria-current="page"`/`aria-current="step"` on the Sidebar/
MobileNav active link and StepIndicator's current step (StepIndicator
previously communicated current/done purely by color), `aria-label` on
~10 previously-unlabeled inputs/textareas/checkboxes across auto-gtm,
wizard, intelligence-lab, company-discovery, campaigns, warmup,
OutreachStep, and GenerationPanel, and `aria-live`/`role="status"` regions
on Auto Flow's research-running/batch-progress/drafting-stage text (the
longest-wait flow in the app — 60-100s research calls — previously gave
screen reader users zero indication anything was happening or had
finished). Verified live: `aria-current` values, the skip link, and the
accessibility tree all confirmed via `read_page`/`javascript_tool` in the
browser, not inferred from source alone. `tsc --noEmit` clean, 780/780
tests, zero console errors across every touched page.

**Track 4 — UI/UX consistency (done).** New `components/ui/alert-dialog.tsx`
(`ConfirmDialog`, built on `@base-ui/react/alert-dialog`, matching the
existing tooltip.tsx wrapper convention) wired into: Auto Flow's Send Email/
Send All (previously fired with zero confirmation at all), `ContactRow`'s
and run-history's delete actions (upgraded from native `window.confirm()`),
and — the real find of this track — **Decision-Maker Discovery's `autoStart`
was silently auto-firing a real, credit-spending Prospeo search the instant
Auto Flow reached that step**, with zero confirmation (confirmed live: the
`decision_maker_discovery` capability's active provider is `prospeo`, not
mock). Gated behind a one-time confirm dialog now — the manual "Search
Again" button stays a single click, since an explicit click is already
consent. Checked Select/dropdown usage (native `<select>`+`<Label>`, already
consistent/accessible, no gap) and empty-state patterns (already consistent
across the app) — neither needed a fix. **A real regression was found and
fixed during this track's own verification**: `app/admin/loading.tsx`
(added in Track 2) permanently broke `/admin/auto-gtm` by retriggering a
documented, pre-existing Next.js 16 Turbopack dev-mode bug — see
`useAutoGtmFlow.ts`'s header comment and its 2026-07-19 addendum. Fixed by
removing that file; confirmed via direct add/remove testing, not inferred.
`tsc --noEmit` clean, 780/780 tests, live-verified end to end.

**Track 5 — process smoothness (done).** Investigated the three planned
items against actual current behavior rather than assuming the original
plan's guesses were still accurate: (1) "raw gate codes instead of clear
failure messaging" — checked, doesn't apply to the production flow (Auto
Flow already uses human-readable error strings throughout
`useAutoGtmFlow.ts`); raw codes only appear in `intelligence-lab`, which is
explicitly the debug/testing harness this file's own Decision 2 says gets
"no further investment" — correctly left alone. (2) "retry a single failed
step" — checked, already works via idempotent button-click patterns
throughout (Research button, decision-maker "Search Again", "Regenerate"
drafts, Send Email/Send All can all just be re-clicked after a failure) —
no fix needed. (3) **Session persistence — found a real gap, not just a
UX nicety.** `resumeFromRun()` (the mid-flow-refresh recovery path) restored
`runId`/`url`/`result`/`contacts` but never `campaignId` or
`campaignContactStatus`. Since `ensureCampaignId()` unconditionally creates
a NEW campaign whenever `campaignId` is null, and send status is scoped
per-campaign (`outbound_campaign_contacts.status`, not a global per-contact
flag), a refresh at the Review & Send step followed by clicking Send All
would create a second campaign and **re-send to contacts already sent under
the first one** — currently silent since sending is mock-only, but a real
duplicate-send bug the moment a real vendor is wired up. Fixed: added an
optional `?source_run_id=` filter to `GET /api/admin/outbound/campaigns`,
and `resumeFromRun()` now looks up any existing campaign for the resumed
run, restores `campaignId`, and maps each campaign-contact row's persisted
status back into `campaignContactStatus` (`'queued'` → not yet sent, stays
absent/retry-eligible; anything past `'queued'` → `'sent'`). Batch mode
(`source_run_id: null` for its campaigns) is unaffected — out of scope,
no single run to key off. **Live-verified with real data, not just unit
logic**: loaded a saved run at step 5 that had a genuine prior campaign
with one contact already sent — before the fix this would have shown both
contacts as sendable; after, the already-sent contact correctly shows
"Sent" (disabled) and "Send All (1)" correctly excludes it. `tsc --noEmit`
clean, 780/780 tests.

**Track 6 — production hardening (done 2026-07-19).** A background survey
first confirmed the actual gaps (not assumed): no `.github/workflows/` at
all, no env-validation module (Supabase's own `createServerClient()`/
`createBrowserClient()` already throw lazily on missing vars — the one
pre-existing pattern), no inbound rate-limiting anywhere, no logger utility
(84 raw `console.*` calls confirmed across exactly 4 route files, 78 of
them in `test-analysis/route.ts`), and Gmail OAuth CSRF already solid
(random `state` + httpOnly cookie, correctly rejects mismatches) with two
real gaps: a non-timing-safe comparison and zero rate limiting on
`/start`/`/callback`.
- **CI**: new `.github/workflows/ci.yml` (checkout → node 20 → `npm ci` →
  lint → typecheck → test → build). New `"typecheck": "tsc --noEmit"`
  script (`next.config.ts` sets `ignoreBuildErrors: true`, so `next build`
  alone proves nothing about types). Lint is `continue-on-error: true`, not
  blocking — the full-repo `npm run lint` surfaced ~1000+ pre-existing
  errors with zero overlap with anything touched this session (confirmed by
  grep), and this repo's own verification discipline has only ever cited
  `tsc --noEmit` + tests, never lint, so blocking on unrelated debt would
  just make CI permanently red.
- **Env validation**: new `lib/env.ts`'s `validateEnv()` — required vars
  (Supabase URL/anon key/service-role key) throw one aggregated error;
  everything else (`ADMIN_SECRET`, vendor API keys, Gmail OAuth creds) is
  optional-with-a-warning, matching this repo's graceful-degradation
  philosophy. Wired via new `instrumentation.ts`'s `register()`
  (`NEXT_RUNTIME === 'nodejs'` gated), which only runs at real server boot
  (`next dev`/`next start`), never during `next build`.
- **Rate limiting**: new `lib/rate-limit.ts` — in-memory fixed-window
  counter (no Redis/external store; single-instance `next start`, documented
  as a known limitation like other gaps in this file). Wired into
  `verifyAdminRequest()` (`lib/admin/auth.ts`, the one choke point already
  called by all 32 admin route files) at 120 req/60s per IP, checked before
  the `ADMIN_SECRET` bail-out so it applies either way. Gmail `/start` and
  `/callback` (which can't use `verifyAdminRequest` — browser-redirect
  routes, no `x-admin-token`) each got their own direct 10 req/60s check.
- **Structured logging**: new `lib/logger.ts` (thin wrapper, not a new
  dependency — JSON lines in production, human-readable `[scope] message`
  in dev, preserving the bracket-tag convention already used ad hoc). All
  84 `console.*` calls in the 4 affected route files converted; `lib/` and
  every other route file were untouched (zero console calls there to
  begin with).
- **Gmail OAuth CSRF**: the `state` comparison in `callback/route.ts` now
  uses length-check-then-`crypto.timingSafeEqual` instead of `!==` (small
  `timingSafeEqualStr()` helper, duplicated in `lib/admin/auth.ts` for its
  own admin-token comparison too — same duplication-over-sharing precedent
  as the discovery modules). No other change — the state-cookie pattern,
  `sameSite: 'lax'`, `maxAge: 600`, single-use cookie deletion were already
  correct.
- **Verified**: `tsc --noEmit` clean, full suite 792/792 (780 pre-existing +
  12 new — `tests/rate-limit.test.ts`, `tests/admin-auth.test.ts`, the
  latter using real `NextRequest` instances, no prior precedent for that in
  this repo's tests). Live dev-server pass (had to restart a stale `next
  dev` process from before this session, with explicit user confirmation
  first, since instrumentation.ts requires a real boot to run): boot log
  showed `[env] Optional env var(s) not set...: ADMIN_SECRET` then `[env]
  Env validation complete`, exactly as designed; hammering
  `DELETE /api/admin/scrape-cache` 125x returned 429 with `Retry-After: 36`
  starting at request 121; hammering the Gmail `/start` route 12x returned
  429 starting at request 9 (its own independent 10/60s budget); normal
  page traffic (`GET /`) unaffected throughout; zero server or console
  errors.
- **Not done, real next step for whoever picks this up**: the ~1000+
  pre-existing lint errors surfaced by this session's `npm run lint` run
  are untouched (out of scope — Track 6 was production-hardening
  infrastructure, not a lint-debt cleanup) — worth its own session if lint
  is ever meant to be a real gate.

## RESOLVED 2026-07-23 — the "~1000+ pre-existing lint errors" note above is stale
Ran the planned "bounded lint cleanup pass" this session and found the
premise had already changed: `npm run lint` (`eslint`, flat config in
`eslint.config.mjs`) currently reports **0 errors, 0 warnings** across all
229 linted files — not ~1000+. Did not take this at face value; verified it
three ways before trusting it: (1) `npx eslint . -f json` parsed
programmatically, summed `errorCount`/`warningCount` across all 229 file
entries — both totals genuinely 0, not an empty/truncated report; (2) a
deliberate probe file with an intentionally unused variable
(`lib/pipeline/__lint_probe.ts`, deleted after the check) correctly
triggered `@typescript-eslint/no-unused-vars` as a warning, confirming
ESLint is actually running the real ruleset against real files, not
silently no-op'ing; (3) `npm run lint -- --fix` produced a byte-identical
working tree (`git status --short` empty before and after) — nothing to
autofix, consistent with a genuine 0-error baseline rather than a broken
lint invocation.
**Root cause of the discrepancy, not fully confirmed but the most likely
explanation**: the Track 6 commit that first measured "~1000+ errors"
(`dcc2156`, 2026-07-19) is the SAME commit that added the `.claude/**` and
`**/.next/**` `globalIgnores` entries to `eslint.config.mjs` (visible in
that commit's own diff). If the ~1000+ figure was measured before those
ignores were added in that session — plausible, since a repo that gets
built/dev-served frequently will have a `.next/` output directory, and this
repo's own worktrees live under `.claude/worktrees/`, both of which used to
be linted as if they were source — that alone could produce noise in the
thousands (generated build output triggers many stylistic rules). The
ignores were added but lint was apparently never re-run afterward to
confirm the count actually dropped, so the stale "~1000+" figure sat
undisturbed in this file for 4 days. Separately, commit `3287205`
(2026-07-22, "resolve lint errors") fixed 4 real react-hooks violations
found via a targeted pass, which may have closed out whatever small
residual count was left after the ignore fix. Not independently verified
by reproducing the original 1000+ count (would require checking out
`dcc2156`'s parent with a real `.next/` dir present, not worth the spend to
confirm a now-moot historical number).
**What this session actually did, given the above**: ran the full planned
sequence anyway rather than stopping early — `npm run lint` (0/0 baseline),
`npm run lint -- --fix` (no-op, confirmed via clean `git status`),
`npx tsc --noEmit` (clean), `npm test` (483/483 passing, 36 test files —
lower than this file's most recent "1114/1114" figure elsewhere, because
this worktree's branch (`f30238c`) predates several later sessions
documented above, e.g. the 2026-07-22 research-quality initiative's test
files aren't present on this branch; not a regression, just a
branch-currency gap, not investigated further as out of scope for a lint
task), `npm run lint` again (still 0/0). No categorized "remaining errors
by rule" breakdown follows, because there is nothing remaining to
categorize. **Standing recommendation for whoever next touches this**: if a
future `npm run lint` run on a fully up-to-date branch/checkout resurfaces
a large error count, suspect a `.next/` build directory or another
worktree's contents leaking into the lint scope before assuming the
codebase itself regressed — that's the exact failure mode this note
suspects caused the original ~1000+ figure.

## Model quality verdict — SUPERSEDED 2026-07-18, was "DO NOT relitigate"
Original verdict (kept for history): evaluated whether model quality is the
bottleneck, concluded no — architecture fixes ~+30% vs model upgrade ~+5-10%,
current open/free models (DeepSeek, GLM, Qwen, Llama) sufficient, failures
are scraping/classification/signals/timeouts/parsing not reasoning quality.

**This was already stale before today** — `lib/ai/provider-factory.ts`'s
actual chain had drifted to `nvidia/nemotron-3-ultra-550b-a55b` (NVIDIA NIM
primary) + `deepseek-v4-flash`/`deepseek-v4-pro`/`glm-5.2` (OpenRouter
fallback), not the DeepSeek/GLM/Qwen/Llama set this verdict evaluated. There
is also live, non-hypothetical evidence the current primary model
contributes to real failures: a code comment in
`lib/pipeline/business-profile.ts` (~154-198) documents nemotron-3-ultra
burning an entire token budget on chain-of-thought preamble with zero JSON
emitted, and truncating mid-string even at 2048 tokens — a plausible
contributor to zero-pain-point/zero-opportunity outputs on content-rich
companies (see the 2026-07-18 precision-fixes session below).

**Changed 2026-07-18**: `minimaxai/minimax-m3` promoted to the default
NVIDIA NIM model (was second in the chain); `thinkingmachines/inkling`
(Thinking Machines Lab, reasoning MoE, controllable thinking effort) added
as second; `nvidia/nemotron-3-ultra-550b-a55b` kept as third fallback, not
deleted. OpenRouter chain gained `poolside/laguna-xs-2.1` (MoE
coding/agentic model) as new default first entry, with
`deepseek-v4-flash`/`deepseek-v4-pro`/`glm-5.2` kept after it. This was a
config/ordering change only — `getCompletion()`'s try-each-in-order
fallback logic, per-call `max_tokens: 4096`, and `LLM_TIMEOUT_MS=90000` are
all unchanged. **Not yet live-verified** — no real NVIDIA/OpenRouter call
was made against `thinkingmachines/inkling` or `poolside/laguna-xs-2.1`
through this codebase's actual prompt shapes (JSON-mode expectations,
4096-token budget) — both are brand-new to this repo, worth a live smoke
test (real quota, explicit confirmation) before trusting them in a real
run. A `reasoning_effort`-style control for Inkling was considered and
deliberately NOT wired in — `nvidia-nim.ts`'s request builder only forwards
a fixed field list, no passthrough exists, and NVIDIA's actual param name
for this is unverified; guessing risked breaking every Inkling request.

## RESOLVED 2026-07-19 — model chain live smoke test (was "Not yet live-verified" above)
**The paragraph above this one is itself stale** — `lib/ai/provider-factory.ts`'s
actual current chain (its own header comment dated 2026-07-18) had already
moved on from what's described above: OpenRouter was removed entirely (the
whole `poolside/laguna-xs-2.1` fallback chain described above no longer
exists — `lib/ai/providers/openrouter.ts` is deleted), and within NVIDIA NIM,
both `minimaxai/minimax-m3` and `nvidia/nemotron-3-ultra-550b-a55b` were
already live-tested and DROPPED for cause (minimax-m3: "consistently hit the
full 90s LLM_TIMEOUT_MS in live production runs"; nemotron: the documented
CoT-token-burn bug). The real current chain is `thinkingmachines/inkling`
(default) → `openai/gpt-oss-120b` → `deepseek-ai/deepseek-v4-pro`, all three
already claimed "confirmed working" by that same header comment. Lesson: this
file's own narrative sections can lag actual code by more than a day even
when both carry the same date — check the file, not just this doc, before
trusting a "not yet verified" note.

**Live-verified today anyway** (real NVIDIA NIM quota, explicit confirmation
given first): ran one real `getCompletion()` call through the actual
production chain with a realistic ~2000-char multi-page scraped-content
prompt in JSON mode (4096 max_tokens, matching production exactly).
Result: **`thinkingmachines/inkling` (the current default) failed live** —
returned reasoning-channel-leaked garbage (`{"{" \t: "company_summary" \t,
"  : " \t: "`), exactly the failure mode `provider-factory.ts`'s own
`looksLikeJson()` guard and comment already anticipated and defend against.
This contradicts that same file's "confirmed working... clean JSON" claim
for inkling — at minimum, inkling is flaky/inconsistent on this prompt
shape, not reliably clean. **The fallback mechanism itself worked
correctly**: the factory caught the malformed response, discarded it, and
fell through to `openai/gpt-oss-120b`, which succeeded cleanly (3.4s,
864 tokens, valid JSON matching the requested schema exactly). Net
takeaway: the chain as a whole is healthy end-to-end (a real completion was
obtained), but inkling's "default, clean JSON" status should not be trusted
without a fallback — which, correctly, this code doesn't do. Not changing
the chain order based on a single sample; flagging for whoever next touches
this file to weight accordingly if inkling keeps failing.

## RESOLVED 2026-07-22 — `thinkingmachines/inkling` dropped from the chain entirely
The "single sample, don't overreact" caveat above no longer holds — real
production traffic (outbound contact generation: subject lines, emails,
follow-ups) surfaced a full session's worth of live `[AI]` log evidence, not
one call. Inkling failed roughly 9 times to 1 success across that log:
empty/malformed JSON (the same reasoning-channel-leakage mode flagged
above), a `429` rate-limit, and two full 90s timeouts. `openai/gpt-oss-120b`
— second in the chain, so silently absorbing nearly all of inkling's
failures as the fallback — succeeded 7 times to 2 failures over the same
log, i.e. was already the de facto default in practice.
**Fixed** (`lib/ai/provider-factory.ts`): `thinkingmachines/inkling` removed
from `NVIDIA_NIM_MODELS` entirely (not just reordered — it had no track
record of being reliable enough to keep as a third-tier fallback either).
New chain: `openai/gpt-oss-120b` (default) → `deepseek-ai/deepseek-v4-pro`
(fallback, 100% success rate on the same live log whenever it was reached).
`getDefaultProviderName()` updated to `'nvidia_nim_gpt_oss_120b'`. Also
removed a now-dead comment in `lib/ai/providers/nvidia-nim.ts` that
speculated about an inkling-specific `reasoning_effort` param — moot once
inkling is gone. `.env.example`'s `NVIDIA_NIM_MODEL` override comment
updated to match. **Not live-verified with a fresh run** — this change is
config-only (same `NvidiaProvider` class, same request shape, same
fallback mechanism already proven correct in the entry above), so
`tsc --noEmit` clean was treated as sufficient; if `openai/gpt-oss-120b`
itself starts failing at scale as the new default, re-open this note rather
than assuming the 2-model chain is automatically safe.

## Research-quality initiative — 2026-07-22, Session 1 of 3 (in progress)
Triggered by a real Auto Flow run against Reliance Industries showing 5 pain
points but 0 opportunities, and the user reporting this now happens with
almost all companies, not just RIL — asked for a broad content-quality pass,
not just an opportunities fix. Root-caused via a real-data investigation (RIL's
full saved result + a survey of the last 50 saved runs in the DB) before
proposing anything; see the approved plan for full detail. Three root causes
found, most-foundational first:
1. **The narrative LLM call was evidence-starved.** `websitePreview` (the
   ONLY raw content block the LLM ever sees) was the first 3,000 chars of
   SCRAPED content only — the enriched external-source content (annual
   reports, investor pages, press, PDFs — 17,919 real chars for RIL) was
   captured for the regex-based `service-evidence.ts` gate but never actually
   shown to the LLM. Confirmed via real token-usage logging: RIL's real
   prompt used only 5,770 user-prompt tokens, nowhere near a context-window
   constraint — the cap was arbitrary, not load-bearing.
2. **`opportunities` is hard-gated by a narrow regex catalog** tuned to 6
   benchmark companies (`service-evidence.ts`) — the LLM's own reasoned
   `ai_opportunities` (instructed to always produce 3-5) are silently
   discarded unless a literal phrase match already fired in code. Confirmed
   via the 50-run survey: 0 opportunities for the large majority of companies
   including Reliance, GM, Boeing, GE, Lockheed Martin, Mercedes-Benz.
3. **`pain_points` bypasses evidence gating entirely** — always exactly 3-5,
   generic, unverified against real content, identical in shape between
   Fortune-500-with-massive-disclosure companies and thin-content companies.
   `StructuredPainPoint`'s `confidence`/`evidence_id`/`evidence` fields exist
   in the type but are dead — the LLM only ever emits flat strings today.

**Session 1 (done) — fixed root cause 1.** `lib/pipeline/evidence-extractor.ts`'s
`websitePreview` construction (~1410-1426) now builds from `combined`
(scraped + enriched, the same pool signal extraction already uses) instead of
scraped-only `websiteContent`, and the cap raised from 3,000 to 16,000 chars.
`lib/prompts/analyze-v2.ts`'s `NarrativePromptInput.websitePreview` doc
comment updated to match. **Verified live**: re-ran `ril.com` force-fresh
before/after — user-prompt tokens jumped from 5,770 to 8,896 (real evidence
now reaching the LLM), pipeline still completed cleanly (30.6s LLM call, 86s
total, comfortably under the 150s per-provider timeout raised earlier this
session), `success: true`. Ran the full 6-company benchmark suite
(cached scrape, real LLM calls) as the regression guard: Ador Welding stayed
at exactly 3 opportunities (PASS, the required non-regression check), Ace
Pipeline/AS Agri correctly stayed near 0 (genuinely thin evidence, a
documented correct outcome, not a bug), evaluation mean score held/improved
slightly (58.63 → 59.08 vs the 2026-07-19 baseline). ATE Group FAILed on
`primary_type` (expected manufacturer, got industrial_vendor) — confirmed
this is the same pre-existing scrape-content-drift flakiness already
documented multiple times elsewhere in this file for ATE Group specifically,
not caused by this change: `buildCompanyProfile()` (the function that sets
`primary_type`) reads only the untouched `websiteContent` param, never the
`combined` pool this session's edit touched. `tsc --noEmit` clean, full
suite 1093/1093 passing.

**Session 2 (done) — fixed root cause 2.** Added an additive, evidence-grounded
second path for `opportunities` — the existing regex-gated deterministic path
(`opportunity-engine.ts`/`service-evidence.ts`) stays completely untouched;
this is Path B alongside it, not a replacement.
- New `lib/pipeline/quote-verification.ts`: `verifyQuoteInContent(quote,
  content)` — exact tier (whitespace/quote/dash-normalized substring match)
  checked BEFORE the close-tier fuzzy path, not after — an earlier draft
  gated the exact-match check behind an "8+ significant words" filter meant
  only for the fuzzy path, which wrongly rejected short-but-genuine verbatim
  quotes (caught by this session's own unit tests, fixed before verifying
  live). Close tier requires ≥0.75 word-overlap ratio AND a real shared
  4-word run, so two unrelated sentences sharing only common words don't
  false-positive. `tests/quote-verification.test.ts`, 10 assertions.
- `opportunity-engine.ts`: exported `CONFIRMED_SERVICE_NAMES` (the literal 8
  service-line strings) as a whitelist.
- `analyze-v2.ts`: `ai_opportunities` schema gained a `service_line` field
  ("copy exactly one of these 8 names") and a RULES bullet requiring
  `evidence` to be a real verbatim quote when `claim_type` is `observed`,
  same copy-exactly discipline already used for `competitors`/`icp_segments`.
- `normalize.ts` opportunities merge: Path A (deterministic) now tracks which
  LLM opportunities it already consumed (`matchedLlmOpportunities`, by
  reference); Path B takes the genuine remainder, keeps only
  `claim_type === 'observed'` (closes the "infer if no evidence" back door —
  inferred claims have no quote to verify by definition) AND `service_line`
  in the 8-name whitelist AND a quote-verified `evidence` — verified against
  `extractorData.websitePreview` specifically (the SAME capped, blended
  content pool the LLM was actually shown per Session 1), not the larger
  unbounded `_service_evidence_content` pool, since that would let
  verification pass on content the LLM never saw. Tagged
  `source: 'llm_verified'`, `relevance` capped at `Medium`/`Low` (never
  outranks a real deterministic-strong match).
- **Verified live against RIL** (`ril.com`, force-fresh): opportunities went
  from 0 to 1 — `"Predictive Maintenance for Jamnagar Refinery Operations"`,
  evidence-quoted from RIL's own real homepage copy ("Our refinery at
  Jamnagar is the world's largest, integrated, single-location refining
  complex"), correctly tagged `llm_verified`/`Medium`. **Verified live
  against Ador Welding** (force-fresh, isolated re-run): opportunities went
  from 3 to 5 — the 2 new `llm_verified` entries both cited real, specific
  recent news content ("Ador Showcases Advanced Welding Cobots and Robotic
  Solutions at E Manufacturing EXPO 2026", a digital-welding-technology
  interview quote) — genuinely grounded, not the old "generic Digital
  Transformation for everyone" anti-pattern this rebuild exists to avoid.
- **Benchmark regression check found a real transient failure, root-caused
  before accepting the result**: an initial full-suite run showed Ador
  Welding hard-failing (`fetch failed`, 0/100, mean score 46.75 vs the
  58.63-to-59.08 baseline). Did not accept this at face value — re-ran Ador
  Welding alone immediately after and it succeeded cleanly (110s, 5
  opportunities), confirming the failure was the same one-off scraper/network
  flakiness this file already documents extensively for this exact company
  elsewhere (unrelated to this session's changes, which only touch
  already-scraped content well downstream of the fetch layer). A clean
  re-run of the full 6-company suite confirmed it: mean **60.98/100** (up
  from the 58.63 pre-fix baseline), Ador Welding and A-1 Fence Products both
  PASS, Ace Pipeline/AS Agri correctly stayed near 0 opportunities (genuinely
  thin evidence, the required non-regression check). ATE Group still FAILs
  on `primary_type` (expected manufacturer, got industrial_vendor) — same
  pre-existing, already-documented content-drift flakiness for this company,
  unrelated to this session. `tsc --noEmit` clean, full suite 1103/1103
  passing.

**Session 3 (done) — fixed root cause 3.** `pain_points` now has a real
structured schema + evidence gating, mirroring Session 2's discipline.
- `analyze-v2.ts`: `pain_points` schema changed from flat strings with an
  inline "(observed)"/"(inferred)" suffix to structured objects
  (`title`/`claim_type`/`evidence`/`confidence`/`reasoning`). The "ALWAYS
  generate 3-5 ... NEVER return []" rule was softened to evidence-aware
  wording ("generate as many as you have genuine evidence or sound inference
  for, typically 2-5 ... never mark claim_type observed without a real
  quote") — this is the literal implementation of a comment that had sat
  dead in `normalize.ts` since the "Insufficient Evidence outcome" section
  was written, flagging this as "arguably correct" but never wiring it up.
- `normalize.ts` `StructuredPainPoint` gained `claim_type?: 'observed' |
  'inferred'`. The pain_points block (was a pure passthrough) now: forces
  `[]` when `insufficientEvidence` fires (same suppression as
  `deterministic_opportunities`); for `claim_type === 'observed'` items,
  quote-verifies `evidence` via `isQuoteGrounded()` (Session 2's utility,
  reused directly, not re-implemented) against the same `llmContentPool`
  (`extractorData.websitePreview`) opportunities Path B uses — dropped items
  push a `pain_points: dropped N item(s)...` message into
  `validation_warnings`; `claim_type === 'inferred'` items are kept without
  needing a quote (legitimate business-model reasoning); the old flat-string
  shape is still accepted as a backward-compat fallback (can't be
  quote-gated, no evidence field on a bare string). `llmContentPool` was
  hoisted to right after `insufficientEvidence`'s computation (was declared
  later, inside Session 2's Path B block) so both pain_points and
  opportunities Path B share one computation instead of duplicating it.
- **Fixed the latent bug flagged during planning**:
  `lib/outbound/generation/assemble-input.ts`'s `painPointText()` checked
  `item.point`/`item.description`/`item.text` but never `item.title` —
  `StructuredPainPoint`'s real field. This was invisible before this session
  (`pain_points_structured` was always `[]`, so the flat-string fallback
  silently did all the work) but would have made this session's gating work
  have zero effect on generated outreach emails if left unfixed.
- New `tests/pain-points-grounding.test.ts` (5 assertions, calling
  `normalizeAnalysisResult()` directly with minimal `raw` input — same
  pattern as the existing `tests/outreach-draft-grounding.test.ts`): keeps a
  real-quote observed claim, drops a fabricated-quote observed claim (and
  logs the warning), keeps an inferred claim without a quote, forces `[]` on
  insufficient evidence even when the LLM returned items, and confirms the
  old flat-string shape still passes through for backward compat.
- **Verified live against RIL** (force-fresh): pain_points went from a rigid
  "always exactly 5" to 4 — all correctly tagged `claim_type: 'inferred'`
  with real company-specific reasoning (Jamnagar refinery scale, petrochemical
  quality-at-scale, multi-business-line supply chain), zero fabricated
  "observed" quotes. No `validation_warnings` fired this run (0 observed
  claims attempted, nothing to drop).
- **Benchmark regression check found 2 transient failures, root-caused
  before accepting the result** — same discipline as Session 2's Ador
  Welding flake: a full 6-company run showed AITG (`fetch failed`) and ATE
  Group (`All AI providers failed` — `Connection error` on BOTH
  `gpt-oss-120b` and `deepseek-v4-pro`) hard-failing, dragging the mean to
  39/100. Did not accept this — re-ran both companies alone immediately
  after and both succeeded cleanly (AITG: 5 pain points/1 opportunity; ATE
  Group: 2 pain points/1 opportunity). These are network-layer failures
  (generic fetch/connection errors, not application logic) on code paths
  (`normalize.ts`/`analyze-v2.ts`, pure post-LLM-response data processing)
  that cannot cause a network connection failure — consistent with this
  file's own extensively pre-documented scraper/API flakiness pattern for
  benchmark runs, not a regression. Did not re-spend quota on a third full
  6-company run given the isolated re-runs already confirmed correct,
  evidence-aware behavior for exactly the two companies that failed (ATE
  Group's 2 pain points, not a padded 5, is itself a correct example of this
  session's intended behavior). `tsc --noEmit` clean, full suite 1108/1108
  passing.

**RESOLVED same day (2026-07-22) — opportunities Path B was silently
discarding every 'inferred' opportunity, found via live production usage
right after Session 3 shipped.** The user re-ran Reliance Industries through
the real `/admin/intelligence-lab` UI post-fix and still saw "No
opportunities identified" despite 5 solid pain points. Investigated the
actual saved run rather than guessing: the LLM HAD proposed 5 specific,
RIL-grounded opportunities that run (e.g. "Integrating new-energy assets
with legacy oil-to-chemicals systems", tied to RIL's real, publicly known
Green Energy Giga Complex) — but Path B (Session 2) only ever accepted
`claim_type: 'observed'` + quote-verified opportunities, and this run's LLM
output was 100% `'inferred'` (reasonable — RIL's real content describes what
they do, not admissible internal-pain quotes). Path B silently dropped all 5
by design, an oversight: pain_points (Session 3, same file) already proved
`'inferred'` claims can surface safely when honestly labeled — that
allowance was just never extended to opportunities.
- **Fixed** (`normalize.ts`): Path B split into two sub-paths sharing one
  `opportunityCandidates` prefilter (never already matched by Path A,
  `service_line` in the 8-name whitelist, suppressed under
  `insufficientEvidence`) and one `shapeOpportunity()` helper. Sub-path B1
  (unchanged) is the existing `'observed'` + quote-verified path. New
  sub-path B2 (`'llm_inferred'`) surfaces `claim_type: 'inferred'`
  opportunities that have a real, substantive `inferred_from` (≥15 chars,
  not an empty/placeholder token) — tagged `source: 'llm_inferred'`,
  `relevance` always `'Low'` (the lowest tier, below even the fuzzy-matched
  observed tier, since this is reasoning not evidence). Added
  `'llm_inferred'` to the `opportunities[].source` type union rather than
  reusing `'llm_verified'` for something that was never quote-verified —
  honesty about what actually happened, matching this field's own purpose.
- New `tests/opportunities-grounding.test.ts` (6 assertions): observed+real
  quote surfaces as `llm_verified`; inferred+substantive basis surfaces as
  `llm_inferred`/`Low`; inferred with a vapid basis ("general") is dropped;
  observed+fabricated quote is dropped (does NOT silently fall back to the
  inferred path — a specific anti-regression case, since that fallback would
  have quietly defeated B1's whole quote-verification point); wrong
  `service_line` dropped; suppressed entirely under insufficient evidence.
- **Verified live against the exact RIL case that surfaced this**:
  opportunities went from 0 to 3 — 1 `llm_verified` (a real quote about
  RIL's New Energy ecosystem) + 2 `llm_inferred` (petrochemical quality
  analytics, retail/energy supply-chain automation), both with real,
  specific `inferred_from` bases, both correctly capped at `relevance: 'Low'`.
- **Benchmark regression check, spot-checked by hand, not just by count**:
  Ace Pipeline and AS Agri and Aqua — both long-documented in this file as
  "correctly 0 opportunities, genuinely thin evidence, not a bug" — jumped to
  4 opportunities each in the same benchmark run. Did not accept the count
  alone as proof of no regression: pulled both companies' actual opportunity
  content directly. Every single one traced to a real, specific signal
  already present in that company's own evidence (Ace Pipeline: "posted
  Robotics Automation Engineer role", "cross-country pipeline execution and
  recent HDD activity", "pipeline integrity management service line"; AS
  Agri: "hiring ML engineer", "multiple farm locations", "aquaculture
  offering") — not the old generic "Digital Transformation for everyone"
  anti-pattern, and both companies' `evidence_sufficiency` was genuinely
  `'sufficient'` in this run (at least one real signal existed), so the
  untouched `insufficientEvidence` hard gate — the actual mechanism behind
  the "no forced fit" documentation for these two companies — never fired
  and remains the real backstop for genuinely zero-evidence companies. This
  is the initiative's intended behavior extending correctly, not a
  regression of that prior documented finding. `tsc --noEmit` clean, full
  suite 1114/1114 passing.

**All 3 sessions of the 2026-07-22 research-quality initiative are now
complete and live-verified.** Net effect: the narrative LLM now sees ~16,000
chars of real blended scraped+enriched content instead of 3,000 scraped-only
chars; opportunities can surface via a quote-verified LLM path when the
narrow regex catalog finds nothing (proven on RIL, GM/Boeing/Mahindra-shaped
companies, and additively on the existing 6-benchmark set); pain_points are
honestly evidence-labeled and variable-count instead of a rigid padded-to-5
list. Downstream, confirmed by reading the actual consumers: both fields
feed real outbound email generation directly
(`lib/outbound/generation/assemble-input.ts`, `prompts.ts`), so this
initiative improves generated email quality, not just the report UI.
Checked and ruled out a scoring-formula change: `outreach_priority_score`
does NOT currently read `opportunities` at all (traced `normalize.ts`'s
scoring block + `scorer.ts` — purely `detected_factors`/`signal_clusters`
driven), so nothing to adjust there. `SIGNAL_PATTERNS` broadening remains
explicitly deferred (see the plan's "Explicitly deferred" section) — worth
revisiting only if a future session finds signal-sparse runs are still a
real bottleneck after this initiative's changes.

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

## Outbound Workflow Modules — scope override (2026-07-17)
**This section partially supersedes "DO NOT WORK ON RIGHT NOW" above.** The
user explicitly authorized building architecture + mock providers for the
full outbound send loop now, on the basis that everything below is
mock-only — no real vendor calls, no real keys, no real sends — so there is
no actual vendor risk in building the scaffolding today. This does NOT mean
the underlying vendor decisions themselves have been made; it means the
*shape* of the code no longer has to wait for them.

**What this unblocks**: the *"Email-finding, generation, QA, or send
implementation"* bullet in "DO NOT WORK ON RIGHT NOW" — Email Finder, Email
Validation, Contact Enrichment, Subject Line/Email/Follow-up generation,
Email Sending, and Email Warm-up now have real (mock-provider-backed)
scaffolding, or will as each session below lands.

**What stays blocked, unchanged**: the *"Decision-maker/contact discovery
implementation"* bullet and the LinkedIn-scraping exclusion. Email Finder
and Contact Enrichment take a person name as **manual input** — optionally
pre-filled from already-extracted `leadershipContacts` in existing pipeline
output — never auto-discovered or ranked by this codebase. `linkedinUrl` is
a manually-pasted optional field, never scraped. A future session proposing
real Apollo/PDL/Proxycurl-style *auto-discovery of who to contact* still
needs its own explicit scope decision — this override doesn't reach that far.

**Standing convention for all 8 modules** (mirrors `lib/ai/types.ts` +
`lib/ai/provider-factory.ts`, the existing AI-provider template): one
capability = one `*Provider` interface (`name`, `displayName`, the
capability's method(s), `isAvailable()`) in `lib/outbound/<module>/types.ts`,
one file per implementation under `lib/outbound/<module>/providers/`
(`mock.ts` first, real vendor classes later), one `provider-factory.ts` per
capability. Provider selection order: (1) `outbound_integrations` DB row
where `capability=X AND is_active=true` → use its `provider_name`; (2) env
var `OUTBOUND_<CAPABILITY>_PROVIDER`; (3) `'mock'`. Adding a real vendor
later is: implement one provider class → add its API key env var → flip
`is_active` in the `/admin/outbound/integrations` settings page (or the env
var if no DB row exists) — no other code changes needed.

Credentials are encrypted at rest via AES-256-GCM
(`lib/outbound/settings/credential-crypto.ts`), keyed by
`CREDENTIALS_ENCRYPTION_KEY` (32 raw bytes, base64). This is the platform's
first credential-at-rest store — no other table stores secrets.

**Migrations**: `005_outbound_integrations.sql` (done, 2026-07-17) — the
`outbound_integrations` settings table, seeded with one active `'mock'` row
per capability. `006_outbound_contacts.sql` (Email Finder session) through
`009_outbound_warmup.sql` (Warm-up session) are planned but not yet built —
see the plan file / session breakdown for the full numbering.

**Sessions so far — all 7 planned sessions are now code-complete
(2026-07-17).** `tsc --noEmit` clean and full vitest suite passing (402
tests) after every session. Two things still need the user to do manually
before this is live end-to-end: (1) run migrations 005-009 in the Supabase
dashboard SQL editor (same manual-apply process as every prior migration
in this repo — none of 005-009 have been applied to the live DB yet, only
005 was spot-checked against a real (pre-migration) 500 response); (2) a
live click-through of the full contact -> generate -> campaign -> send ->
warmup flow with a real Supabase connection has not been done — only
Session 1's page got a live dev-server pass this round; sessions 2-7 were
verified via `tsc`+tests+dev-server-compiles-cleanly, following this
repo's own "verify via tsc+tests+dev-server, defer live run" precedent for
quota/DB-dependent work (see Competitor Discovery Engine's own session
history above for the same pattern).

- **Session 1** — Integrations Settings foundation:
  `lib/outbound/settings/{types.ts, credential-crypto.ts,
  provider-selection.ts}`, migration 005, `GET/PUT /api/admin/outbound/
  integrations[/capability][/test]`, `/admin/outbound/integrations` settings
  page (5 stacked capability cards), new nav entry. 7 new
  `credential-crypto.test.ts` assertions (round-trip, tamper detection via
  GCM auth failure, wrong-key rejection, missing/malformed-key errors).
- **Session 2** — Email Finder: `lib/outbound/email-finder/*` +
  `lib/outbound/shared/mock-utils.ts` (`seededRatio`/`seededPick`, the
  deterministic-mock helper every later session's mock provider reuses),
  migration 006 (`outbound_contacts` — created with all finder/validation/
  enrichment columns up front, only finder columns wired this session),
  `POST /api/admin/outbound/contacts`, `GET ?source_run_id=`,
  `POST /[id]/find-email`, new `/admin/outbound/contacts` page + `Contacts`
  nav entry. Domain comes straight from the selected `pipeline_test_runs.
  domain` — no new domain-resolution logic.
- **Session 3** — Email Validation: `lib/outbound/email-validation/*`
  (role-based inboxes like `info@`/`sales@` forced to `unknown` rather than
  a random score band), `POST /[id]/validate-email`, Validate button added
  to the same contact row.
- **Session 4** — Contact Enrichment: `lib/outbound/enrichment/*` — the one
  mock that prefers already-known research data
  (`pipeline_test_runs.final_result.company_size_estimate`/`.industry`)
  over invented fixtures when available, `POST /[id]/enrich`, Enrich button
  + expandable detail panel.
- **Session 5** — Combined Generation (Subject Lines + Email + Follow-ups):
  `lib/outbound/generation/*` — no vendor abstraction here, calls the
  existing `getCompletion()` AI chain directly. `assemble-input.ts` builds
  `EmailGenerationInput` from `lib/pipeline/analysis-sections.ts` getters
  (`getOpportunities`/`getExecutiveBrief`/`getOutreachIntelligence`/
  `getPainPointsStructured`) plus `data.recent_activity` — reused exactly
  as `ResearchCard.tsx` reads them, nothing re-derived. Prompts carry an
  explicit anti-hallucination rule (only reference facts already in the
  input). Migration 007 (`outbound_generated_content`, one row per contact,
  upserted on regenerate). New routes: `generate-subject-lines`,
  `generate-email` (body: `subjectLine`), `generate-followups` (uses the
  saved `email_draft` by default, or a `emailDraft` override for SDR-edited
  copy), plus `GET/PATCH generated-content` for loading state and
  Approve/Edit. UI: `GenerationPanel.tsx`, a Tabs-based panel (Subject
  Lines/Email/Follow-ups) opened via a new "Outreach" toggle on the contact
  row.
- **Session 6** — Email Sending: `lib/outbound/sending/*` (providers are
  stateless — `outbound_campaigns`/`_contacts` own all state, mirroring the
  warmup provider's `startedAt`-passed-in design from Session 7). Migration
  008 (`outbound_campaigns`, `outbound_campaign_contacts`,
  `outbound_campaign_events`). `POST /send` is a sequential loop (not
  `Promise.all`) over queued contacts; a contact missing an email or a
  generated draft is skipped (stays `queued` for retry), never silently
  marked sent. New `/admin/outbound/campaigns` page + `Campaigns` nav
  entry, UI copy explicit that this is mock-only — no real email is
  delivered by this page.
- **Session 7** — Email Warm-Up: `lib/outbound/warmup/*` — metrics are a
  pure function of elapsed time since `started_at` (no randomness): emails
  sent ramps to 200 over 30 days, inbox rate 0.6→0.97, spam rate 0.15→0.02,
  domain health 50→95. Migration 009 (`outbound_warmup_mailboxes`,
  `outbound_warmup_metrics`). Since this app has no background scheduler,
  `GET /mailboxes/[id]/metrics` appends one fresh snapshot each time it's
  called rather than on a fixed interval — the trend fills in as the
  dashboard is viewed. New `/admin/outbound/warmup` page + `Warm-Up` nav
  entry.

**Standing note for whoever picks up a real vendor next**: every module
above already has exactly one place to touch — implement a new
`*Provider` class next to the existing `providers/mock.ts`, register it in
that module's `provider-factory.ts`'s `PROVIDERS` map, add its API key env
var to `.env.example`, then select it in `/admin/outbound/integrations`.
No other file in any of the 7 sessions above should need to change.

**First real vendor — Prospeo (Email Finder + Contact Enrichment), done
2026-07-18.** User explicitly requested Prospeo for "contact and email
discovery." Researched Prospeo's actual current API before writing code
(their original single-purpose `email-finder`/`social-url-enrichment`
endpoints are deprecated) — the live API is a single unified endpoint,
`POST https://api.prospeo.io/enrich-person` (`X-KEY` header auth), that
returns both a verified email AND full person/company enrichment data in
one call. Both new capabilities call this same endpoint with different
request shapes and interpret the response differently, so the HTTP client
itself is shared (`lib/outbound/shared/prospeo-client.ts` —
`callProspeoEnrichPerson()`, never throws, typed request/response shapes)
while each capability keeps its own provider file:
- `lib/outbound/email-finder/providers/prospeo.ts` — sends
  `only_verified_email: true` (Prospeo only debits a credit when a
  verified email is actually found, so a miss costs nothing). Maps
  `error_code: 'NO_MATCH'` → `status: 'not_found'`, any other error code →
  `status: 'error'`, `person.email.revealed === false` → `not_found`
  (even if an email string is present), `person.email.status` containing
  "verif" (case-insensitive) → `confidence: 'high'`, otherwise `'medium'`.
- `lib/outbound/enrichment/providers/prospeo.ts` — omits
  `only_verified_email` (we want profile data even without a verified
  email). Prefers `linkedin_url` as the match key when the contact has one
  (Prospeo's highest-precision match), else `full_name` + `company_name`.
  Maps `job_history[current].departments[0]`→`department`,
  `.seniority`→`seniority`, `location.{city,state,country}`→`location`,
  `current_job_title`→`roleCategory`, `headline`→`linkedinSummary`,
  `company.employee_range`→`companySize`, `company.industry`→`industry`.
  `companySize`/`industry` fall back to the request's
  `knownCompanySize`/`knownIndustry` hints (this platform's own research)
  only when Prospeo's own company object is empty — Prospeo's live data is
  treated as more authoritative than our own guess when both are present.
- Both providers' `isAvailable()` is a cheap credential-presence check
  only (`getProspeoApiKey()` !== null) — no network ping before every
  request, same discipline as `lib/ai/providers/nvidia-nim.ts`'s
  `isAvailable()`. Credential resolution: `outbound_integrations` DB row
  first, then a flat `PROSPEO_API_KEY` env var fallback (added to
  `.env.example`) for local dev without Supabase.
- `'prospeo'` added to `CAPABILITY_KNOWN_PROVIDERS` for `email_finder` and
  `enrichment` in `lib/outbound/settings/types.ts` so it's selectable in
  the Integrations settings page.
- **Fixed a real gap found while wiring this in**: the Integrations
  settings page's Test Connection action (`/api/admin/outbound/
  integrations/[capability]/test`) previously hardcoded
  `isAvailable = providerName === 'mock'` — meaning it would have reported
  a correctly-configured Prospeo credential as "not available" forever,
  since the route never actually checked anything for non-mock providers.
  Fixed by adding an exported `checkAvailability()` to all 5 capabilities'
  `provider-factory.ts` files (resolves the active provider, calls its
  real `isAvailable()`) and having the test route dispatch to the right
  one per capability. This was a required fix for Prospeo to work
  correctly, not scope creep — the feature would have been silently broken
  for any real vendor without it.
- **Verified, including a real live run (2026-07-18) — user supplied a
  real Prospeo API key** (added by the user directly to `.env.local` as
  `PROSPEO_API_KEY`, never handled or entered by the assistant — entering
  API keys into fields is a hard rule regardless of who provides them).
  `tsc --noEmit` clean, full suite passing (425 tests — 23 new:
  `tests/prospeo-client.test.ts` for the shared HTTP client against a
  mocked `global.fetch`, `tests/prospeo-providers.test.ts` for both
  providers' request-building/response-interpretation logic).
  - **Real bug found and fixed via the live run**: `NO_MATCH` (and Prospeo
    error codes generally) were incorrectly resolving to
    `EmailFinderResult.status: 'error'` instead of `'not_found'`. Root
    cause: Prospeo returns a non-2xx HTTP status even for soft
    business-logic outcomes like "no matching person," with the actual
    `{ error, error_code }` detail in the JSON body — but
    `callProspeoEnrichPerson()` originally treated any non-2xx response as
    a hard transport failure (`ok: false`) before either provider's own
    `error_code` branch (the one that correctly maps `NO_MATCH` →
    `not_found`) ever got a chance to run. Fixed: the client now returns
    `ok: true` with the parsed body whenever *any* JSON comes back,
    regardless of HTTP status — `ok: false` is reserved for genuine
    transport/parse failures (no JSON body at all). Verified with the real
    key: a fabricated test name correctly resolves to
    `email_finder_status: 'not_found'` with the intended human-readable
    reason, for both the Email Finder and Contact Enrichment capabilities.
  - Also confirmed live: `INVALID_API_KEY` (tested first, before the real
    key was added) and successful auth (`INVALID_DATAPOINTS` — a real
    Prospeo response for a fabricated name that doesn't meet its minimum
    matching requirements — once the real key was in place) both surfaced
    correctly end-to-end through the Contacts page UI, with no crashes.
  - Found and fixed a related gap while cleaning up test state: there was
    no way to clear a previously-saved (e.g. accidentally-fake) stored
    credential back to "unset" so the env-var fallback could take over —
    the settings PUT route silently left `credential_encrypted` untouched
    whenever `api_key` was omitted from the request. Added a
    `clear_credential: true` body flag to
    `PUT /api/admin/outbound/integrations/[capability]` to null it out
    explicitly. This is a real, permanent capability gap this feature was
    missing, not a one-off script — fixed through the app's own API layer,
    not a direct database write.
  - Left both capabilities reset to `provider_name: 'mock', is_active:
    true` after verification, so the app stays on safe defaults — the user
    needs to re-select "prospeo" in `/admin/outbound/integrations` (or via
    `OUTBOUND_EMAIL_FINDER_PROVIDER=prospeo` /
    `OUTBOUND_ENRICHMENT_PROVIDER=prospeo`) whenever they want it live
    again. The real `PROSPEO_API_KEY` remains set in their `.env.local`.

## Decision-maker auto-discovery — UNBLOCKED 2026-07-18, supersedes the
## "stays blocked" language above and in every earlier session's notes
The user showed a target pipeline diagram (Research → Prepare Outbound →
**Find Decision Makers** (CEO/CTO/VP Operations/Plant Head) → Contact
Enrichment → Email Validation → Campaign → Replies) and asked whether the
built system matches it. It mostly does, with one deliberate, previously-
guarded gap: every contact in this codebase has so far been **manually
typed in by name** — Email Finder and Contact Enrichment take a person
name as input, they never search a company for "who holds this title."
That gap was flagged back explicitly (per this file's own prior instruction
to "stop and flag it rather than proceeding"), and the user was asked
directly whether to cross it now. **Answer: yes, build it.**

**What this authorizes**: a new decision-maker discovery capability using
Prospeo's **Search Person** endpoint (200M+ contacts, 30+ filters,
searchable by company + job title) — given a researched company + a set of
target titles (CEO/CTO/VP Operations/Plant Head, etc.), return candidate
decision-makers. This becomes a new source that FEEDS `outbound_contacts`
(alongside, not replacing, manual entry) — the existing Email
Finder/Validation/Enrichment/Generation/Sending modules downstream of a
contact existing are unaffected and don't need to change.

**What this does NOT authorize**: LinkedIn scraping/automation stays
excluded regardless (unchanged, see `source-prioritizer.ts`'s
`isFetchable()`) — Search Person is a non-LinkedIn people-data API, same
category as the already-approved Prospeo work, not a reversal of the
LinkedIn boundary.

**Second decision, same session — UI restructuring.** The current
`/admin/outbound/*` structure is 4 separate top-level nav pages (Contacts,
Campaigns, Warm-Up, Integrations) plus Research/Discover/History — the
user compared this against Explee's UX and said they don't want a flat set
of separate tools; they want **one linear guided flow** that walks through
the pipeline in order for one company/lead at a time (Research → Find
Decision Makers → Enrich → Validate → Prepare Outbound → Campaign),
matching Explee's phase-by-phase feel rather than a page-per-capability
IA. This is a UI/IA consolidation, not a backend rewrite — the existing
API routes and provider architecture underneath (Email Finder, Validation,
Enrichment, Generation, Sending, Warm-up, Integrations settings) stay as
the implementation layer; this is about presenting them as one guided
flow instead of separate nav destinations. `/admin/outbound/integrations`
(the settings page) most likely stays a separate settings surface even
under this restructuring — it's config, not a pipeline step — confirm this
assumption at the start of the session rather than assuming it silently.

**Explicitly deferred, not authorized by this decision**: phone/mobile
enrichment (Prospeo has an `enrich_mobile`/mobile-finder capability we
did not wire — real cost implication, 10 credits per Prospeo's pricing,
worth flagging before turning it on) and reply tracking/ingestion (the
`outbound_campaign_events` schema already has a `replied` event type as a
placeholder, but nothing ingests replies — this needs either IMAP/inbox
polling or a real sending vendor's reply webhook, and there is still no
real sending vendor chosen, only mock — reply tracking is likely blocked
on that unrelated decision, flag this if it comes up rather than building
a half-solution).

**Next session should**: (1) confirm the Integrations-page-stays-separate
assumption above before writing UI code, (2) design the decision-maker
discovery module following this repo's established provider-abstraction
pattern (one `DecisionMakerDiscoveryProvider` interface, mock first, real
Prospeo Search Person provider following the credential-handling
discipline from the existing Prospeo work — same "assistant never enters
API keys" rule applies to any future vendor too), (3) design the unified
flow UI as its own session before or after the discovery module, matching
this repo's "one deliverable per session, benchmark after each" practice
— treat "implement all remaining things" as a multi-session arc, not one
sitting.

## Precision + latency fixes — 2026-07-18, four parallel sessions
Triggered by a live Auto Flow run against ATE Group/Ador Welding surfacing
four real problems at once: 0 pain points, 0 opportunities, an obviously
irrelevant "Competitors" list (Accenture/Deloitte/IBM sourced from an
unrelated "Top Data Analytics Companies" listicle), and a wrong
decision-maker list. Root-caused each via a read-only investigation pass
before any code changed, then fixed all four in parallel (disjoint file
ownership per session, verified together afterward: `tsc --noEmit` clean,
33 test files / 481 tests passing).

- **Decision-maker list was never real** — the Auto Flow's "Find Decision
  Makers" step was showing `provider_name: 'mock'` results
  (migration 010 seeds it inactive-on-real-vendor by design, same as every
  other outbound capability's safe default). The real
  `ProspeoDecisionMakerDiscoveryProvider` already existed and was already
  wired into the factory — this needs a one-click flip to `prospeo` in
  `/admin/outbound/integrations` (or `OUTBOUND_DECISION_MAKER_DISCOVERY_PROVIDER=prospeo`),
  same per-vendor opt-in convention as Email Finder/Enrichment. **Not
  flipped by this session** — deliberately left as a manual user action
  (real Prospeo credit cost per lookup, same reasoning as every other
  vendor activation in this repo).
- **Competitor/ICP relevance filter fix** (`lib/enrichment/extraction-guards.ts`,
  `competitor-discovery.ts`, `icp-generator.ts`): the offering-driven
  discovery pass runs with `requireCompanyMention=false` by design (queries
  like `top companies offering "X"` are *supposed* to return other
  companies' pages), but had zero topical-relevance check of any kind, so a
  same-word-adjacent-but-wrong-industry listicle could leak straight
  through. New shared `extractQueryTopic()`/`mentionsTopic()`/
  `filterTopicallyRelevantResults()` in `extraction-guards.ts` filters each
  query's results against the specific topic phrase that produced that
  query (lenient word-overlap, not exact match — reworded-but-relevant
  hits still pass). `requireCompanyMention=true` path untouched.
- **Pain points had no gate** (`lib/pipeline/normalize.ts`,
  `app/api/admin/test-analysis/route.ts`): `pain_points` was pure
  ungated LLM output — the prompt says "never return []" but nothing
  enforced or even detected a violation. New `shouldWarnEmptyPainPoints()`
  + `PAIN_POINTS` WARN-only gate (same pattern as `COMPETITOR`/`ICP`/
  `MARKET_INTEL`), fires only when `evidence_sufficiency: 'sufficient'`
  AND `pain_points` is empty — a genuinely thin-evidence company still
  correctly gets no warning.
- **Service-evidence had no debug visibility** (`normalize.ts`): new
  underscore-prefixed `_service_evidence_debug` field (same convention as
  `_extractor`/`_service_evidence_content`) captures per-service weak-tier
  matches and disqualification reasons that never surfaced in the report,
  plus the 4-condition breakdown of what triggered `insufficientEvidence`
  (`companySubjectCount_zero`/`signals_zero`/`leadershipContacts_zero`/
  `no_facility_evidence`). Purely additive/diagnostic — no UI or gate
  behavior changed. Flows into `pipeline_test_runs.final_result`
  automatically (that column is `analysisResult` verbatim). **Not yet used
  to actually diagnose ATE Group's 0-opportunity result** — that needs a
  live re-run with this field now available to inspect, still open.
- **Sequential per-competitor website-resolution loop parallelized**
  (`route.ts`): was a `for` loop calling `discoverCompanyWebsite()` once
  per competitor (cap `MAX_COMPETITORS = 5`), each with its own internal
  8000ms-capped sequential fetch chain — worst case ~40s serial for
  something with no ordering dependency. Now `Promise.all`, same per-call
  timeout, same "no domain found still surfaces by name" fallback
  behavior preserved. Likely the single biggest latency win of this
  session; not independently timed post-fix.
- **Leadership scraping gap fixed** (`lib/pipeline/scraper.ts`,
  `evidence-extractor.ts`, `lib/enrichment/discovery-engine.ts`): leadership
  keywords were folded into the generic `corporate` category (score 90,
  no edge over plain "about us" content) and leadership probe paths sat
  in lowest-priority Tier D. New dedicated `leadership` category (score 95)
  checked before `corporate`; leadership paths moved into the first probe
  batch. New `extractStructuralLeadershipEvidence()` alongside the existing
  narrative-clause extractor — the existing one required a markdown
  heading + a narrative "heads/leads/oversees" sentence within 700 chars,
  which misses the extremely common photo-card team-grid layout (name +
  title, no heading, no narrative sentence) that most real leadership pages
  actually use. New extraction is tagged `confidence: 'medium'` vs the
  narrative extractor's `'high'`. New `'leadership'` query-category + two
  search templates added to `discovery-engine.ts`.
- **Decision-maker grounding added** (`lib/outbound/decision-maker-discovery/grounding.ts`):
  new pure `groundCandidate()`/`groundCandidates()`, applied uniformly to
  every provider (mock and Prospeo alike) via `provider-factory.ts`, tags
  each candidate `confirmed` / `conflict` / `not_found` against the
  company's own scraped `leadershipContacts` — same "flag conflicts, don't
  auto-merge" discipline as `possibleDuplicateOf` in
  `lib/batch/company-dedup.ts`. Threaded through both Auto Flow call sites
  (single-company `DecisionMakerFinder.tsx` shows a grounding badge; the
  batch loop in `useAutoGtmFlow.ts`). **Known gap, not fixed**: the
  standalone `/admin/outbound/contacts` page loads saved runs whose
  persisted `final_result` predates this field, so grounding there
  currently no-ops — would need a DB/persistence backfill, out of scope
  for this session.
- **Found, not fixed, flagged separately**: a pre-existing "Head of X" title
  regex in the leadership extractor that can greedily swallow newlines
  across multiple lines — a real latent bug, deliberately left out of this
  session's diff to keep it scoped to the four requested fixes.

**Not done this session, real next steps**: (1) flip the decision-maker
provider to `prospeo` and re-test against a real company; (2) live re-run
ATE Group with `_service_evidence_debug` available to settle whether its
0-opportunity result is genuine thin evidence or a real extraction gap;
(3) a live smoke test of `minimaxai/minimax-m3` and
`thinkingmachines/inkling` against this pipeline's actual prompts, since
neither has been exercised through this codebase yet; (4) fix the
greedy "Head of X" regex flagged above.

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
- **DONE 2026-07-19 — live run confirms this end-to-end.** Called
  `discoverAndFetchExternalSources('adorwelding.com', 'Ador Welding')`
  directly (real Tavily quota, explicit confirmation given first) — the
  cheaper, targeted way to prove this specific path without spending a full
  scrape+LLM pipeline run. Tavily discovered 8 candidate sources, 2 of them
  real `.pdf` URLs tagged `annual_report`: a BSE filing PDF
  (`bsmedia.business-standard.com/.../51600047-....pdf`) and an
  academic-repository-hosted 2019-20 annual report PDF
  (`coeptech.ac.in/.../Annual-Report-2019-20-final-draft-1.pdf`). Both were
  prioritized into the top-5 fetch set and both fetched successfully — 5706
  and 5679 chars of real parsed text each, correctly formatted as `[SOURCE:
  Annual Report (VERY HIGH confidence) | tier1 | <url>]` context blocks. The
  BSE filing's extracted text is legible, correct company content: "ADOR
  WELDING LIMITED", the real registered address, CIN number
  (L70100MH1951PLC008647), and BSE filing metadata — confirms `pdf-parse`
  extraction is working correctly on a real-world filing PDF, not just the
  committed test fixture. Not re-run against the full pipeline/gate outcomes
  in the same session (that's a second, separate spend) — this confirms the
  fetch+parse mechanism itself works; a full cached-scrape regression check
  is still open if someone wants it.

**Item 4 (done 2026-07-23, code + unit tests; live verification pending)** —
added the executive-change-announcement query template + dedicated
investor-call-transcript/financial-disclosure targeting pass. Explicitly
skips government-filings APIs (EDGAR/MCA) — still logged as a future
category, not built.
- `lib/enrichment/discovery-engine.ts`: checked the existing `investor`
  category first (per the task's own instruction) before adding anything —
  it already covered annual report / investor presentation / quarterly
  results, but had no query actually targeting transcript-shaped content
  (management commentary, not just headline numbers) and no query at all
  for leadership-change events. Reused the existing `investor` and
  `leadership` `QueryCategory` values rather than inventing new ones (no
  `CategoryCoverage`/prioritizer-coverage-tracking changes needed) — 2 new
  investor-call-transcript queries (`"${c}" earnings call transcript
  ${yr}"`, `"${c}" investor call transcript quarterly results"`) and 3 new
  executive-change queries (`"${c}" appoints new CEO"`, `"${c}" CEO steps
  down leadership transition"`, `"${c}" management change appointment
  ${yr}"`).
- `classifySourceType()` gained 2 new `SourceType`s with dedicated
  detection, checked BEFORE the generic `press_release`/
  `investor_presentation` branches so more-specific content classifies
  correctly instead of falling into a generic bucket:
  `earnings_call_transcript` (very_high evidence strength, priority_score
  88 — just below `earnings_release`'s 90, since a transcript is the same
  "highest evidence tier" but slightly less canonical than the release
  itself) and `executive_change_announcement` (high evidence strength,
  priority_score 82 — above `press_release`'s 75, per CLAUDE.md's own
  "named individual + explicit stated portfolio" signal-library entry
  calling this kind of evidence out as strong).
- Applied the same word-boundary discipline this file already documents for
  short/generic keywords (the historical 'ir'/'sec' URL-classifier bug
  class): a bare "transcript" mention only classifies as
  `earnings_call_transcript` when it co-occurs with an earnings-call/
  investor-call/concall/conference-call/quarterly cue — caught and fixed a
  real bug of this exact shape while writing the regression tests: the
  first draft's `\btranscript\b` didn't match the plural "transcripts"
  (`\b` requires a `\w`/`\W` transition, and "transcript" immediately
  followed by "s" is `\w`-`\w`, no boundary) — fixed to `\btranscripts?\b`.
- `source-prioritizer.ts`: `mustHave` (the guaranteed-fetch-slot list, was
  `annual_report`/`investor_presentation`/`earnings_release`) now also
  includes `earnings_call_transcript` — same "highest evidence tier"
  reasoning as its priority score. `sourceTypeLabel()` gained labels for
  both new types.
- New `tests/discovery-engine.test.ts` (25 assertions) — the first real
  unit-test coverage for either `discovery-engine.ts` or
  `source-prioritizer.ts` (neither had any before this session).
  `buildDiscoveryQueries()` was exported specifically to make this
  testable without spending real search-API quota, same reasoning as
  `isPdfUrl`/`extractPdfText` in `web-enricher.ts` (Item 3). Covers: both
  new source-type classifications (including the plural-transcript fix and
  a `executive_change_announcement`-wins-over-`press_release`
  check-order case), a `"recall"`-contains-"call" false-positive guard
  (same bug class as the historical 'ir' matching inside "wire"), presence
  of all 5 new query templates under the correct existing category, a
  non-regression floor on the pre-existing 14 query templates, and a
  `prioritizeSources()` case confirming a transcript-only source (no
  annual report/investor presentation/earnings release present) still
  claims a guaranteed fetch slot.
- **Verified**: `tsc --noEmit` clean, full suite passing (508 tests, 37
  files, in this worktree — 25 new). **Not live-verified** — no real
  Tavily/Serper call was made against the new query templates, same
  "verify via tsc+tests, defer live run" pattern as every other
  quota-spending discovery module in this repo. A future session should
  run `discoverEvidenceSources()` against a real benchmark company (Ador
  Welding is this file's own reference case for enrichment work) and
  confirm at least one of the 5 new query templates surfaces a real,
  correctly-classified `earnings_call_transcript` or
  `executive_change_announcement` source in practice.

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
done as Item 2; item 3 PDF done; item 4 executive-change/investor-transcript
targeting done 2026-07-23) are independent of Phase 2 and can proceed
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

## RESOLVED 2026-07-23 — `discoverCompanyWebsite()`'s Anadarko Petroleum -> petroleum.gov.gy false positive
The precision gap logged directly above (loose body-text-only matching
letting a genuine two-word name resolve to an unrelated domain) was fixed
in `lib/enrichment/website-discovery.ts`, not just noted. The prior fix for
this bug class (the single-word-name title-required guard, see Item 1's
history above — "AITG" -> `aitg.miraheze.org`) only covered single-word
names; "Anadarko Petroleum" is a genuine two-word name, so it didn't hit
that guard, and the underlying weakness (a body/description-only match
requires ALL name-words to be present SOMEWHERE in a 2000-char snippet,
with zero check that they refer to the same real mention) was still live
for any multi-word name landing on a generic page that happens to mention
each word separately.

Two additive guards, combining both directions considered in the task that
prompted this fix:
1. **`isKnownNonCorporateDomain()`** — a list-based rejection of obviously
   non-corporate domain shapes (`.gov`/`.gov.<cc>`/`.mil`/`.edu`, known
   wiki-hosting domains including `miraheze.org` — the literal AITG false
   positive's own host — plus Wikipedia/Wikimedia/Fandom/Wikia, and known
   directory/aggregator/social domains: Crunchbase, LinkedIn, Glassdoor,
   Indeed, G2, Capterra). Checked in the main `discoverCompanyWebsite()`
   loop BEFORE any fetch/scoring happens — same "known-bad names checked
   before generic heuristics" precedent as `competitor-discovery.ts`'s
   `NON_COMPETITOR_NAMES` list (direction 1 from the task). This alone
   rejects `petroleum.gov.gy` outright, with zero fetch cost.
2. **`wordsAppearTogether()`** — for body/description-only matches (no
   partial title match), require the company name's significant words to
   actually appear within a 120-char window of each other in the source
   text, not just present anywhere in the snippet (direction 2 from the
   task). This is the real root-cause fix: a government/industry portal can
   legitimately mention a company's distinctive word once, far from where
   it mentions the industry's generic word repeatedly — the old check
   couldn't tell that apart from a real "A-1 Fence Products Pvt Ltd" style
   mention where all the words appear together. Partial-title matches
   (`titleRatio >= 0.5`) are deliberately EXEMPT from this proximity
   requirement — the title itself is short, so "words present in it" is
   already strong proximity evidence on its own; this exemption is what
   keeps "Shree Balaji Fabricators"'s documented partial-title-match
   downgrade (medium, not none) working unchanged.
Both helpers and `scoreCandidate()`/`normalizeCompanyName()`/
`significantWords()`/`HomepageIdentity` are now exported specifically so
they're unit-testable without network, following the same pattern as
`competitor-discovery.ts`'s exported `isSelfName()`/`classifyRejection()`.

**New `tests/website-discovery.test.ts`** (this repo's first dedicated
website-discovery test file — none existed before, despite the stale
`tests/url-classifier.test.ts` reference elsewhere in this file already
flagging that this repo's test coverage lagged its documented precision
history). 21 assertions, covering both the new guards in isolation and the
full `discoverCompanyWebsite()` flow with `searchTavily`/`searchSerper` and
`global.fetch` mocked (same mocked-`global.fetch` precedent as
`tests/prospeo-client.test.ts`): the new Anadarko-Petroleum-shaped
rejection (both via the domain guard directly, and — as a defense-in-depth
check — via the proximity requirement alone, simulating a differently-named
portal the domain-pattern list wouldn't catch) plus every documented
non-regression case from this file's history — Ador Welding (title match ->
high), A-1 Fence Products (real body match with words together -> medium),
AITG (single-word guard -> not_found), "Om Enterprises"-shaped generic
2-domain tie (-> ambiguous), "Shree Balaji Fabricators" (partial title ->
medium, not high), and "A-1 Fence Products" vs "A-1 Fence Company"/Anaheim
(genuine real-world name collision -> ambiguous). All pass; `tsc --noEmit`
clean; full suite green in this worktree (504/504 — this worktree's test
count differs from the 1000+ figures cited in later sessions elsewhere in
this file, consistent with this branch's own more limited commit history;
not a regression signal, just a different starting point). **Not
live-verified against a real Tavily/Serper call** — this is a pure
precision/logic fix to already-existing scoring code, verified via mocked
end-to-end flow tests rather than spending real search quota; if a future
session re-runs Company Discovery Engine live against "Anadarko Petroleum"
or a similar case, confirm this fix holds against real search results too.

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

**Item 7, Outreach Intelligence Layer — field-naming reconciliation done
(2026-07-23).** Rename-only pass, no new logic. `OutreachIntelligence`'s
fields (`lib/pipeline/analysis-sections.ts` and `lib/pipeline/normalize.ts`,
which each independently declared the same interface shape) renamed to
match this roadmap's naming: `trigger` → `why_contact`, `problem` →
`likely_problem`, `service` → `recommended_service`, `opening_angle` →
`conversation_angle`. `why_now` was already correctly named and untouched.
Every touch point updated consistently: the LLM output schema and RULES
bullets in `lib/prompts/analyze-v2.ts` (including the `why_demaze.
outreach_angle` schema comment that cross-references `conversation_angle`
by name), the `system-v2.ts` writing-style rule, `normalize.ts`'s
merge-from-raw-LLM-output block, `lib/export/brief-html.ts`'s downloaded-
brief rendering, `lib/outbound/generation/assemble-input.ts`'s read of
`outreachIntelligence?.conversation_angle` (note: `EmailGenerationInput.
openingAngle`, the field it's assigned into, is a differently-named field
on an unrelated type and was deliberately left as-is — out of scope for
this rename), both admin UI render sites (`app/admin/intelligence-lab/
page.tsx` and `ResearchCard.tsx`), `benchmarks/benchmark-runner.ts`'s
scoring-text extraction, and `tests/outbound-generation.test.ts`'s fixture.
A stale comment in `lib/text/humanize.ts` was also updated for consistency.
Confirmed via full-repo grep before and after that no other file reads or
writes these fields under their old names (ruled out several false-positive
matches: `icp-generator.ts`'s unrelated `LIST_TRIGGER` search-trigger
concept, `types/index.ts`'s unrelated `trigger` usage, `docs/ROADMAP.md`
which already used the new names as the target spec, never the old ones).
**Verified**: `tsc --noEmit` clean, full suite 483/483 passing (this
worktree's test count — no benchmark run needed, this is a rename with no
behavior change).

## The actual goal
NOT "6/6 benchmark PASS." The goal is: any company URL -> pipeline always returns
usable intelligence -> no hard crashes -> no hard FAILs -> graceful degradation on
ugly real-world sites.

## Benchmark workflow
Run `benchmark/run-benchmark.ts` after every change to this pipeline. Write output to
`benchmark/results-history/<date>.json`. Compare against the previous snapshot before
claiming a fix worked — a fix for one company should not silently regress Bharat Forge,
Muthoot, or Chargebee (all currently PASS).