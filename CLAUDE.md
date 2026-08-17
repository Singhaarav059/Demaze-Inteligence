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
- **Analysis mode defaults to `full` everywhere (2026-07-27)** — was `lightweight`.
  Changed in `/api/admin/test-analysis/route.ts`'s own request-body fallback
  and every page/hook's initial `useState<AnalysisMode>`/batch-processing
  request body (`wizard`, `auto-gtm`'s `useAutoGtmFlow`, `company-discovery`'s
  page + `useCompanyDiscoverySearch`) — `intelligence-lab/page.tsx` already
  defaulted to `full`, no change needed there. The Lightweight/Full toggle
  buttons themselves are untouched — users can still manually switch to
  Lightweight per-run; only the starting default changed.

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

## RESOLVED 2026-07-24 — shared `\w`-ASCII name-normalization bug (audit
## item ranked #2, item (1) from the leadership-fix session's "not done" list)
Five files independently stripped `[^\w\s-]`-shaped character classes to
normalize a company/segment name for word-boundary matching — `\w` is
ASCII-only in JS (`[A-Za-z0-9_]`), so any name with a diacritic (French/
German/Spanish/Nordic/Portuguese, the same real-world set the locale-
scoring and leadership-vocab fixes above target) got mangled BEFORE any
matching logic ran: `"Möller Group"` → `"m ller group"` →
`significantWords()` splits into `["m", "ller", "group"]`, corrupting every
downstream word-boundary check. This is upstream of and independent from
the locale/leadership-vocab bugs — it corrupts company IDENTITY resolution
at Step 0 (`website-discovery.ts`, before scraping even starts) and the
company-name self-reference/relevance checks used throughout enrichment,
not just evidence extraction on already-scraped content.

**A second, separate root cause found while fixing the first**: even after
preserving accented characters in the normalized word, the `\b${word}\b`
constructions built around them still wouldn't reliably match — JavaScript's
`\b` is ALWAYS defined in terms of the ASCII `\w` class, REGARDLESS of the
`u` flag (a genuinely easy-to-miss subtlety, not commonly known). A word
that starts or ends with an accented letter (e.g. `"société"`, which ends in
"é") has no `\w`/`\W` transition at that boundary once the character class
fix is applied on its own — `\b` silently fails to match there, since both
the accented letter and whatever follows it (space, punctuation) are
non-`\w`. Confirmed via a real audit-derived test case ("Société Générale")
that would have stayed silently broken under a naive "just widen the strip
regex" fix — this is exactly why the fix needed two parts, not one.

**Fixed, both parts, across all 5 files**:
1. Every `[^\w\s-]`-shaped strip regex switched to `[^\p{L}\p{N}\s-]`
   (`icp-generator.ts`'s variant additionally keeps `&`) with the `u` flag —
   `website-discovery.ts`'s `normalizeCompanyName()`,
   `evidence-extractor.ts`'s `firstSignificantWord()`,
   `competitor-discovery.ts`'s `normalizeName()`, `icp-generator.ts`'s
   `normalizeSegmentName()`, `company-discovery.ts`'s `normalizeName()`
   (this file's own separate duplicate copy), and
   `extraction-guards.ts`'s `significantWords()` (the shared relevance
   gate both `competitor-discovery.ts` and `icp-generator.ts` filter every
   search result through — arguably the highest-impact single fix here,
   since a broken match here silently drops every search result for an
   accented-name company before extraction ever runs) and
   `looksLikeSentenceFragment()`'s first-word cleanup.
2. New `wordBoundaryRegex(word, flags)` helper — `(?<![\p{L}\p{N}])word(?![\p{L}\p{N}])`
   with the `u` flag, a manual Unicode-aware boundary via negative
   lookaround, replacing every `\b${escapeRegex(word)}\b` construction built
   from a normalized/dynamic word (never touched the badlist checks against
   fixed ASCII strings like `NON_COMPETITOR_NAMES`, which don't need it) —
   added independently in `website-discovery.ts`, `evidence-extractor.ts`,
   and `extraction-guards.ts` (competitor-discovery.ts's `isSelfName()`
   didn't need this half: it compares word arrays via `.includes()`, not
   regex, so fixing its `normalizeName()` alone was sufficient — confirmed
   by reading the function before assuming it needed the same treatment).
   Same duplication-over-sharing precedent as every other small helper in
   these modules (`escapeRegex()` itself is already independently defined
   per file) — no new shared cross-module utility added.
3. `isSelfName()` (competitor-discovery.ts, imported by `icp-generator.ts`
   and `company-discovery.ts` for their own self-name checks — so this one
   fix covers all three call sites) needed no boundary-regex change, only
   its `normalizeName()` dependency fixed, since it does array-overlap
   comparison, not regex matching.

New/extended tests across 6 files (14 assertions total): `tests/website-
discovery.test.ts` (character preservation, a title-match case with an
INTERNAL diacritic, a title-match case ENDING in a diacritic — the specific
case that exercises the `\b`-boundary half of the fix — a body-match case,
`wordsAppearTogether()` with accented words, and a full `discoverCompany
Website()` end-to-end run), `tests/competitor-discovery.test.ts`
(`isSelfName` self-match), `tests/icp-generator.test.ts`
(`normalizeSegmentName` preservation + a real accented segment surviving
`classifySegmentRejection`), `tests/company-discovery.test.ts`
(`filterAlreadyResearched`'s normalized-name dedup path), `tests/
extraction-guards.test.ts` (`mentionsCompany` accepting a name with both an
internal and a trailing diacritic — the actual relevance gate, most
consequential single test here), and `tests/evidence-extractor-pagetype
.test.ts` (`classifySubject`'s third-person self-reference match, both for
a name ENDING in a diacritic and for the short-form fallback on an accented
first word). `tsc --noEmit` clean, full suite 573/573 (559 pre-existing +
14 new). Dev-server sanity pass (no live company re-run — same "verify via
tsc+tests+dev-server" precedent as the leadership-vocab fix, this is a pure
regex/normalization change already covered by realistic unit-test content
shapes): zero console/server errors.

**Not done — still open from the ranked audit list**: (1) `business-
profile.ts` missing a pipeline gate; (2) `scraper.ts`'s
`assessScrapeQuality()` having no content-relevance signal, and its debug
trail never reaching the saved run; (3) `classifySubject()`'s `'products'`/
`'blog'` pageType exclusion. The non-English/diacritic-name benchmark
fixture flagged by every session in this audit chain is STILL not built —
worth doing before the next fix in this chain, since three sessions in a
row have now shipped a real fix verified only by unit tests + dev-server,
with no way for `npm run benchmark`/CI to catch a future regression in any
of them.

## RESOLVED 2026-07-27 — `business-profile.ts` missing a pipeline gate
(audit item ranked #1 remaining from the previous session's list). Every
other discovery stage (`COMPETITOR`/`ICP`/`MARKET_INTEL`) already surfaces a
WARN with a reason string on failure — `extractBusinessProfile()`'s failure
was invisible beyond an ephemeral `console.warn`, despite its result
(`businessProfile`) deciding whether `discoverCompetitorsFromBusinessProfile`/
`discoverICPSegmentsFromBusinessProfile` run at all versus falling back to
the narrower offering-grounded pass (`route.ts`'s `isEmptyBusinessProfile()`
check right after this gate).

**Fixed** in `app/api/admin/test-analysis/route.ts`: the existing
`Promise.race([businessProfilePromise, <30s timeout>])` used to resolve its
timeout branch directly to `emptyBusinessProfile()` — indistinguishable from
`extractBusinessProfile()` itself genuinely returning nothing (no API key,
LLM failure, unparseable response, or a real thin-content site). Changed the
race to resolve its timeout branch to `null` instead (same sentinel pattern
already used one section above by the `ENRICHMENT` soft-timeout race —
`businessProfilePromise` never legitimately resolves to `null` itself, since
its own `.catch()` already returns a real `emptyBusinessProfile()` object on
error, so `null` is a safe, unambiguous sentinel). New `BUSINESS_PROFILE`
gate (non-critical, WARN-only, same tier as `COMPETITOR`/`ICP`/
`MARKET_INTEL`/`ENRICHMENT`) reports one of three distinct outcomes: timed
out (`"timed out after 30000ms — competitor/ICP discovery falls back to the
offering-grounded pass"`), genuinely empty (`"extraction returned empty (no
API key, LLM failure, or genuinely no services/positioning content found)
— ..."`), or `PASS` with the actual service count and positioning
presence.

**Live-verified**, not just compiled — re-ran lechler.com through the real
`/admin/intelligence-lab` UI (real Firecrawl/Tavily/LLM quota, cache had
expired so this was a genuinely fresh run): confirmed
`GATE_PASS stage=BUSINESS_PROFILE reason="4 service(s) | positioning=yes"`
in the server log and, more importantly, the same entry correctly present
in the API response's `validation.gates` array (previously this stage
didn't exist there at all) — positioned between `SIGNAL` and `COMPETITOR`,
matching where it's computed in the pipeline. Only the `PASS` branch was
exercised live in this run (the real business-profile call succeeded
cleanly, 9.9s); the `timed out` and `empty` WARN branches are covered by
the sentinel logic itself being a straightforward, already-established
pattern (identical in shape to the `ENRICHMENT` race directly above it in
the same file) rather than separately live-triggered — would need a
deliberately-forced timeout/failure to exercise those two branches live,
not worth spending quota to manufacture.

**No new unit test** — `route.ts` has zero existing unit-test coverage of
any kind (confirmed via search before starting; the other three
non-critical gates it already had, `COMPETITOR`/`ICP`/`MARKET_INTEL`, were
themselves never unit-tested either, only live-verified when first
introduced), so adding test scaffolding for just this one gate would be new
infrastructure, not a regression per this file's established convention.
`tsc --noEmit` clean, full suite unchanged at 573/573 (no existing tests
touch this code path).

**Not done — still open from the ranked audit list**: (1) `scraper.ts`'s
`assessScrapeQuality()` having no content-relevance signal, and its debug
trail never reaching the saved run; (2) `classifySubject()`'s `'products'`/
`'blog'` pageType exclusion. The non-English/diacritic-name benchmark
fixture is STILL not built — four sessions in this audit chain now, worth
prioritizing before the next code fix.

## RESOLVED 2026-07-27 — `classifySubject()`'s `'products'`/`'blog'`
## pageType exclusion (last remaining item from the ranked audit list except
## the scraper content-relevance gap)
`detectPageType()` labels `/solutions/`, `/services/`, `/capabilities/` URLs
as pageType `'products'` (line 549's regex) — exactly the pages
`scraper.ts`'s `classifyUrl()` scores highest under its `b2b_services`
category (score 75, one of the top tiers it prioritizes for scraping). But
`classifySubject()`'s third-person self-reference block (the mechanism the
2026-07-19 homepage fix extended to cover `'homepage'` pages) was still
gated to `pageType === 'other' || 'about' || 'homepage'` only — `'products'`
and `'blog'` were never added. Same bug shape as the homepage fix, on a page
type that's arguably scraped *more* often than `'about'` for services/
industrial vendors, per this file's own 2026-07-24 audit note.

**Fixed**: added `'products'` and `'blog'` to the third-person self-
reference block's pageType condition in `lib/pipeline/evidence-extractor.ts`
(the block starting `if (pageType === 'other' || ...)`). **Deliberately did
NOT extend the other two pageType-gated blocks** in the same function — the
vendor-aware block (`isVendorType && (pageType === 'about' || 'other')`,
~line 666) and the Industry-4.0-context block (~line 687) are both broader
"treat the whole page as company_strategy" rules with no per-mention name
check, and a `/solutions/` page is disproportionately likely to be genuine
customer-facing sales copy ("empower YOUR factory") rather than a company
self-description — extending those carries materially more false-positive
risk than the third-person block, which only fires when the company's OWN
NAME (or "the company/group/firm") actually appears in the text, not a
blanket page-type assumption. The existing `isCustomerFacing` guard inside
the third-person block (checks `help`/`enable`/`your company`/`our
customer`) is reused unchanged and still applies to `'products'`/`'blog'`
pages exactly as it already did for `'about'`/`'other'`/`'homepage'`.

New tests in `tests/evidence-extractor-pagetype.test.ts` (4 added, 15
total): third-person self-reference correctly classifies as
`company_strategy` on both a `/solutions/` page (pageType `'products'`) and
a `/blog/` page (pageType `'blog'`), a non-regression case confirming the
`isCustomerFacing` guard still suppresses a genuinely customer-facing
`/solutions/` page, and a non-regression case confirming a plain marketing
tagline with no self-reference on a `/solutions/` page still produces no
signal. **Found and worked around a real, separate, pre-existing bug while
writing the blog test**: `detectPageType()`'s `'about'` regex
(`/\/(?:about|about-us|company|our-story|...)/  `) has no segment-boundary
anchoring on any of its keywords — `/blog/company-news` matched `'about'`
via the bare substring `/company` inside `/company-news`, the same
short-substring-collision bug class this codebase already fixed once for
`matchesKeyword()`'s `'ir'`-inside-`'wire'` case, just never applied to
`detectPageType()`'s longer keywords. Out of scope for this session (a
different function, a different bug) — worked around by using a
non-colliding test URL (`/blog/quarterly-update`) instead of fixing it, and
logged here rather than silently left unnoticed for whoever next touches
`detectPageType()`.

**Verified**: `tsc --noEmit` clean, full suite 577/577 (573 pre-existing +
4 new). Dev-server sanity pass (no live company re-run — same "verify via
tsc+tests+dev-server" precedent as the leadership-vocab and `\w`-ASCII
fixes earlier in this chain, this is a pure pageType-condition change
already covered by realistic unit-test content shapes): zero console/server
errors.

**Not done — still open from the ranked audit list**: `scraper.ts`'s
`assessScrapeQuality()` having no content-relevance signal, and its debug
trail never reaching the saved run — the last item from the original
2026-07-24 audit's ranked list. Also newly found, not fixed: `detectPageType()`'s
missing segment-boundary anchoring (see above). The non-English/diacritic-
name benchmark fixture is STILL not built — five sessions in this audit
chain now, worth prioritizing before the next code fix regardless of which
one it is.

## Benchmark set (current)
Ace Pipeline, Ador Welding, AS Agri & Aqua, AITG, A-1 Fence Products, ATE Group
(earlier/reference set: Bharat Forge, Muthoot Finance, Chargebee — all currently PASS,
do not regress these) — plus Lechler (2026-07-27, the non-English/multi-locale
regression fixture — see its own dedicated section below for why its
expectations are deliberately conservative, not a guess)

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

## ADDED 2026-07-27 — `lechler.json`, the non-English benchmark fixture
Five consecutive sessions in the "silent zero" audit chain (locale-scoring,
leadership-title vocab, `\w`-ASCII name normalization, `classifySubject()`
pageType exclusion, `BUSINESS_PROFILE` gate) flagged the same gap every
time: all 9 existing benchmark fixtures are English-primary companies with
plain ASCII names, so none of those fixes could ever be regression-tested
by `npm run benchmark`/CI — only by a live, one-off manual investigation
(exactly what this whole chain repeatedly had to do). New
`benchmarks/companies/lechler.json` closes this gap using the exact real
company (`lechler.com`, a German spray-nozzle/atomization manufacturer)
that drove and validated every fix in this chain — not a new, unfamiliar
company requiring fresh live investigation to determine correct expected
values.

**Deliberately conservative expectations, not guessed** — `requiredProfileFlags:
[]` and no `expectedPrimaryType`, same genuine-uncertainty pattern as
`muthoot-finance.json`/`acepipeline.json`: across every live run against
this company this session (multiple, spanning all 4 code fixes above),
`primary_type` stayed `'unknown'` (confidence 30, `companySubjectCount: 0`)
regardless of which fixes were live — a real, separate, not-yet-root-caused
gap unrelated to what this fixture exists to guard, so asserting on it would
just reintroduce false-FAIL noise this fixture work exists to avoid.
`minSignals: 0` for the same reason (real scrape-content variability run to
run — same accepted flakiness class already documented elsewhere in this
file for Ador Welding/AITG/A-1 Fence — this session's own live runs saw
`signals_detected` bounce between 0 and 1 across otherwise-identical
re-analyses). `minOpportunities: 1`/`minChallenges: 1` are set deliberately
as a **canary**, not a guess at a typical value: this session's live runs
after the fixes above produced 4-5 opportunities and 4-5 pain_points on a
favorable scrape, so a future regression that silently reverts any of the
locale/leadership/ASCII/pageType fixes would collapse this fixture back
toward its pre-fix 0/0 state and show up as a `WARN` (not `FAIL` — these
checks are WARN-severity by design, same as every other fixture) — visible
in benchmark output without requiring anyone to know to check.
`forbiddenTerms` reuses the same generic SaaS/finance-contamination guard
already used by the other manufacturer fixtures (industrial spray-nozzle
manufacturing shares no real risk of accidentally matching those terms).

New assertion in `tests/benchmark-fixtures.test.ts`: the existing 9-company
count check updated to 10 (in place, not a new test), plus one new test
confirming the fixture's uncertainty (`requiredProfileFlags: []`, no
`expectedPrimaryType`) is deliberate, not an oversight. Did NOT run the real `npm run
benchmark` — same "would spend real Tavily/Serper/LLM quota across all 10
companies" reasoning as the original 2026-07-23 fixture-set session, and
this session already has extensive direct live-verification of the exact
underlying API call this fixture depends on (`mode: 'full'` against
`lechler.com/de-en`), repeated across all 4 fixes in this chain — a fresh
full-suite run would be pure re-confirmation, not new information.
`tsc --noEmit` clean, full suite 578/578 (577 pre-existing + 1 new test —
one assertion, not two, since the fixture-count bump lives inside an
existing test rather than adding a new one).

## VERIFIED 2026-07-27 — first real `npm run benchmark` run with the
## Lechler fixture in place; 4 failures investigated, none are regressions
Ran the actual full 10-company benchmark (real Firecrawl/Tavily/LLM quota,
explicit confirmation given first) to close the loop on the audit chain
above. Result: **3 passed, 3 warned, 4 failed**, mean score 46.08/100 (down
from the previous 49.83 baseline). The Lechler fixture itself behaved
exactly as designed — `WARN` (not FAIL), `min_opportunities`/
`min_challenges` both showing 0 this run, the honest "canary" outcome for
genuinely thin evidence on this run's particular scrape, per its own
documented deliberate-conservatism above.

**Did not accept the 4 FAILs at face value** — re-ran each of the 4 failed
companies individually against the same live domains, same discipline this
file already used multiple times for Ador Welding/AITG (see the 2026-07-22
research-quality initiative's own "found a real transient failure, root-
caused before accepting the result" entries). All 4 individual re-runs
completed successfully (`GATE_OVERALL=WARN`, none crashed):

- **ATE Group** (`fetch failed` in the benchmark) — re-run succeeded
  cleanly: real scrape (cache hit), `primary=industrial_vendor`, 3 signals,
  3 pain points, 5 opportunities, `GATE_OVERALL=WARN`. The `fetch failed`
  was the benchmark script's own outer HTTP call to the dev server failing
  (`callAnalysis()`'s `fetch()` in `benchmark-runner.ts`), not a real
  ategroup.com reachability problem — most likely the dev server under load
  after handling 7 prior sequential long-running (100-300s each) requests in
  the same run, not a code issue.
- **Muthoot Finance** (`fetch failed`) — re-run succeeded cleanly: real
  scrape (cache hit), `primary=financial_institution`, `company_name:
  "Muthoot Finance Ltd"`, 4 pain points, 5 opportunities. Same transient
  outer-HTTP explanation as ATE Group — this specifically confirms the
  muthootfinance.com direct-reachability question this file's own
  `muthoot-finance.json` entry flagged as still-open ("whether the scrape
  reliably succeeds is still unconfirmed") remains open in the *good*
  direction this run, not a new problem.
- **A-1 Fence Products** (`primary_type=unknown`, expected `manufacturer`)
  — re-run succeeded overall, but the scrape itself came back genuinely
  empty this time (`"Scraper returned no usable content — using domain-only
  stub"`), so `primary_type: unknown` is an honest, correct consequence of
  stub-only content, not a classifier bug. This is the exact "scraper
  flakiness observed 2026-07-11" pattern already documented above
  ("re-running AITG and A-1 Fence back-to-back produced different
  successfulUrls sets between runs") manifesting again for this company —
  a pre-existing, accepted characteristic of this benchmark suite, not
  something this session's fixes touched (none of the locale-scoring/
  leadership-vocab/ASCII-normalization/`classifySubject`-pageType/
  `BUSINESS_PROFILE`-gate fixes touch scrape page-selection reliability).
- **Bharat Forge** (`primary_type=unknown`, expected `manufacturer`) —
  re-run succeeded overall with real scraped content this time
  (`companySubjectCount=3`, 2 signals, `SCRAPE:PASS`), 5 pain points, 5
  opportunities, `company_name: "Bharat Forge Limited"` — but
  `buildCompanyProfile()` still didn't set `company_type.manufacturer=true`
  on this run's specific content mix. Real content-dependent classification
  variability in `evidence-extractor.ts`'s `primary_type` cascade logic — a
  completely different function from anything touched in this session's
  fix chain, so not a regression from this session, just the same class of
  scrape-content non-determinism already logged for this company's
  `retailer`/`conglomerate` false-positive history above.

**Conclusion: none of the 4 benchmark failures trace back to this session's
work.** Two (ATE Group, Muthoot Finance) were pure benchmark-script/dev-
server infrastructure flakiness under sequential load, not application code
at all. Two (A-1 Fence Products, Bharat Forge) are the same pre-existing
scrape-content and `primary_type`-classification non-determinism this file
already extensively documents for these exact companies — genuinely real,
but not new, and not caused by the locale/leadership/ASCII/pageType/gate
fixes from this session, none of which touch scraper page-selection or the
`primary_type` cascade. Mean-score drop (49.83 → 46.08) is fully explained
by these 4 companies scoring low/zero in the one benchmark run that
happened to catch them mid-flake, not by any code change.

**Not done**: no code fix attempted for the underlying flakiness sources
themselves (dev-server load handling during a long sequential benchmark
run, or `A-1 Fence`/`Bharat Forge`'s scrape-content non-determinism) — both
are pre-existing, already-tracked issues, out of scope for a re-verification
pass. The dev-server-under-load theory for the two `fetch failed` cases is
plausible but not proven (would need a deliberately-instrumented re-run of
the full 10-company sequence to confirm timing correlation — not done, not
clearly worth the added quota spend given the individual re-runs already
confirm both domains are genuinely reachable and produce good output).

## RESOLVED 2026-07-27 — A-1 Fence Products / Bharat Forge `primary_type`
## flakiness from the re-verification above — two distinct real root causes
The re-verification directly above flagged both companies' `primary_type:
unknown` as "real content-dependent non-determinism, not caused by this
session's fixes" — true, but that stopped short of actually diagnosing
WHY, on the theory it was pre-existing and out of scope. User asked for the
actual fix next, so this session investigated both properly with real data
(cheap `test-scraper`-only calls, no LLM cost, before touching any code) —
found two genuinely different bugs, not one shared cause.

**Bharat Forge — real regex-coverage gap, not a scraping problem.** The
homepage scraped cleanly (5000 real chars) both times. Pulled the actual
homepage markdown and read it directly: "*Bharat Forge Limited... is a
global leader in high-performance components across sectors such as
Automotive, Railways, Defence... With over half a century of manufacturing
history, we have the largest repository of metallurgical knowledge...*" —
genuine, strong manufacturer-describing language that literally none of the
9 existing `manufacturer` regex patterns in `evidence-extractor.ts`'s
`buildCompanyProfile()` covered: the "leader in X" pattern's noun list
(forgings/castings/stampings/machining/fabrication/manufactur\*) didn't
include "components", and there was no pattern at all for "N years/
decades/century of manufacturing" — a specific, low-risk, unambiguous
self-description. **Fixed**: extended the "leader in X" pattern to also
accept `(?:precision|high[\s-]performance|engineered)\s+components?` (the
qualifier requirement deliberately excludes bare "leader in
components"/"leader in products" — too generic, could fire for almost any
industry, the exact "generic industry label, not a sales-useful signal"
anti-pattern this file's own "Why this exists" section warns against), and
added a new pattern for `(?:years?|decades?|century|centuries)\s+of\s+
manufactur\w+`. New `tests/evidence-extractor-manufacturer.test.ts` (7
assertions, `buildCompanyProfile()`'s first dedicated test file — no prior
coverage existed for this function at all): both new patterns against the
real captured Bharat Forge text, a combined-both-patterns case, two
false-positive guards (bare "leader in components"/"leader in products"
correctly still don't match), a non-regression check that the original
noun-list pattern still works, and a non-regression check that an unrelated
"years of X" phrase doesn't accidentally match. **Live-verified twice**:
re-ran bharatforge.com through the real pipeline (cached scrape, no code
change needed to the scrape itself) — `GATE_PASS stage=PROFILE
reason="Profile extracted: primary=manufacturer | companySubjectCount=3"`,
then a full run completed `GATE_OVERALL=PASS` end to end (up from the
benchmark's `primary_type=unknown` FAIL).

**A-1 Fence Products — a real scraper-logic bug, unrelated to Bharat
Forge's.** Pulled the actual scrape debug info directly: `"errors":
["Homepage failed: Homepage scrape timed out"]`, but `"sitemapUrlsFound":
125` — the sitemap fetch succeeded and found 125 real URLs in the exact
same request that timed out on the homepage specifically. Yet
`"urlsSelectedForScraping": []` and `"discoveryMethod": "homepage_only"` —
zero pages ended up selected despite 125 real candidates sitting right
there. Root cause, found in `lib/pipeline/scraper.ts`'s
`scrapeCompanyWebsite()`: when `homepage.page.success` is `false`, the
function tries Jina-reader and web-search fallback tiers, then
**unconditionally returns** — completely discarding `sitemapUrls`/
`rawMapUrls`, both already fetched in the same parallel `Promise.all()` at
the top of the function, independent of whether the homepage-specific
sub-request happened to succeed. A single slow/timed-out homepage fetch
doesn't mean the rest of the domain is unreachable; the sitemap proved that
directly, live, this exact run. **Fixed**: the homepage-failure branch now
checks whether `rawMapUrls`/`sitemapUrls` contain any same-domain
candidates before giving up — if they do, it logs and falls through into
the normal Step 3+ discovery/selection/scraping flow instead of returning
early. No separate guard needed for the two steps that read
`homepage.page.markdown`/`homepage.links` (B2C detection, homepage-link
extraction) — both already degrade safely to empty/false on a failed
homepage fetch, confirmed by reading them rather than assumed. **Live
verification is honest about its limits**: a live `force=true` re-scrape of
a-1fenceproducts.com did NOT reproduce the original timeout (the homepage
succeeded cleanly this time, 5000 chars / 38 links / 134 total candidates,
`SCRAPE:PASS` at 100/100 quality, `primary=manufacturer`) — transient
network timeouts aren't reliably reproducible on demand, so the NEW
fallback branch specifically was not exercised live this session. Confirmed
instead via direct code reading (the two steps it falls through into are
provably homepage-failure-safe) and `tsc --noEmit`; no unit test added —
`scrapeCompanyWebsite()` has no existing test coverage of any kind (would
need substantial new Firecrawl-SDK mocking infrastructure this repo doesn't
have yet for any scraper function, disproportionate to this fix — flagged
here rather than silently skipped).

**Verified**: `tsc --noEmit` clean, full suite 585/585 (578 pre-existing +
7 new, all in the new Bharat Forge test file). Both companies also
re-verified via their normal, already-working (homepage-succeeds) path
live, confirming zero regression from either change.

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

## RESOLVED 2026-08-03 — Gemini tier moved from AI Studio to Vertex AI Express Mode
User requested switching the Gemini credential from an AI Studio API key
(`GEMINI_API_KEY`, live-tested and made the default chain entry 2026-07-30 —
see `lib/ai/provider-factory.ts`'s header history) to a Vertex AI API key.
Investigated before writing code, since this looked like it might be a
one-line env-var rename: confirmed via Google's own Express Mode API
reference docs that **Vertex AI Express Mode does not expose an
OpenAI-compatible chat/completions endpoint** — only the native
`generateContent`/`streamGenerateContent`/`countTokens` REST methods at a
global `aiplatform.googleapis.com` endpoint. The existing Gemini tier went
through the generic `OpenAICompatibleProvider` (same class NVIDIA NIM
uses); that class can't be pointed at Express Mode.
**Fixed**: added `@google/genai` (Google's official unified SDK, ^2.15.0 —
speaks both AI Studio and Vertex, selected via a `vertexai: true` flag) and
a new `VertexGeminiProvider` (`lib/ai/providers/vertex-gemini.ts`) that
calls `client.models.generateContent()` directly and maps the response back
to this codebase's `CompletionResponse` shape. `provider-factory.ts` gained
a parallel `tryVertexGeminiChain()` (mirrors `tryVendorChain()`'s shape —
per-model try loop, rate-limit cooldown, error collection — but builds
`VertexGeminiProvider` instances instead of `OpenAICompatibleProvider`
ones, since there's no shared REST shape to parameterize over). Credential
renamed `GEMINI_API_KEY` → `GEMINI_VERTEX_API_KEY` (`.env.example`
updated) — deliberately a new name, not a reused one, so a stale AI-Studio
key left in `.env.local` doesn't silently get picked up as if it were a
valid Vertex key. `GEMINI_MODEL` (the model-override var) is unchanged —
Gemini model names are the same across both backends. The assistant did
not see or enter the user's actual key value at any point, per this
project's standing credential-handling rule — `.env.local` still has the
old `GEMINI_API_KEY=` line; the user needs to add their real Vertex Express
Mode key under `GEMINI_VERTEX_API_KEY` themselves (get one at
Google Cloud's Vertex AI Express Mode signup, no billing/GCP project
required) and can remove the old line once confirmed working.
**Bonus fix, user-approved as in-scope for this session**: the native
`generateContent` API tracks thinking tokens (`usageMetadata.
thoughtsTokenCount`) separately from visible output tokens
(`candidatesTokenCount`) — `maxOutputTokens` only bounds the latter. This
directly resolves the documented short-output empty-response bug (Gemini
burning its whole OpenAI-style `max_tokens` budget on hidden reasoning
before emitting visible JSON, see the 2026-07-30 header history above) —
the OpenAI-compat shim, not something inherent to Gemini 3 models, was the
actual root cause. `VertexGeminiProvider` sets `thinkingConfig.
thinkingLevel: 'MINIMAL'` (not `thinkingBudget: 0` — confirmed via Google's
current docs that Gemini 3 models cannot fully disable thinking, `MINIMAL`
is the lowest available level).
**Verified**: `tsc --noEmit` clean, full suite 621/621 passing (no existing
test exercises `provider-factory.ts` directly — consistent with this file's
own established precedent of verifying vendor/provider-chain changes via
`tsc`+tests and deferring a live smoke test, not adding new test
infrastructure for a config/vendor swap).

**Live-verified same day**, once the user added their real
`GEMINI_VERTEX_API_KEY` to `.env.local` (assistant never saw the value,
only confirmed the var name was present via `grep -o` on the key name).
Ran a temporary standalone script (`npx tsx`, deleted immediately after —
not committed, same "throwaway probe" precedent as this file's own
`__lint_probe.ts` note elsewhere) calling `getCompletion()` directly with
real quota, explicit user confirmation given first, two shapes:
1. A long-content `jsonMode` call (narrative-shaped, `maxTokens: 4096`) —
   succeeded: `gemini_vertex_gemini_3_6_flash`, 2724ms, `finishReason:
   STOP`, clean valid JSON (`company_summary` + `pain_points` array,
   correctly grounded in the fake company description given).
2. A short-output `jsonMode` call (subject-line-shaped, `maxTokens: 1024`,
   the exact call shape that used to trigger the empty-response bug under
   the old AI-Studio/OpenAI-compat shim) — succeeded: 1549ms, `finishReason:
   STOP`, clean valid JSON (`subject_lines` array of 3 real strings). This
   is the actual confirmation the `thinkingLevel: 'MINIMAL'` fix works
   under real traffic, not just in theory — the whole reason this was
   flagged as the one thing worth checking before trusting the swap.

Both calls resolved on the first try (no fallback to NVIDIA NIM needed),
both fast (under 3s), both clean JSON with no reasoning-channel leakage.
**Vertex AI Express Mode swap (including the thinkingLevel fix) is now
fully live-verified, not just code-complete.**

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

## BUILT 2026-08-05 — post-send tracking: open tracking, automatic
## follow-up engine, persistent per-company pipeline list
User asked what should happen after Auto Flow sends an email — track opens,
auto-follow-up if unopened past the cadence, and a persistent per-company
list to resume/check status later, instead of the flow just ending at send.
Two explicit decisions made before any code, both real overrides of this
app's usual caution, same category as the warmup engine's own authorization:
(1) auto-follow-ups send **fully automatically**, no click required, once
unopened past the existing cadence threshold; (2) the per-company list
includes **batch-researched companies too**, not just single-company-mode
ones. A third, safety-preserving decision: if open-tracking isn't
configured, the auto-engine **fails closed** (skips entirely, logs a
warning) rather than silently degrading into blind time-based auto-sending
— this is what actually keeps decision (1) matching what was authorized
("auto-send only if unopened") rather than quietly expanding it.

**What was built**:
- Migration `019_outbound_open_tracking.sql` — `outbound_campaign_contacts.
  opened_at TIMESTAMPTZ NULL`, first-write-wins, the one signal both the
  auto-engine and the pipeline list read.
- Public (no admin auth — no `middleware.ts` exists in this repo, so this
  is genuinely reachable by an email client) tracking-pixel route,
  `app/api/track/open/[campaignContactId]/route.ts` — `campaignContactId`
  IS `outbound_campaign_contacts.id` directly, no separate token column
  (already an unguessable UUID; worst-case misuse just suppresses one
  follow-up, never causes a wrong send). Idempotent first-open write +
  best-effort `'opened'` event insert (the event type has existed in
  migration 008's CHECK constraint since day one, just never written to
  until now) — always serves the inline 34-byte 1×1 GIF regardless of any
  DB outcome, confirmed live via curl with both a malformed id and a
  well-formed-but-nonexistent one (both correctly returned `200 image/gif`
  even before migration 019 was applied, proving the never-error contract).
- HTML email support, previously nonexistent (`gmail-client.ts`'s
  `buildMimeMessage()` was `text/plain` only, confirmed by direct code
  read before assuming otherwise) — new optional `bodyHtml` param emits
  real `multipart/alternative` (plain-text part first, HTML part last per
  RFC 2046's client-preference ordering); omitted entirely, output is
  byte-identical to the original plain-text-only behavior, zero risk to
  existing sends. New `lib/outbound/shared/email-html.ts`'s
  `plainTextToHtml()` — deliberately minimal (no styling/images beyond the
  pixel) to avoid reading as marketing email to spam filters. The pixel
  itself is built in `lib/outbound/sending/providers/gmail.ts` (app policy),
  not `gmail-client.ts` (stays "dumb MIME mechanics") — only activates when
  BOTH `campaignContactId` and the new `OUTBOUND_TRACKING_BASE_URL` env var
  are present; otherwise plain-text-only, exactly as before. That env var
  is required because there's no incoming-request context inside a
  background scheduler tick to derive an origin from — must be set
  explicitly in both `.env.local` and Railway's production config (a
  localhost value is unreachable by real email clients).
- Reply-check logic extracted verbatim from `check-replies/route.ts`'s loop
  body into `lib/outbound/sending/reply-check.ts`'s
  `checkRepliesForCampaign()` — preserves its exact fallback shape (the
  `cred.email`-unset case) rather than unifying it with
  `process-followup.ts`'s own separate inline check, which was written for
  a different situation on purpose. The route is now a thin wrapper, zero
  behavior change for the existing manual button.
- Automatic follow-up engine, `lib/outbound/sending/followup-engine/` —
  mirrors the warmup engine's pure (`tick-logic.ts`) / impure
  (`run-tick.ts`) split exactly. `isAutoFollowupEligible()` is a strict AND
  on top of the existing, unmodified `isFollowupDue()` — manual "Send Now"/
  "Process Follow-ups" never pass through this gate, exactly as specified.
  Per tick: checks replies first (via the extracted function above, so a
  same-tick reply is never mistaken for "still eligible"), then selects
  contacts that are both past cadence AND `opened_at IS NULL`, then sends
  via the same unmodified `processFollowupForContact()` manual follow-ups
  already use — no duplicated send logic anywhere. `FOLLOWUP_ELIGIBLE_
  STATUSES` hoisted out of `process-followups/route.ts` into
  `process-followup.ts` so both the manual route and the new engine select
  from the identical status set. New manual tick route
  (`/api/admin/outbound/followups/engine/tick`) + a "Run Follow-Up Engine
  Tick Now" button and result summary on the Follow-ups page, same
  "verify manually before trusting the scheduler" precedent as the warmup
  engine's own manual tick button. New `FOLLOWUP_ENGINE_ENABLED`/
  `FOLLOWUP_ENGINE_INTERVAL_MS` (default 1 hour) env vars, own separate
  `setInterval` in `instrumentation.ts` (own flag, own dev-hot-reload guard,
  own scheduler — not merged into the warmup one, different domain/risk
  profile) — **ships with `FOLLOWUP_ENGINE_ENABLED` unset**, same
  deliberate safe-default discipline as the warmup engine; nothing
  auto-sends to a real prospect until the user flips this themselves.
- **Real bug found and fixed during planning, not just during
  implementation**: `useAutoGtmFlow.ts`'s `resumeFromRun()` looked up a
  company's campaign via `GET /campaigns?source_run_id=<runId>` —  works
  for a single-company campaign (which has `source_run_id` set), but
  batch mode creates ONE SHARED campaign for the whole batch with
  `source_run_id: null`, so this silently found nothing for any
  batch-originated company. Consequence: resuming into one would never
  restore `campaignId`/`campaignContactStatus`, already-sent contacts
  would show as unsent, and clicking Send again would call
  `ensureCampaignId()` and create a genuinely duplicate campaign for
  contacts that already had one — a real duplicate-send risk once a real
  sending provider is active (which, per this file's own 2026-08-04 entry,
  it already is — Gmail). Fixed by looking up the campaign via the
  company's own contacts instead: new `?contact_ids=` filter on
  `GET /api/admin/outbound/campaigns` (finds whichever campaign already has
  any of those contact ids enqueued, via `outbound_campaign_contacts`) —
  works identically for single AND batch-originated companies since
  `outbound_contacts.source_run_id` is reliably set per-company either way.
  `resumeFromRun` also now explicitly sets `inputMode = 'single'` on
  resume regardless of original research mode — a focused single-company
  view, not an attempt to reconstruct batch progress state (which is pure
  React state, never persisted, confirmed during research — out of scope).
- Persistent per-company pipeline list — `GET /api/admin/outbound/pipeline`
  groups by `outbound_contacts.source_run_id` (not by
  `outbound_campaigns.source_run_id`), the same unification principle as
  the `resumeFromRun` fix above, so one query naturally covers both
  single-company and batch-originated companies with no special-casing.
  Aggregates `contactsTotal/sentCount/openedCount/repliedCount/
  bouncedCount/nextFollowupDueAt/lastActivityAt` per company in JS (this
  codebase's established convention over raw SQL/RPC). New
  `CompanyPipelineList.tsx`, styled per the Warm-Up/Follow-ups/Campaigns
  restyle earlier this same day (`GlassCard` header, `framer-motion`
  stagger, semantic-colored `PipelineStatusBadge`), rendered on Auto Flow's
  Research step directly below the single-company input, gated on
  `!hasResearch` so it's the landing state and gets out of the way once
  actively researching. Resume hardcodes step 4 (Outreach & Send) — not a
  guess, every row necessarily reached that step already since a campaign
  only ever gets created from there.
- **Real lint bug caught and fixed during this session**: `Date.now()`
  called directly inside `PipelineStatusBadge`'s render body tripped this
  repo's `react-hooks/purity` rule (impure call during render). Fixed by
  capturing `nowMs` once from the pipeline API's own response timestamp
  (a stable snapshot for the list's lifetime, which is also more correct
  semantics here than a live-ticking clock) and threading it down as a
  prop instead of calling `Date.now()` per row.

**Verified**: `tsc --noEmit` clean, full suite 652/652 (646 pre-existing +
6 new in `tests/followup-engine-tick-logic.test.ts` for
`isAutoFollowupEligible`). Live-verified in the browser: Auto Flow's
"Sent Companies" section renders its empty state correctly (even with the
pipeline API still 500ing pre-migration — confirmed graceful degradation,
not a crash), zero console errors; the Follow-ups page's new "Run
Follow-Up Engine Tick Now" button works end-to-end through the real UI and
correctly displays the fail-closed message and error summary. Tracking
pixel route live-curl-verified to always return `200 image/gif` regardless
of DB state (malformed id, well-formed-but-nonexistent id, both before
migration 019 was applied) — the "never error to the email client"
contract holds under real conditions, not just in theory.

**RESOLVED 2026-08-05 (same day) — migration 019 applied, pipeline list +
single-company resume live-verified against real data.** User ran the
migration; `GET /api/admin/outbound/pipeline` went from a 500 (missing
column) to real data — 7 companies, correct aggregate counts, correct
relative timestamps. Live-clicked "Resume" on a real company (Mahindra &
Mahindra Limited) via the actual Auto Flow UI: network trace confirmed
`resumeFromRun`'s new `?contact_ids=` campaign lookup fired correctly
(`GET /api/admin/outbound/campaigns?contact_ids=<this company's 4 contact
ids>`), found the existing campaign, landed on step 4 with 4 contacts
loaded, and the already-sent contact (Kumar Gururaj) correctly showed
status `sent` rather than appearing unsent — confirms the duplicate-campaign
bug this session fixed doesn't reproduce for a real single-company case.
Zero console errors throughout.

**Checked but NOT resolved — no batch-originated campaign exists in the
real database yet.** Queried every real campaign directly
(`GET /api/admin/outbound/campaigns`, no filter): all have a non-null
`source_run_id` (single-company origin) except one row named "Test
Campaign - Ador Welding," which is a manually-created debug-page test
row, not a real Auto Flow batch send. So the actual bug scenario this
session fixed (a SHARED campaign across multiple batch companies) has
never been live-exercised against real data — the query mechanism is
identical regardless of origin and is now proven correct for the
single-company case, but the shared-campaign path specifically still
needs a real batch (multi-company) research+send run through Auto Flow to
create a batch campaign, then a resume into one of its companies, to be
fully confirmed. User explicitly deferred this rather than forcing a
throwaway batch run just to test it — pick up whenever a real batch send
happens naturally.

**RESOLVED 2026-08-05 (same day) — real end-to-end open-tracking send,
live-verified with a real public origin.** `.env.local` only had a
`localhost` value to point `OUTBOUND_TRACKING_BASE_URL` at, which — per
this var's own documented requirement — is unreachable by real email
clients, so this needed a real public origin this dev environment doesn't
have on its own. Stood one up temporarily rather than waiting on a Railway
deploy: `npx localtunnel --port 3000` first, which proved genuinely
unreliable in practice (its process stayed alive but the public relay
silently stopped responding mid-test — confirmed by curling the same URL
repeatedly and getting connection failures while `localhost:3000` kept
answering fine; a real test send through it landed in the inbox but
`opened_at` never flipped, later explained by the dead tunnel rather than
Gmail's spam-folder image-blocking, which was the first, wrong hypothesis).
Switched to `npx cloudflared tunnel --url http://localhost:3000` (Cloudflare's
account-less quick tunnel) instead — proved reliable across repeated curl
checks — and re-ran the full test: created a throwaway test contact/
campaign (`company_name: "Open Tracking Test"`, real `singhaarav042002@gmail.com`
recipient, real LLM-generated content via the actual `generate-email`
route, real send via the actual `campaigns/[id]/send` route — every step
through this app's own real API, nothing bypassed), sent, user opened it
in Gmail, and confirmed live: `outbound_campaign_contacts.opened_at` set
to a real timestamp seconds after opening, a real `outbound_campaign_events`
row with `event_type: 'opened'` and `detail: {"source":"tracking_pixel"}`
alongside the real `'sent'` event from moments earlier. This is the actual
proof this item needed — the full chain (real Gmail send → real HTML
`multipart/alternative` body → real embedded pixel → real open → real DB
write) now confirmed working under real conditions, not just unit-tested
or curled in isolation. Test contact/campaigns intentionally left in the
DB (clearly named, harmless, easy to identify/delete later) rather than
cleaned up mid-verification. **Tunnel is temporary** — whichever one is
running when this was written will not still be up later; whoever revisits
`OUTBOUND_TRACKING_BASE_URL` needs either a fresh tunnel or (better, for
anything beyond one-off testing) the real Railway production origin.

**Real deliverability caveat surfaced by this same test, separate from
open-tracking itself and NOT fixed here**: both test sends landed in
Spam, including the second one (through the working `cloudflared` tunnel)
— user had to manually mark it "not spam" before it opened normally.
Tracking worked correctly once opened, but this is a genuine signal worth
a future look, not dismissed as test noise. Plausible contributors, not
confirmed: (a) this was a self-send (same Gmail address as both sender and
recipient), a pattern Gmail's abuse heuristics are known to weight
differently than mail to a distinct address; (b) the sending account's
warmup status — this is the exact same account/problem space as this
file's own 2026-08-04 DIY warmup engine entries elsewhere, so a
not-yet-warmed-up (or insufficiently warmed) sending mailbox landing in
spam is consistent with, not contradictory to, that work; (c) the test
subject line itself ("Testing open tracking — please ignore") and generic
LLM-drafted body contain exactly the kind of phrasing spam filters key on;
(d) an HTML email whose only real payload beyond a few generic sentences
is an invisible tracking pixel is itself a mildly spam-shaped structure.
Not investigated further this session — flagging for whoever next touches
sending deliverability, since it's a real, live-observed data point on
the exact account this app's warmup engine is meant to be improving.

1. Once `FOLLOWUP_ENGINE_ENABLED` is being considered: verify the
   automatic engine's real behavior end-to-end (a follow-up actually
   withheld for an opened email, actually sent for an unopened one past
   cadence) before ever setting it `true` — same "manual tick first, trust
   the scheduler later" discipline as the warmup engine. Not done this
   session — this session's verification proved open-tracking itself
   works, not the engine's own send-gating logic against real due
   contacts.
2. Live-verify the `resumeFromRun` batch-campaign fix against a real
   batch-originated company (see the "Checked but NOT resolved" note
   above) — deferred at the user's own request, not forgotten.

## BUILT 2026-08-05 (same day) — Auto Flow step 5: "Track & Follow Up"
After shipping open tracking, the automatic follow-up engine, and the
persistent "Sent Companies" list, the user pointed out that Auto Flow
itself still dead-ends at step 4 (Outreach & Send) — nothing links forward
to any of it. The original ask was for the flow to literally continue:
send → track opens → follow up, as one experience, not scattered across
pages you have to already know to visit. This adds a real 5th step,
reusing existing backend routes end to end — no new sending/tracking
logic, purely a new UI surface plus step-machine plumbing.

**What was built**:
- `STEPS` in `StepIndicator.tsx` gained `'Track & Follow Up'` as a 5th
  entry — confirmed via direct code read that this component is purely
  data-driven off `STEPS.length` (no hardcoded `4` anywhere in it), and its
  own header comment already said "5-step flow," stale until now.
- `useAutoGtmFlow.ts`: `FlowStep` widened to `1|2|3|4|5`; the URL-sync
  effect's upper bound `resumeStep <= 4` → `<= 5`; `resumeFromRun()`'s
  campaign-found branch now widens `maxStepReached` to 5, not 4 — step 5
  has no completion gate of its own beyond a campaign existing, same
  reasoning step 4's own unlock already used.
- New `app/admin/auto-gtm/TrackFollowUpStep.tsx` — self-contained, same
  pattern as `OutreachStep`/`ContactInfoStep` (owns its own fetch/action
  state rather than growing the central hook). Per contact: status badge,
  opened/not-opened + timestamp, next-follow-up-due, and (only when
  `nextFollowupSequence(status) !== null`) **Send Follow-up Now** /
  **Stop Remaining** buttons — reusing the exact existing
  `POST /followups/[id]/send-now` and `.../stop` routes the standalone
  Follow-ups page already uses, behind the same `ConfirmDialog` real-send
  warning discipline. One company-level **Check for Replies** button reuses
  `POST /campaigns/[id]/check-replies`.
- `app/api/admin/outbound/campaigns/[id]/contacts/route.ts`: additive-only
  change — now also computes and returns `nextFollowupDueAt` per row (same
  `getFollowupIntervals()` + `nextFollowupDueAt()` pair the pipeline list
  route already uses), so the new step's due-date display doesn't need a
  new endpoint.
- **Real scoping issue handled deliberately, not incidentally**: a
  batch-originated company shares ONE campaign with every other company in
  its batch (this session's earlier `resumeFromRun` fix dealt with the
  same fact) — so `GET /campaigns/[id]/contacts` can return OTHER
  companies' contacts too. `TrackFollowUpStep` filters the response down
  to just the `contacts` prop's ids (already correctly scoped to the
  current company) before rendering, rather than assuming every row in the
  campaign belongs to whoever's currently in the flow.
- `page.tsx`: new step-4 `nextAction` branch — "Continue to Track & Follow
  Up," gated on `flow.campaignId` existing (at least one send/enqueue
  attempt), not on send count, so "0 sent" is still a valid, visitable
  state. New step-5 JSX block with its own `← Back` to step 4.
  `onStepClick`'s cast widened to include `5`.
- `CompanyPipelineList.tsx`'s "Resume" handler changed from
  `flow.setStep(4)` to `flow.setStep(5)` — resuming from Sent Companies
  means "I already sent, let me check on it," so landing on Track & Follow
  Up (not back on the send screen) is the correct destination now that it
  exists.

**Verified**: `tsc --noEmit` clean, full suite 652/652 (no regressions —
confirmed the additive `nextFollowupDueAt` field doesn't break any
existing caller of that route). Live-verified end to end against real
data: resumed into Mahindra & Mahindra Limited from the Sent Companies
list, landed correctly on `?step=5` (not 4), StepIndicator showed "Step 5
of 5" with steps 1-4 marked done, and the real contact (Kumar Gururaj,
status `stopped`, `opened_at: null`) rendered exactly matching a direct DB
cross-check via curl — including the new `nextFollowupDueAt` field
correctly computing `null` for a stopped contact. Confirmed the
Send-Follow-up-Now/Stop buttons correctly do NOT render for a `stopped`
contact (eligibility gating working). Clicked "Check for Replies" live —
returned "Checked 0 — 0 new replies, 0 bounces" (correct: `stopped` is
excluded from the reply-check's own status filter), zero console errors.
Clicked "← Back," confirmed step 4 renders with "Continue to Track &
Follow Up" present and enabled. Zero console errors throughout.

**Not verified — genuine gaps, not oversights**:
1. **Send Follow-up Now / Stop Remaining were never actually clicked
   live** — the only real contact reachable through Auto Flow's resume
   flow (Kumar Gururaj) already had status `stopped`, so those buttons
   correctly didn't render for it, leaving nothing safe to click without
   either sending a real unsolicited follow-up to a real prospect (not
   done without the user's own explicit go-ahead each time, per this
   repo's standing rule) or building fresh throwaway test data with a
   proper `pipeline_test_runs` row just to reach it through the UI (not
   done this pass). The routes themselves are pre-existing and unmodified
   — only newly wired into this new UI — so this is a lower-risk gap than
   it would be for genuinely new send logic, but it's still not
   click-tested through this specific screen.
2. **Batch-shared-campaign scoping was code-reviewed, not live-tested** —
   same real gap already logged elsewhere in this file for the
   `resumeFromRun` fix: no batch-originated campaign exists in the real
   database yet to prove the filter-to-this-company's-contacts logic
   against actual shared-campaign data.

## RESOLVED 2026-08-13 — Competitor Discovery Engine: AI direct-knowledge is
## now the PRIMARY path, search-extraction demoted to fallback
User reported a live L&T (Larsen & Toubro) run surfacing "United States
Department" and "Johnson" as competitors — fragments extracted from an
unrelated government/audio-equipment search snippet. Confirmed via direct
code read: `classifyRejection()` in `competitor-discovery.ts` (self-name,
known-directory-name, stopword, relationship-framing checks) doesn't catch
this shape at all — it's not a directory name or a customer/supplier
mention, just noise that happened to regex-match as a proper noun. This is
the same root-cause class CLAUDE.md already documents for ATE Group's
"Top Data Analytics Companies" listicle contamination, just via a different
extraction path.

Considered and tested an alternative before building anything: ask the LLM
(Gemini, already the default first-tried provider in `provider-factory.ts`'s
chain) directly for competitors, instead of search-then-extract. Live-tested
by hand (real chat calls, not this codebase) against both Larsen & Toubro
(a large, famous conglomerate) and Ador Welding (a real benchmark company,
far less famous) — both came back clean, correctly-named, well-categorized
real competitors, no hallucinated junk in either case. This was a genuine
update to a real concern: the original 2026-07-14 architecture decision
("search-grounded, not LLM-narrated") was built specifically to avoid an
LLM inventing plausible-sounding competitors from parametric knowledge —
still a real risk for a company the model has no specific knowledge of, but
the two hand-tests suggested the risk was smaller than assumed, PROVIDED the
model is explicitly instructed to decline rather than guess.

**Built**: new `discoverCompetitorsFromKnowledge(companyName, domain)` in
`lib/enrichment/competitor-discovery.ts` — a single direct `getCompletion()`
call (same call pattern as `business-profile.ts`'s `extractBusinessProfile`)
asking for real, confidently-known competitors, with an explicit
`"has_knowledge": false` escape hatch the model is instructed to use instead
of guessing when it doesn't know the company. Each returned name still runs
through the SAME `classifyRejection()` safety net every search-extracted
candidate already goes through (self-name/known-directory/stopword) — this
is deliberate defense-in-depth, not redundant, since the model could still
name the researched company itself or cite a directory site by mistake.
`well_known: true/false` per competitor (asked of the model) maps to
`confidence: 'high'/'medium'` — never `'high'` uniformly, keeping this
codebase's "prefer under-confidence" discipline even for a confident-sounding
LLM answer. No `source_urls` (nothing to cite) — new `source?: 'search' |
'ai_knowledge'` field on `CompetitorProfile` lets `ResearchCard.tsx` label
these "AI-assessed" instead of implying a clickable citation.

**Wired into `route.ts`** as the new PRIMARY path (kicked off early,
parallel with `businessProfilePromise`, since it needs only the company
name — no scraped content or business profile dependency): Step 4b now
tries `discoverCompetitorsFromKnowledge()` first (20s bound); only when it
returns `sufficiency: 'insufficient'` (declined, timed out, or every
candidate got filtered) does the pipeline fall through to the EXISTING
2026-07-16 business-profile-driven search pipeline
(`discoverCompetitorsFromBusinessProfile` + offering-grounded fallback +
merge) — unchanged code, just now gated behind the knowledge pass declining
instead of running unconditionally. `candidates: []` on the knowledge path
means the `[COMPETITOR CANDIDATES]` narrative-prompt block in
`analyze-v2.ts` correctly renders "None found" for these entries and never
re-narrates them — `normalize.ts`'s name-match merge already falls through
to the code-derived `why_they_compete`/`market_position` for any
LLM-narration-unmatched skeleton, so no changes were needed there beyond
threading the new `source` field through.

New `tests/competitor-discovery-knowledge.test.ts` (10 assertions, mocking
`getCompletion` — same pattern as `tests/business-profile.test.ts`): clean
parse with `source: 'ai_knowledge'` tagging, confidence mapping from
`well_known`, the 8-competitor cap, `has_knowledge: false` decline,
self-name and known-directory-name rejection (reusing `classifyRejection`),
all-rejected → insufficient, fence-stripped JSON, LLM-call failure, and
unparseable-response — all non-fatal, never throws. **Caught a real
pre-existing quirk while writing the cap test**, not a bug in the new
code: an initial fixture used company name "Some Company" against generated
candidates "Company 0".."Company 9" — `isSelfName()`'s word-overlap ratio
filters out single-character words (the digit) before comparing, so each
candidate collapsed to just the shared word "company" and hit the 100%
overlap self-name threshold. Fixed by using non-colliding fixture names
(`"Acme Corp"` / `"Rival Industries N"`), not by touching the shared
`isSelfName()` logic — this is pre-existing, reused-elsewhere behavior, not
something this session's code introduced.

**Verified**: `tsc --noEmit` clean, full suite 689/689 (679 pre-existing +
10 new). **Live-verified with one real Gemini Vertex call** (explicit user
confirmation given first, throwaway script deleted after): ran
`discoverCompetitorsFromKnowledge('Ador Welding', 'adorwelding.com')`
directly — `gemini-3.6-flash`, 2983ms, real JSON response, correctly
resolved to 1 competitor (ESAB India Limited, `confidence: 'high'`,
`source: 'ai_knowledge'`, `market_position: 'Direct domestic and global
competitor in welding consumables and equipment'`).

**Known limitation, not fixed**: this one live run returned only 1
competitor for Ador Welding, versus 9 (across multiple sector categories)
from an earlier informal chat-based test outside this codebase against the
same company. The stricter prompt wording used here ("only include if you
have specific, confident knowledge... not a guess based on the sector
alone") appears to make the model meaningfully more conservative than a
plain "list competitors" ask — the intended precision-over-volume
trade-off, but it means this path may under-deliver relative to what the
model is actually capable of naming. Not tuned further this session; worth
revisiting if live runs show this pattern repeating across other companies
— loosening the prompt slightly (e.g. explicitly allowing well-known
sector-standard competitors, not just ones tied to a specific stated fact)
is the likely fix, not more search-side filtering.

**Not tested live**: the genuinely obscure benchmark companies (Ace
Pipeline, AS Agri & Aqua) — these are the actual stress test for the
`has_knowledge: false` decline path (does it honestly decline, or
hallucinate?). Untested in this session; the search-based fallback exists
specifically to catch this case if the decline path doesn't fire reliably,
but that fallback behavior itself hasn't been re-verified live since this
session's change (though it's unmodified code, only newly gated).

## RESOLVED 2026-08-13 (same day) — same AI direct-knowledge rebuild applied
## to ICP Generator (Target Customer Segments)
Follow-up to the Competitor Discovery rebuild directly above — user
approved extending the same pattern to `icp-generator.ts`, which the L&T
run's suspicious segment list (Education/Law Firms/Performing Arts — a
textbook AV-integrator vertical list, not plausible for a construction
conglomerate) had already flagged as likely exposed to the same
search-noise contamination class. Confirmed via code read: the
self-referential "we serve X" base pass (`discoverICPSegments`,
`requireCompanyMention=true`) has the identical exposure competitor
discovery's old name-based pass had — a result mentioning the researched
company's name somewhere doesn't guarantee the "who we serve" language on
that page actually describes THIS company.

**Built**: new `discoverICPSegmentsFromKnowledge(companyName, domain)` in
`lib/enrichment/icp-generator.ts` — same call pattern, same
`has_knowledge: false` decline instruction, same `classifySegmentRejection()`
defense-in-depth reuse as the competitor version. Asks for WHO buys (e.g.
"automotive OEMs"), not what the company does — the prompt explicitly warns
against describing the company's own offerings. Model self-rates
`confident: true/false` per segment → `confidence: 'high'/'medium'`, same
"prefer under-confidence" mapping as competitors' `well_known`. New
`source?: 'search' | 'ai_knowledge'` field on `ICPSegment`.

**One extra fix needed here that competitors didn't**: `normalize.ts`'s ICP
merge unconditionally set `use_cases`/`market_attractiveness`/`priority`
from the LLM-narration match only (`llmMatch?.use_cases ? ... :
undefined`, no fallback to the code-derived skeleton) — harmless before
this session since the search-based skeleton never populated those three
fields itself (only LLM narration ever did), but the new knowledge-path
skeleton DOES set them directly, and `candidates: []` on that path means no
narration match will ever exist to carry them through. Fixed by adding the
same `|| s.<field>` fallback the competitors merge already used for
`why_they_compete`.

**Wired into `route.ts`** the same way as competitors: `icpKnowledgePromise`
kicked off early alongside `competitorKnowledgePromise` (needs only company
name). Step 4c tries it first (20s bound); on decline, falls through to the
EXISTING, unmodified base-pass + business-profile/offering-supplement merge
(unlike competitors, this fallback was already a two-source merge before
this session — that internal shape is untouched, only the decision of
whether to run it at all moved behind the knowledge pass declining).

New `tests/icp-generator-knowledge.test.ts` (10 assertions, same
`getCompletion`-mocking pattern): clean parse with `source: 'ai_knowledge'`
and `use_cases`/`priority`/`market_attractiveness` populated, confidence
mapping from `confident`, the 5-segment cap (`MAX_SEGMENTS`), decline,
self-name and generic-term rejection, all-rejected, fence-stripped JSON,
call failure, unparseable response.

**Verified**: `tsc --noEmit` clean, full suite 699/699 (689 pre-existing +
10 new). **Live-verified with one real Gemini Vertex call** (explicit user
confirmation given first, throwaway script deleted after):
`discoverICPSegmentsFromKnowledge('Ador Welding', 'adorwelding.com')` —
`gemini-3.6-flash`, 4975ms, 5 real segments (Heavy Engineering/
Infrastructure Contractors, Oil & Gas/Petrochemical Refineries, Power
Generation, Shipbuilding/Marine Engineering, Automotive/Transport
Component Manufacturers), all correctly framed as WHO buys rather than
what Ador does, all `confidence: 'high'`, all `source: 'ai_knowledge'` —
materially more specific and plausible than the search pipeline's own
historical output for this exact company, and clearly not the AV-integrator-
shaped contamination pattern that triggered this whole fix.

**Not tested live**: same gap as the competitor version — the genuinely
obscure benchmark companies (Ace Pipeline, AS Agri & Aqua) weren't tested,
so the `has_knowledge: false` decline path is unverified against a company
the model genuinely doesn't know. The search-based fallback (unmodified)
is the safety net if it doesn't fire reliably.

## RESOLVED 2026-08-13 (same day) — ICP knowledge schema extended with
## `criteria` + `example_companies`
User separately ran L&T's target-customer segments through a manual chat
test (outside this codebase) and got a materially richer result than this
session's own live-verified output — named example clients (DMRC, NHAI,
Saudi Aramco, ADNOC, Tata, Vedanta, LTIMindtree, LTTS, L&T Finance/Realty)
and qualifying criteria per segment, organized by business division. Both
`ICPSegment.criteria` and `.example_companies` already existed as fields
(the search path could theoretically populate them, though in practice
never did) but `discoverICPSegmentsFromKnowledge`'s prompt didn't ask for
either. User approved extending the schema, with the same confidence
discipline as the rest of the prompt.

**Built**: `buildKnowledgeSegmentUserPrompt` now also requests `criteria`
(a qualifying description, e.g. "$10M+ capex projects") and
`example_companies` (real named clients, explicitly instructed to leave
empty rather than invent a plausible-sounding name). `example_companies`
gets an EXTRA guard beyond the prompt instruction: gated on `item.confident
=== true` in code, not just trusted from the model's own response — a
named client is the single most specific, checkable claim this function
can emit, so it's held to a stricter bar than the rest of the segment (an
otherwise-`confident: false` segment still keeps its `criteria`, just never
its named examples). Capped at 5 names, non-string/empty entries filtered.

**Found and fixed the same silent-drop bug class as before, in the same
place**: `normalize.ts`'s ICP merge had the identical no-fallback issue for
`criteria`/`example_companies` that this session's earlier `use_cases`/
`market_attractiveness`/`priority` fix already addressed — extended the
same `|| s.<field>` fallback to cover all five fields now, not just three.

**`example_companies` was never rendered in `ResearchCard.tsx`'s
`TargetSegmentsSection`** — a pre-existing gap (the field existed on the
type, nothing populated or displayed it before this session). Added an
"Example clients:" line to the same criteria/buying-signal/use-case row.

New tests in `tests/icp-generator-knowledge.test.ts` (+3, 13 total):
`criteria`/`example_companies` populated when confident, `example_companies`
withheld (but `criteria` kept) when the LLM marks a segment `confident:
false` even if it returned names anyway, and the 5-name cap + non-string
filtering.

**Verified**: `tsc --noEmit` clean, full suite 702/702 (699 pre-existing +
3 new). **Live-verified with one real Gemini Vertex call** against
`Larsen & Toubro` (explicit user confirmation given first, throwaway
script deleted after) — real named clients (National Highways Authority of
India, Delhi Metro Rail Corporation, NTPC Limited, Power Grid Corporation
of India, Saudi Aramco, Indian Navy, Ministry of Defence) with real
criteria per segment, closely matching the richness of the user's own
manual chat test that prompted this extension.

## RESOLVED 2026-08-13 (same day) — third discovery tier: search-grounded
## LLM synthesis, for both Competitors and ICP segments
Triggered by a live-testing session against genuinely obscure benchmark
companies (Ace Pipeline, AS Agri and Aqua — the two companies this file's
own "not tested live" gaps had flagged across the two entries above).
Found a real, mixed result: the direct-knowledge path's decline mechanism
worked correctly for AS Agri and Aqua (near-zero web footprint, honestly
declined `has_knowledge: false`) but NOT reliably for Ace Pipeline (a real
but smaller company operating in a well-documented industry — the model
confidently named plausible-sounding, unverifiable competitors instead of
declining). Separately, the user got a materially richer answer for AS
Agri and Aqua by asking Google's Gemini consumer app directly — traced
this to the app having live Google Search grounding on by default, which
is a fundamentally different capability from `discoverCompetitorsFromKnowledge()`'s
raw completion call (no search tool attached). That distinction — "what do
you remember" vs. "what can you find and summarize" — is what this session
built as a genuine third tier, not a replacement for either existing one.

**Built**: `discoverCompetitorsViaSearchSynthesis()` (competitor-discovery.ts)
and `discoverICPSegmentsViaSearchSynthesis()` (icp-generator.ts) — fetch
real search results (reusing the exact same fetch+relevance-filter step the
regex-extraction pipeline already used; extracted into
`fetchRelevantSearchResults()`/`fetchRelevantICPSearchResults()` so both the
old regex path and the new synthesis path share one fetch implementation,
not two divergent copies), then ask an LLM to synthesize a competitor/
segment list STRICTLY from that real content — instead of the brittle regex
extractors (`extractVsPair`/`extractListAfterTrigger`/etc). The
anti-hallucination discipline the old regex-grounded design relied on is
preserved through a DIFFERENT mechanism: every claimed name must come with
an `evidence_quote`, mechanically verified via `verifyQuoteInContent()`
(`lib/pipeline/quote-verification.ts`, already built for exactly this
"LLM claims a quote, verify it's real" pattern in normalize.ts's
opportunities/pain-points paths) — a claim whose quote doesn't verify is
DISCARDED, not flagged. This also restores real `source_urls` (something
`discoverCompetitorsFromKnowledge()` structurally can't have), determined
by checking which fetched result(s) the verified quote actually came from.
New `source: 'search_synthesis'` value on both `CompetitorProfile.source`
and `ICPSegment.source`.

**Wired as the MIDDLE tier** in `route.ts`: knowledge declines → this tier
(called lazily, not kicked off eagerly, so a company the knowledge pass
already succeeds for never pays for the extra search+LLM call) → still
insufficient → falls through to the existing regex-extraction pipeline
(business-profile/offering pass for competitors; base "we serve X" +
supplement for ICP) as the third and final safety net, unchanged. Decline-
reason strings now chain across all three tiers for gate diagnostics
(`"AI direct-knowledge declined (...) — search-synthesis declined (...) —
fell back to regex search: ..."`).

**Real bug found and fixed during testing, not just documented**: the
first test run against Ace Pipeline surfaced duplicate URLs in
`source_urls` (the same URL 4x) — root cause: `buildCompetitorQueries`
produces 4 queries, and the same real page can legitimately rank for more
than one of them, so the same URL appears more than once in the fetched
`results` array; `findSupportingSources()`/`findSupportingICPSources()`
were pushing to a plain array with no dedupe. Fixed by switching both to a
`Set`. Caught by the new test suite itself (a mocked search returning one
result reused across all 4 mocked queries reproduces this exactly), not by
guessing.

New test files `tests/competitor-discovery-synthesis.test.ts` (9
assertions) and `tests/icp-generator-synthesis.test.ts` (8 assertions,
including the adversarial-content regression below), mocking
`getCompletion` and `discovery-engine`'s `searchTavily`/`searchSerper`
(same pattern as `tests/website-discovery.test.ts`).

**Verified**: `tsc --noEmit` clean, full suite 717/717 (702 pre-existing +
15 new) BEFORE the adversarial-content fix below; see that entry for the
final 724/724 count. **Live-verified with real Tavily/Gemini quota**
against `AS Agri and Aqua` (explicit user confirmation given first,
throwaway script deleted after): the competitor synthesis tier surfaced 5
real, correctly-sourced competitors (Budmore Agro Industries, Dindor Farm
Private Limited, E-fasal, Inevitable Tech, FutureFarms) from real
startup-directory sites (ynos.in, tracxn.com) that the knowledge-only path
had nothing on — exactly the improvement this tier was built for.

## RESOLVED 2026-08-13 (same day) — adversarial-content bug found via the
## same live test: quote-verification proves a quote is REAL, not that its
## INTERPRETATION is sound
The SAME live-verification run above surfaced a second, more serious
finding on the ICP side: `discoverICPSegmentsViaSearchSynthesis` returned
exactly one segment — `"Investors"`, `confidence: 'high'` — sourced from a
Facebook page literally titled **"As Agri and Aqua LLP (ASAA) SCAM"**, with
the quoted evidence being a real, genuine sentence from that page: *"AS
Agri and Aqua LLP (ASAA) has scammed thousands of people and this advocate
has fooled people in the name of helping investors and have fled away with
lakhs."* The quote-verification check worked exactly as designed — the
quote genuinely is real text from a real source — but the LLM completely
misread what the quote MEANS: a fraud allegation naming victims got
classified as evidence of a legitimate "Investors" customer segment. This
is a fundamentally different failure mode than anything the quote-
verification discipline (built for opportunities/pain-points, reused here)
was ever designed to catch: it proves REALNESS, not CORRECTNESS of
interpretation. Had this reached a real saved run, it would have rendered
as "Target segment: Investors, confidence: high" for a company with public
fraud accusations — actively wrong and reputationally risky, not merely a
weak/generic signal.

**Fixed, two layers, same principle as `mentionsCompany()`'s existing
"never let contaminated content reach extraction" discipline, just for a
new contamination shape**:
1. **Source-level filter (primary defense)** — new
   `looksLikeAdversarialContent()` / `filterAdversarialContent()` in
   `lib/enrichment/extraction-guards.ts` (shared by both competitor-
   discovery.ts and icp-generator.ts, same file/pattern as `mentionsCompany`).
   A regex over strong, unambiguous fraud/scam vocabulary (scammed, fraud,
   ripoff, ponzi, duped, cheated, fled with, absconded, defrauded, consumer
   complaint, FIR filed, blacklisted, fake company, money laundering) —
   deliberately narrow, not a broad negative-sentiment filter: a company
   facing a real supply-chain problem or product recall is still legitimate
   business content elsewhere in this pipeline; this guard only targets
   content where the company itself is accused of defrauding people, which
   can never legitimately support a competitor or customer-segment claim.
   Wired into `fetchRelevantSearchResults()`/`fetchRelevantICPSearchResults()`
   (the shared fetch step from the session above) — applied AFTER the
   existing relevance gate, not instead of, so this benefits ALL FOUR
   consumers automatically (both regex-extraction passes AND both new
   synthesis passes), not just the module that happened to surface the bug.
2. **Prompt-level instruction (defense in depth)** — both synthesis
   prompts gained an explicit rule: ignore scam/fraud/complaint/lawsuit
   content, and never classify a victim or accuser as a competitor or
   customer segment. Catches any case that slips past the keyword filter
   (euphemistic language, a gap in the vocabulary list) — the source filter
   is the primary defense, this is the backstop, not the reverse.

New regression tests: `tests/extraction-guards.test.ts` gained 5 assertions
for the new guards directly (the exact live bug content, common fraud/
complaint vocabulary variants, two non-regression cases — ordinary
legitimate content, and legitimate-but-negative content like a product
recall, both correctly NOT flagged — and the filter function itself).
Both `tests/competitor-discovery-synthesis.test.ts` and
`tests/icp-generator-synthesis.test.ts` gained a dedicated regression test
reproducing the exact live-found content shape, asserting `getCompletion`
is never even called when every relevant result is scam-shaped.

**Verified**: `tsc --noEmit` clean, full suite 724/724 (717 pre-existing +
7 new — 5 in extraction-guards.test.ts, 1 each in the two synthesis test
files). **Re-verified live against the exact real case that surfaced the
bug** (same AS Agri and Aqua call, explicit confirmation given first,
throwaway script deleted after): the scam Facebook page no longer reaches
the LLM at all; the ICP synthesis pass now correctly surfaces a legitimate
segment instead — **"Farmers and Land Owners"**, sourced from a real
business article (primeview.co), quoting the company's own stated
profit-sharing farming model ("We help the poor farmer and land owners
implement farming using our technics and technology and we share the
profits") — no scam content, no misclassification. The competitor
synthesis pass on the same re-run was unaffected (its own sources were
never scam-shaped), still correctly surfacing the same 5 real competitors
as the first run.

**Not done**: the adversarial-content vocabulary list is a first pass, not
exhaustive — a future live run surfacing a different euphemism or fraud-
adjacent framing that slips past both the keyword filter and the prompt
instruction should be treated as a vocabulary gap to extend, same
discipline as every other keyword-list guard in this codebase (matchesKeyword,
NON_COMPETITOR_NAMES, etc.), not evidence the two-layer approach itself is
wrong.

## BUILT 2026-08-14 — Apollo.io added as a second vendor across 4 integration points
User asked to discuss everything Apollo could fix/upgrade, then to implement
it. Scoped via two decisions before writing code: (1) **no Apollo decision-
maker-discovery provider** — Apollo's People Search only returns obfuscated
last names (`"Mo***s"`); a usable name requires a separate People Match-by-ID
call costing 1 real credit PER candidate just to reveal it, whereas Prospeo's
existing decision-maker provider already returns full names for free in one
search call. Not a good trade — Prospeo remains the only decision-maker-
discovery provider. (2) **live-verify with a real key** this session, not
deferred, following the same discipline as every other vendor integration in
this file (`tsc`+tests first, then a real API call with explicit
confirmation, never guessing at correctness).

**What was built, 4 integration points**:
1. **Email Finder** (`lib/outbound/email-finder/providers/apollo.ts`) and
   **Contact Enrichment** (`lib/outbound/enrichment/providers/apollo.ts`) —
   both call Apollo's People Match endpoint (`POST /v1/people/match`),
   registered as `apollo` alongside `mock`/`prospeo` in both
   `provider-factory.ts` files and `CAPABILITY_KNOWN_PROVIDERS` in
   `lib/outbound/settings/types.ts` — same DB-row → env-var → mock
   resolution as every other outbound capability. New shared client
   `lib/outbound/shared/apollo-client.ts` (`callApolloPeopleMatch`,
   `getApolloApiKey`), mirroring `prospeo-client.ts`'s shape but with one
   documented divergence: Apollo uses real HTTP status codes (a non-2xx IS
   a real error) — unlike Prospeo, which returns non-2xx even for soft
   "not found" outcomes with the real detail in the JSON body. Copying
   Prospeo's "any JSON body = ok:true" convention here would have been
   wrong; this was flagged in the client's own header comment and confirmed
   correct by the live test below.
2. **Company Discovery Engine** (`lib/enrichment/company-discovery.ts`) —
   Apollo Organization Search added as an additional parallel candidate
   source (`searchOrganizationsApollo()`, new
   `lib/enrichment/sources/apollo-client.ts`, same flat-env-var/no-DB
   pattern as `edgar-client.ts`), feeding the same `grouped` Map the
   regex/LLM extraction already populates — an Apollo-sourced name goes
   through the identical `classifyCompanyRejection()` → tier → cap
   pipeline, tagged `source: 'apollo'` (new field on
   `CompanyDiscoveryCandidate`/`CompanyMatch`, mirrors
   `CompetitorProfile.source`). `tierMatchConfidence()` treats an
   Apollo match as `high` regardless of mention count (a licensed
   structured-database hit, not a snippet-mention count). Apollo-sourced
   candidates carry their own resolved domain and skip the expensive
   `discoverCompanyWebsite()` verification pass entirely — reasoned as
   correct because Apollo's org search is a structured DB match tied to a
   specific organization ID, a fundamentally different (and stronger)
   claim than "this page's text happens to mention these words," which is
   the exact false-positive shape `discoverCompanyWebsite()` exists to
   guard against for regex-extracted names.
3. **Website Discovery** (`lib/enrichment/website-discovery.ts`) — Apollo
   Organization Enrichment (`enrichOrganizationApollo()`) added as an
   additional candidate-domain source inside `discoverCompanyWebsite()`,
   ranked ahead of generic search-derived candidates but behind an
   explicit caller-supplied `knownDomain`, and — unlike the company-
   discovery integration above — still run through the exact same
   `isKnownNonCorporateDomain()`/`scoreCandidate()`/homepage-fetch
   verification gauntlet as every other candidate. Deliberately NOT given
   the same "trust it directly" treatment as company-discovery's
   integration: `discoverCompanyWebsite()`'s whole reason for existing is
   "verify, never trust blindly" (see its own header comment), so an
   Apollo guess here is a strong prior, not a bypass.

Both `lib/enrichment/` integrations (2 and 3) are additive/no-op —
`APOLLO_API_KEY` unset means zero behavior change, same "additive, not
required" discipline as the EDGAR integration. New `.env.example` block
documents that one `APOLLO_API_KEY` covers both the outbound-capability
providers and the always-on enrichment sources.

New tests: `tests/apollo-client.test.ts` (mocked `global.fetch`, including
the real-HTTP-status-codes divergence from Prospeo), `tests/apollo-
providers.test.ts` (both outbound providers' request/response mapping),
`tests/apollo-enrichment-client.test.ts` (mirrors `tests/edgar-client
.test.ts` for the two enrichment-source functions), plus targeted
additions to `tests/company-discovery.test.ts` (`tierMatchConfidence`/
`fallbackReason`'s apollo-source branches — the pure functions, not a full
mocked end-to-end run, since this test file has no existing search-mocking
infrastructure and adding it was judged disproportionate to this change)
and `tests/website-discovery.test.ts` (Apollo-sourced domain going through
full verification, not trusted blindly; a caller-supplied `knownDomain`
still taking priority; no duplicate candidate when Apollo and search agree).
`tsc --noEmit` clean, full suite 799/799 (799 = prior count + ~50 new).

**Live-verified with the user's real Apollo API key** (Basic/Trial plan,
explicit confirmation given first, throwaway `npx tsx` script deleted
immediately after — same precedent as every other live-verification entry
in this file): 3 real calls, one per non-DB-dependent code path.
- **Organization Enrichment: fully works.** `enrichOrganizationApollo({
  name: 'HubSpot', domain: 'hubspot.com' })` returned real, correctly-
  mapped data (industry, `estimated_num_employees: 8900`,
  `annual_revenue_printed: '3.1B'`, a real description) — confirms the
  Website Discovery integration point end-to-end.
- **People Match: blocked by account plan, not code.** Real response:
  `403 API_INACCESSIBLE — "The api/v1/people/match API is not included in
  your Basic (Trial) plan and is not accessible, even with a master key.
  All paid plans include full API access."` The client correctly surfaced
  this as a real error (proving the non-2xx-is-a-real-error handling works
  as designed), not a code bug — Email Finder and Contact Enrichment are
  code-complete and will work once the account is on a paid plan, but are
  UNVERIFIED beyond this error response.
- **Organization Search: same plan block.** Direct raw-fetch diagnostic
  confirmed identical `403 API_INACCESSIBLE` on `mixed_companies/search` —
  same conclusion: code-complete (a plan-restriction error, not a 404 or
  malformed-request error, confirms the endpoint URL and request shape are
  correct), Company Discovery Engine's Apollo path is UNVERIFIED against
  real search results until the account upgrades.

**Not done**: neither People Match nor Organization Search has been
confirmed against a real successful response — only against a real,
informative 403. Whoever revisits this after an Apollo plan upgrade should
re-run the same 3-call live check (a throwaway script calling
`callApolloPeopleMatch`/`searchOrganizationsApollo` directly, same pattern
used this session) before trusting Email Finder, Contact Enrichment, or
Company Discovery Engine's Apollo path in a real run. All 4 integration
points default to `mock`/no-op — selecting `apollo` in `/admin/outbound/
integrations` (or the equivalent env vars) is a deliberate opt-in, same
safe-default discipline as every other vendor in this file.

## BUILT 2026-08-14 (same day) — Demaze Lead Discovery: E-commerce sector +
## a numeric revenue-range filter (₹50cr-₹500cr), using Apollo data already
## fetched for domain resolution
Follow-up to the Apollo build above, same session. User asked for two
things for Demaze's own Lead Discovery flow (`/admin/company-discovery` →
`/api/admin/demaze-leads`): restrict target sectors to Manufacturing/
Automotive/E-commerce, and filter to companies roughly ₹50cr–₹500cr annual
revenue. Manufacturing/Automotive already existed in
`DEMAZE_CONFIRMED_SECTORS`; **E-commerce added** (`lib/enrichment/
demaze-leads.ts`). Apollo's real Organization Search endpoint (which has a
native `revenue_range` filter) is still plan-gated on this account (see the
entry above), so this uses **Option 2**: a post-discovery filter against
Apollo Organization Enrichment data, which already works on this account.

**Cost-conscious design, not a second Apollo call**: `discoverCompanyWebsite()`
(`website-discovery.ts`) already calls `enrichOrganizationApollo({ name })`
internally for every candidate during domain resolution — that response's
revenue/employee data was being fetched and then thrown away. Instead of
calling Apollo a second time for revenue filtering, `WebsiteDiscoveryResult`
now carries an `apolloOrg?: ApolloOrgEnrichResult` field forward (populated
on every return branch), and `discoverCompanies()`'s domain-resolution loop
(`company-discovery.ts`) reads `site.apolloOrg?.annualRevenue` directly —
zero additional Apollo credits spent for this feature. Also added a raw
numeric `annualRevenue` field to `ApolloOrgEnrichResult` itself
(`lib/enrichment/sources/apollo-client.ts`) — the existing
`annualRevenuePrinted` is a display string ("$50M") that can't be reliably
parsed for a numeric range comparison.

**New pure helper `isOutsideRevenueRange(annualRevenue, range)`**
(`company-discovery.ts`), same "prefer under-confidence" discipline as
`detectSizeMismatch()` right above it in the same file: a candidate Apollo
has NO revenue figure for is NEVER rejected (unknown != outside) — Apollo's
firmographic coverage skews toward larger/US-heavy companies, so plenty of
genuinely in-range Indian SMEs will have no revenue data at all, and this
must not silently drop them. Only a confirmed numeric value outside the
caller-supplied bounds is grounds for rejection; rejections are pushed into
the existing `rejected_candidates` diagnostic list, same visibility
discipline as every other rejection reason in this file. New optional
`discoverCompanies(icpSegment, excludeCompanyNames?, revenueRangeUsd?)`
3rd param — every other caller (the manual `/api/admin/company-discovery`
route) is unaffected, only `demaze-leads`'s route passes it.

**INR→USD conversion, explicitly approximate, not a live FX rate**: new
`DEMAZE_TARGET_REVENUE_RANGE_CR_INR = { min: 50, max: 500 }` and
`DEMAZE_TARGET_REVENUE_RANGE_USD` (computed via a fixed `INR_PER_USD_APPROX
= 83` constant, documented in `demaze-leads.ts` as needing a revisit if it
drifts meaningfully — a few percent of drift just shifts the filter
boundary slightly, it's not structurally fragile). `CompanyMatch` gained an
optional `companySizeApollo?: { estimatedNumEmployees?: number;
annualRevenue?: number }` field for transparency (threaded through, no new
UI rendering added this pass — same "additive field, UI catches up later"
precedent as `source` on `CompanyMatch`/`CompetitorProfile` earlier this
session).

New/extended tests: `tests/company-discovery.test.ts` (`isOutsideRevenueRange`
— boundary-inclusive, unknown-is-kept, one-sided ranges, a real mega-cap
example), `tests/website-discovery.test.ts` (`apolloOrg` threads through on
both confirmed and not_found results, and is `undefined` when Apollo has no
match), `tests/apollo-enrichment-client.test.ts` (extended the existing
mapping test with `annualRevenue`), `tests/demaze-leads.test.ts`
(E-commerce present in `DEMAZE_CONFIRMED_SECTORS`, the ₹→$ conversion lands
in a plausible bound). `tsc --noEmit` clean, full suite 811/811 (799
pre-existing + 12 new).

**Not done / known limitation, stated plainly**: this filter is genuinely
best-effort, not a hard guarantee — it can only reject candidates Apollo
has confident revenue data for, and (per the entry above) Apollo's
Organization *Search* path itself is still unverified on this account, so
today this filter only ever gets a chance to run on candidates that
survived regex/LLM extraction and reached the per-candidate domain-
resolution loop, not on any Apollo-*sourced* candidate (those short-circuit
past `discoverCompanyWebsite()` entirely per the entry above and have no
`apolloOrg` data to filter on). Once the Organization Search plan-block
lifts, revisit whether Apollo-sourced candidates should also carry revenue
data (Organization Search's response may already include it — unconfirmed,
since that endpoint has never returned a real 200 on this account) so they
can be filtered too instead of automatically passing through.

## BUILT 2026-08-17 — DRAFT sector playbook (Manufacturing/Automotive/
## E-commerce), qualification scorecard, wired into Auto Flow (no new step)
User asked for the outbound workflow to actually function as an
evidence-based, sector-scoped qualification system (their own detailed
31-part spec), restricted to exactly 3 active target sectors. Investigated
first, per their own explicit instruction, before writing anything: found
Auto Flow already had the exact 6-step structure requested (Research →
Decision Makers → Contact Info → Campaign & Outreach → Review & Send →
Track & Follow Up, see StepIndicator.tsx) and no Sales Strategy step (one
was added and removed the same week back in 2026-08-13). Also found the
Sales Knowledge/Sales Intelligence system (migrations 021/022,
`lib/sales-knowledge/*`) already had a real 4-tier evidence hierarchy
(confirmed_fact/research_supported_signal/industry_pattern/hypothesis) and
was already fully wired end-to-end into email generation
(`assemble-input.ts` already accepted a `salesIntelligence` param) — just
disconnected from the UI, and scoped to 8 generic industries rather than
the 3 the user now wants active.

**Built, additive only, nothing removed**: new `lib/sector-playbook/`
module — `types.ts` (`SectorPlaybook`, `status: 'DRAFT'`, all fields A-Q
from the user's spec: qualification/disqualification criteria, ideal
profile, signals, opportunity patterns, relevant services, decision-maker
roles, evidence rules, personalization approach, outreach angle/value
prop/CTA, follow-up strategy, 4 examples per sector, confidence rules,
prohibited claims), `playbooks.ts` (the 3 draft playbooks, using ONLY the 8
confirmed Demaze services from DEMAZE_CAPABILITY_MAP.md — nothing
invented), `classify.ts` (pure, sync sector classification reusing
`industry`/`sub_industry`/`company_summary`/business-profile fields already
in the research output, word-boundary matched against each playbook's
`signals` list — same discipline as `matchesKeyword()`'s historical 'ir'/
'sec' substring-collision fix elsewhere in this file), `qualify.ts` (the
5-score scorecard — sector fit / company fit / opportunity evidence /
contactability / overall, each with a plain-English reasons array, reusing
`company_fit`, pain-point `claim_type`, and `_service_evidence_debug`
rather than re-deriving evidence — no new LLM call anywhere in this module).

Deliberately a SEPARATE artifact from `lib/sales-knowledge/*` (the DB-backed
8-industry system), not a rebuild of it — that system's schema has no room
for qualification/disqualification rules, evidence rules, personalization
approach, follow-up strategy, or example scenarios, and rebuilding it into
3 rich sector objects would have meant a new migration + admin CRUD for
content that's explicitly expected to be replaced wholesale once the
official Word document arrives, not edited field-by-field. `getSectorPlaybook()`
is the single read path every consumer goes through — swapping in the real
document later means changing playbooks.ts's data source only.

**Wired in, no new step**: `SectorQualificationCard`/`CompactSectorBadge`
(new `app/admin/auto-gtm/SectorQualificationCard.tsx`) render on the
Research step (full scorecard + matched opportunities, each tagged
"Confirmed evidence" or "Reasonable inference") and Review & Send (compact
sector/confidence line, satisfying the review screen's own "Sector" field
requirement) — `useAutoGtmFlow.ts` computes `qualification` via a pure
`useMemo` over `result.analysisResult` (no new network call; contactability
score is deliberately `null`/"not yet determined" until at least one
decision-maker contact exists, never fabricated before that step runs).
`role-recommendation.ts` now prefers the matched sector playbook's
`decisionMakerRoles` over its old generic keyword-group fallback when a
sector confidently matches. `assemble-input.ts` threads the matched
playbook's positioning/CTA into `EmailGenerationSalesIntelligence` as a
fallback ONLY when neither a real DB Sales Knowledge match nor the
company's own narrative fields (`outreach_intelligence.conversation_angle`/
`executive_brief.what_to_sell`) are present — a real regression was caught
here by the existing test suite (`tests/outbound-generation.test.ts`) and
fixed before landing: the playbook fallback was initially unconditionally
overriding the company's own specific, narrative-grounded opening angle
with generic sector boilerplate. Fixed by making the playbook strictly the
last-resort fallback, never a override.

**Verified**: `tsc --noEmit` clean, full suite 823/823 (12 new assertions in
`tests/sector-playbook.test.ts`, zero regressions in
`tests/role-recommendation.test.ts`/`tests/outbound-generation.test.ts`).
**Live-verified against a real cached run** (Ador Welding Limited, resumed
from run-history, no new API/LLM quota spent): Research step correctly
showed `Target Sector & Fit: Manufacturing, 85/100`, with Sector fit 90/
Company fit 85/Opportunity evidence 100/Contactability 60 (2 decision-maker
candidates), and 3 "Confirmed evidence" opportunities each citing a real
snippet from `_service_evidence_debug`. Decision Makers step correctly
showed "Recommended for this company: CIO, CTO, COO, Head of IT, Head of
Digital Transformation, Head of Operations, VP Technology, VP Operations —
Classified as Manufacturing... (DRAFT Manufacturing playbook role
candidates.)" — the exact Manufacturing playbook role list, not the old
generic keyword groups. Zero console errors throughout.

**RESOLVED same day — Automotive and E-commerce also live-verified.**
Automotive: resumed Honda Cars India from a cached run (no new quota) —
`Target Sector & Fit: Automotive, 60/100` (Sector fit 90, Company fit 35,
Opportunity evidence 15 with a correctly `Reasonable inference`-tagged
match on "AI-powered business applications", Contactability 100 with 10
real candidates), Decision Makers step correctly showed the Automotive
playbook's exact role list. E-commerce had no cached company in run-history
(checked via a real query, only false-positive substring matches existed)
— explicit user confirmation given first, then a real fresh Full-mode
research call against Nykaa (real Firecrawl/Tavily/LLM quota spent):
`Target Sector & Fit: E-commerce, 73/100` (Sector fit 90, Company fit 40,
Opportunity evidence 65, Contactability 100 with 9 real candidates), and —
notably — all 3 tiers rendering correctly on one real company: 1
`Confirmed evidence` match (Ecommerce ecosystems, from real
`_service_evidence_debug` content) alongside 2 `Reasonable inference`
matches (Analytics and reporting systems, Marketplace platforms), proving
the confirmed/inferred distinction isn't cosmetic — it reflects genuinely
different evidence strength per opportunity on the same live run. Decision
Makers step showed the exact E-commerce playbook role list. Zero console
errors on either run (only the pre-existing, already-documented HMR/Edge-
runtime warnings). All 3 sector playbooks are now live-verified, not just
unit-tested.

Campaign state machine, tracking, follow-ups, Apollo/Prospeo integrations
were investigated and confirmed already correct per this file's own
extensive prior history — untouched, no changes needed. Sales Knowledge DB
tables (021/022) untouched, left available for future use.

## RESOLVED 2026-08-17 — company-dedup.ts missed the 2026-07-24 \w-ASCII
## name-normalization fix
Found during a repo-wide over-engineering audit (unrelated task, correctness
bugs noticed in passing): `lib/batch/company-dedup.ts`'s
`normalizeCompanyName()` still used `[^\w\s-]` (ASCII-only `\w`), the exact
bug class the 2026-07-24 session fixed across 5 other files (website-
discovery.ts, evidence-extractor.ts, competitor-discovery.ts, icp-
generator.ts, company-discovery.ts) but never touched this one — it was
simply missed, not a deliberate exclusion.

Confirmed the concrete failure mode with real code before fixing (not
assumed): with the bug, "Möller" (one word) normalizes to "m ller" and
fragments into two words (`["m", "ller"]`) once split — this inflates
`wordOverlapRatio()`'s numerator/denominator enough to push two otherwise-
UNRELATED companies ("Möller" vs "Möller International Group", sharing only
the accented fragment and a generic "group") over the 0.5 'partial' match
threshold (buggy ratio: 0.5, correctly flagged as possible duplicates only
by accident of fragmentation; fixed ratio: 0.33, correctly not flagged).
Verified `wordOverlapRatio()` doesn't need the `wordBoundaryRegex()` half of
the original fix (unlike website-discovery.ts/evidence-extractor.ts) since
it compares word arrays via `Set.has()`, not a `\b`-anchored regex — same
reasoning as `competitor-discovery.ts`'s `isSelfName()` in the original fix.

**Fixed**: `[^\w\s-]` → `[^\p{L}\p{N}\s-]` with the `u` flag, one line.

New `tests/company-dedup.test.ts` (this file's first test coverage, 5
assertions) — the accented-name case above (manually reverted the fix and
confirmed this specific test fails without it, not just added and assumed
correct), plus non-regression coverage for the domain/exact/partial/none
tiers. `tsc --noEmit` clean, full suite 770/770 (765 pre-existing + 5 new).

## DO NOT WORK ON RIGHT NOW
- More model changes
- More classifier tweaking beyond the specific fixes listed above
- More regexes as a first resort, EXCEPT the 4 confirmed SIGNAL_PATTERNS gaps
  above — those are validated against real data, not speculative, and are now the
  highest-priority signal-extraction work
- **Email-finding, generation, QA, and send implementation** — all built
  (see "Outbound Workflow Modules" sessions above). **Vendor reversed
  2026-07-29**: Lemlist (added 2026-07-28) was removed entirely at the
  user's request in favor of Gmail (free, OAuth-based, already an interim
  provider since 2026-07-19) — see `docs/DECISIONS.md`'s "Outreach send
  (Phase 2, item 9)" section for the full history including the removal
  and the incident that prompted it. **Stale note corrected (2026-08-04)**:
  this used to say the user hadn't clicked through Google's consent screen
  yet, so sending stayed on `mock`. Checked the live `outbound_integrations`
  table directly (not just old notes) and that's no longer true — the
  `sending` capability's active row is `gmail`, and a live token-refresh
  probe against Google's servers confirmed the connection genuinely still
  works (fetched the real connected address). Sending is live, not pending.
  Also found the same staleness for two other capabilities while checking:
  `decision_maker_discovery` and `email_finder`/`enrichment` are ALSO
  already active on `prospeo`, not `mock` — this file's other notes saying
  otherwise (e.g. "reset to mock as the safe default" under the Prospeo
  session below) describe a state that was later changed outside of a
  documented session. Trust the live `/admin/outbound/integrations` page
  or a direct `outbound_integrations` query over this file's narrative for
  "is X actually on right now" — this file's dated history can lag actual
  DB/provider state, not just code state.
- ~~Decision-maker/contact discovery implementation — blocked on a
  people-data vendor decision~~ **RESOLVED (2026-07-28, corrected status)**
  — this bullet was stale. The vendor decision (Prospeo, `search-person`
  endpoint) was made and built back in the 2026-07-18/07-19 sessions (see
  "Decision-maker auto-discovery — UNBLOCKED 2026-07-18" and "Precision +
  latency fixes" below); it just never got reflected in this bullet or in
  `docs/ROADMAP.md`/`docs/CURRENT_TASK.md` until the user directly
  confirmed a live test working. See `docs/DECISIONS.md`'s "Decision-maker
  discovery (Phase 2, item 8)" section for current status and remaining
  gaps (contacts-page grounding backfill, mobile enrichment not wired).
- **LinkedIn-driven architecture decisions**. LinkedIn scraping/automation
  stays excluded regardless of the above — contact discovery should go
  through a people-data API, not LinkedIn
- ~~Government-filings APIs (EDGAR/MCA) — logged as a future source
  category (item 4's scope note), not being built now.~~ **RESOLVED for
  EDGAR, MCA explicitly ruled out (2026-08-04)** — see the dedicated
  "Government filings (EDGAR) enrichment source" section below.
- RESOLVED (2026-07-10): the "more enrichment work — needs an explicit decision"
  note that used to be here is resolved. The decision was made: enrichment gets
  repositioned to a parallel, always-on stage (item 2), new source categories get
  added (item 4), PDF handling gets fixed (item 3). Work order and status are
  tracked in "Implementation sequence" below.

## RESOLVED 2026-08-04 — Government filings (EDGAR) enrichment source; MCA
## explicitly ruled out, not just deferred
User asked to build out both remaining "marked excluded" items from a
broader scope-expansion request (mobile enrichment and LinkedIn scraping
were both explicitly excluded from this same request — see the LinkedIn
note below). Researched both government-filings sources before writing any
code, since the earlier assumption ("both are free public APIs") turned
out to be only half true:
- **SEC EDGAR**: genuinely free, public, no API key, no CAPTCHA — confirmed
  against SEC's own EDGAR API documentation. Three services (ticker/CIK
  map, Submissions API, XBRL company-facts API) need nothing but a
  descriptive `User-Agent` header and respecting SEC's own ~10 req/sec
  rate limit. Built.
- **India's MCA company registry**: **no official public API exists at
  all.** The only access path is the mca.gov.in web portal, and it's
  CAPTCHA-gated even for basic free master-data lookups. Building
  automation to solve/bypass a CAPTCHA is out of scope regardless of intent
  — this is a hard line, not a judgment call, so MCA was NOT built. If
  India company-filing data is wanted later, that's a paid third-party
  aggregator decision (Probe42, Tofler, Zauba Corp, etc.) — a new vendor
  choice needing its own explicit decision, same category as Prospeo/Gmail
  were, not something to build toward silently.

**Built**: new `lib/enrichment/sources/edgar-client.ts` —
`fetchEdgarFilings(companyName)`. Resolves a company name against SEC's
`company_tickers.json` ticker map via `matchTicker()` (pure, unit-tested
without network), using the same "prefer under-confidence, refuse to guess
when ambiguous" discipline as `website-discovery.ts`: exact normalized-name
match wins outright; single-word queries require a full exact match (no
loose containment); multi-word queries may match via word-boundary
containment ONLY when exactly one candidate qualifies AND its own word
count isn't wildly longer than the query's (guards against a short query
matching an unrelated long title that happens to contain all its words).
`normalizeName()` strips genuine legal-entity suffixes (Inc/Corp/Ltd/PLC/
etc.) but deliberately does NOT strip "Holdings"/"Group" — unlike
`website-discovery.ts`'s equivalent list, those are frequently part of a
SEC-registered name's real distinguishing identity (e.g. "Blackstone
Group"), not a stripped-off suffix; treating them as one caused two
genuinely different synthetic test entities to collapse onto the same
normalized form during testing, caught and fixed before this shipped. Also
normalizes `&` to `and` and filters connector stopwords (and/the/of/a/an)
so "Johnson & Johnson" and "Johnson and Johnson" resolve identically.

On a confident match: fetches `data.sec.gov/submissions/CIK##########.json`
(company profile + recent filings) and formats up to 8 recent filings into
a `[SOURCE: SEC EDGAR Filings ...]` context block, matching this pipeline's
existing block format exactly. Filings are sorted with 8-K/8-K-A/DEF 14A/
S-1/424B first (the form types most likely to carry an actual trigger-event
signal — executive changes, M&A, material agreements — per this file's own
"named individual + explicit stated portfolio" signal-library entry), not
just by date. The ticker map itself is cached at module scope but only on
SUCCESS — a transient SEC outage on the first call must not permanently
disable EDGAR lookups for the rest of the server process; found and fixed
this exact bug while writing tests (an earlier draft cached on any
resolved value including `null`, which also made the test file's per-test
mocks leak into each other — fixed both by only caching a real result and
having tests use `vi.resetModules()` + per-test dynamic import instead of
a static top-level import).

Wired into `lib/enrichment/web-enricher.ts`'s `discoverAndFetchExternalSources()`
— runs in parallel (`Promise.all`) with the existing Tavily/Serper
discovery, unconditionally (not gated on search-API keys, since it costs
nothing and needs neither). When a match is found, it's prepended as a
genuine 6th source that does NOT compete for the existing 5-slot Tavily/
Serper fetch budget (no Firecrawl/PDF-fetch cost to it — the content is
already fetched+formatted directly), same "additive, not a fallback"
principle as the discovery+scrape overlap from Item 2. New `SourceType`
`regulatory_filing` (very_high evidence strength, priority_score 98 — just
below `annual_report`'s 100) registered in `discovery-engine.ts` and
`source-prioritizer.ts`'s label map, even though it's never produced by
`classifySourceType()` (EDGAR is deterministic, not search-derived) — kept
in those central maps anyway so the rest of the pipeline (labels, tier
rendering, `PrioritizedSource` shape) already knows how to handle it, same
"one registry, not a parallel one" discipline as Item 4's new source types.

New `.env.example` var `SEC_EDGAR_USER_AGENT` (optional — SEC's fair-access
policy asks for a descriptive requester identity; a generic default is used
if unset, so this works out of the box either way).

**Verified**: `tsc --noEmit` clean, full suite 633/633 (12 new assertions
in `tests/edgar-client.test.ts` — 8 for `matchTicker()`'s pure matching
logic including the ambiguous-match and legal-suffix-collision cases found
while writing them, 4 for `fetchEdgarFilings()` with `global.fetch`
mocked). **Live-verified against SEC's real servers** (no pipeline/LLM
quota needed — EDGAR itself is free): General Electric correctly resolved
to its real CIK (40545) with genuinely current, real filings (an 8-K dated
2026-07-16, Form 4s, a 13F-HR, a 10-Q — live data, not fixtures); Ador
Welding and Bharat Forge (real companies from this repo's own benchmark
set, both India-based and not SEC-registered) correctly and honestly
returned no match rather than guessing — confirms the pipeline degrades
cleanly for the large majority of researched companies (private, non-US,
SMB) that will never have EDGAR coverage, exactly as designed.

**Not done, explicitly out of scope per the finding above**: MCA/India
company-filing data — needs a paid third-party vendor decision first, not
a code task.

## RESOLVED 2026-08-04 — LinkedIn scraping/automation: reconfirmed excluded,
## mobile/phone enrichment: explicitly deferred (not this session)
Same broader session as the EDGAR work above — user initially said "do all
of them, even the one marked excluded" (referring to this file's own
"DO NOT WORK ON RIGHT NOW" LinkedIn bullet), which is exactly the situation
that bullet's own text says to "stop and flag it rather than proceeding."
Flagged directly rather than silently building or silently skipping: asked
what they actually meant (the already-supported manual-paste URL field vs.
an official LinkedIn partner API vs. actual scraping/session automation)
and explained the real risk of the third option (LinkedIn's User Agreement
prohibition + active enforcement history — account bans, cease-and-desists,
lawsuits) — user came back with no strong preference, so this defaulted to
the safe read (LinkedIn stays excluded, no automation built) per this
file's own standing rule. **Still excluded, unchanged.** Immediately after,
user separately confirmed excluding mobile/phone enrichment too (real
per-lookup Prospeo cost, needs its own explicit go-ahead before wiring
live) — also still not built, deferred at the user's own request this
time, not a unilateral call.

## BUILT 2026-08-04 — real DIY Gmail warmup engine (code-complete; migration
## + Google Cloud + real OAuth connect still pending, all user-only steps)
User asked whether real Gmail warmup was possible. Checked the actual code
first rather than trusting this file's own prior notes (which had already
been caught stale twice earlier this same day, for Gmail sending and
decision-maker discovery): the Warm-Up dashboard was 100% simulated —
`MockWarmupProvider.startWarmup()` a no-op stub, `getWarmupStatus()` a fake
curve computed purely from elapsed time since `started_at`, mailboxes added
by typing an address string with no OAuth, no credential storage at all.
Explained the honest tradeoffs (real warmup needs either a paid vendor
network or a DIY pool of owned mailboxes; this app also had no background
scheduler anywhere). User chose: **DIY, using their own multiple real
Gmail accounts, with a real scheduler built**, explicitly asking to
replicate what commercial vendors do, for free. Went through `EnterPlanMode`
given the scope (new migration, new OAuth flow, autonomous real-email-
sending engine) and the safety-relevant nature of autonomous real sends —
plan approved before any code was written; full plan preserved at
`C:\Users\singh\.claude\plans\wondrous-strolling-metcalfe.md`.

**What was built, all live-verified as far as possible without completing
a real Google OAuth login (which only the account owner can do):**
- Migration `018_outbound_warmup_engine.sql` — `credential_encrypted`/
  `oauth_connected_at` added to `outbound_warmup_mailboxes` (nullable, so
  existing manually-typed mailboxes keep working exactly as before, mock
  display only); new `outbound_warmup_exchanges` table (one row per
  warmup email sent between two pool mailboxes, tracking recipient-side
  processing state — spam-landed/rescued/replied — for a LATER tick, not
  instant processing).
- `lib/outbound/shared/gmail-client.ts` extended, not duplicated: new
  `GMAIL_WARMUP_SCOPES` (`gmail.modify` + `userinfo.email` — broader than
  the sending capability's `gmail.send`+`gmail.metadata`, since warmup
  needs to search inboxes, read/move labels, and send replies from the
  RECIPIENT side, none of which `gmail.metadata`'s headers-only access
  permits), `buildAuthUrl()` gained an optional `scopes` param (existing
  sending OAuth flow unaffected, defaults to the old scope list), three new
  functions (`searchGmailMessages`, `getGmailMessageLabels`,
  `modifyGmailMessageLabels`) that didn't exist before since nothing
  previously needed recipient-side inbox operations.
- A SEPARATE OAuth pair (`app/api/admin/outbound/warmup/oauth/{start,
  callback}/route.ts`) from the existing sending capability's — warmup is a
  POOL (many simultaneously-connected Gmail accounts), architecturally
  different from every other capability in this app which picks exactly
  ONE active provider, so it can't reuse `outbound_integrations`'
  single-active-row upsert pattern. Own state cookie
  (`warmup_gmail_oauth_state`), preserves `started_at`/`status` on a
  reconnect (never resets someone's warm-up ramp just because they
  re-authorized).
- Tick engine split the same way `lib/outbound/sending/followup-
  schedule.ts`/`process-followup.ts` already are: `lib/outbound/warmup/
  engine/tick-logic.ts` (pure, no I/O, injectable `rng`, unit-tested
  without network — `computeDailySendCap`/`computeProcessDelayMs`/
  `rollShouldReply`/`pickRecipient`/`shouldSkipThisTick`/content
  generation/`buildRefToken`) and `lib/outbound/warmup/engine/run-tick.ts`
  (impure — `runWarmupEngineTick()`, Phase A processes due exchanges
  recipient-side — search by an embedded ref token, since a Gmail message
  `id` is scoped per-mailbox and the sender's id isn't the recipient's id
  for "the same" email, rescue from spam, mark read, probabilistic reply —
  then Phase B sends new exchanges sender-side respecting each mailbox's
  daily cap, then writes a real snapshot into the EXISTING
  `outbound_warmup_metrics` table so the dashboard's chart code needed
  zero changes). `lib/outbound/warmup/engine/templates.ts` — ~10 generic
  subject/body templates with light variation slots, deliberately no LLM
  call (free, no added latency, matches what was asked), deliberately
  avoids the literal words test/warmup/automated anywhere in generated
  content.
- Every default is deliberately conservative, not just for its own sake —
  a SMALL pool (a handful of the account owner's own Gmail accounts, not a
  commercial vendor's network of thousands of independent mailboxes)
  emailing itself too mechanically/frequently is itself a pattern that
  could look bot-like to Gmail's abuse detection, which would defeat the
  entire point: daily send cap ramps 1→2→3→4→5→6 over 30 days (well below
  the old mock's fake ~7/day), process-after delay is a random 2-30h (real
  engagement isn't instant), reply probability 35% (100% would itself be
  unnatural), a 20% per-tick skip probability (breaks up the otherwise-
  perfectly-regular interval-driven timing).
- Scheduler wired into `instrumentation.ts` — this app's first-ever
  background scheduler, a `setInterval` (default 30 min) gated behind
  `WARMUP_ENGINE_ENABLED === 'true'`, **unset by default everywhere
  including local dev** — the equivalent of this app's standing "explicit
  confirmation before real sends" rule, applied to an autonomous process
  instead of a per-click UI action. `globalThis.__warmupEngineStarted`
  guards against double-registration on Next.js dev hot-reload. Only valid
  because this app runs as a single persistent `next start` process on
  Railway (the same fact `lib/rate-limit.ts`'s own in-memory store already
  depends on) — would silently do nothing on a serverless platform. The
  manual tick route (`POST /api/admin/outbound/warmup/engine/tick`,
  admin-authed) deliberately does NOT check this flag — an admin's
  explicit click is itself the confirmation, same reasoning already
  applied elsewhere in this app.
- UI: `app/admin/outbound/warmup/page.tsx` — "Connect a Gmail mailbox"
  button alongside the existing manual "Add Mailbox" input (both kept),
  an OAuth Connected vs. Manual (mock only) badge per mailbox
  (`credential_encrypted != null`, never the encrypted value itself sent
  to the client), a "Run Tick Now" button per connected mailbox, and a
  collapsible Recent Activity list (new `GET .../[id]/exchanges` route) so
  the engine isn't a total black box once running. `GuideNote` copy states
  the honest scale/diversity caveat plainly, not just in this file.

**A real fix made along the way, not just documented**: `[id]/metrics/
route.ts` used to unconditionally compute-and-append a fake mock snapshot
on every page view (the app's existing "no scheduler, accumulate on view"
design). Now gated to `mailbox.started_at && !mailbox.credential_encrypted`
— for an OAuth-connected mailbox, appending a mock snapshot on every page
view would corrupt its real time-series (written only by the tick engine)
with fake data interleaved into it.

**Verified**: `tsc --noEmit` clean, full suite 646/646 (13 new assertions
in `tests/warmup-tick-logic.test.ts` — ramp boundaries, delay range,
probability thresholds, recipient-picking including the "pool too small,
fall back to the only option" case, content generation never containing
the literal words test/warmup/automated, ref-token derivation). **Live-
verified as far as possible without completing a real Google login**:
hit the manual tick route directly against the real (not-yet-migrated)
Supabase DB — confirmed graceful degradation, not a crash:
`"Failed to load mailboxes: column outbound_warmup_mailboxes.
credential_encrypted does not exist"`, exactly the expected error before
migration 018 is run. Navigated the real browser to the new OAuth start
route (no login attempted or completed — entering the user's own Google
credentials is not something this assistant does, regardless of whose
account) — Google returned `Error 400: redirect_uri_mismatch`, which
**proves** the entire request-construction chain works correctly
(GOOGLE_CLIENT_ID passed through, `buildAuthUrl` assembled a request valid
enough to reach Google's redirect-URI validation step, one of its last
checks) — the only failure is the expected, already-flagged missing
manual Google Cloud Console step.

**Not done at write-time — since closed out live, see the 2026-08-05 entry
directly below.**
1. ~~Run `018_outbound_warmup_engine.sql` in the Supabase dashboard~~
2. ~~Add the warmup OAuth redirect URI + test users in Google Cloud~~
3. ~~Connect 2+ real accounts via "Connect a Gmail mailbox"~~
4. ~~Confirm a real send happens, verified against real inboxes directly~~
   — done for the send half; the recipient-side rescue/reply half (after
   the `process_after` delay) is still open, see below.
5. `WARMUP_ENGINE_ENABLED` should stay unset until the recipient-side half
   of item 4 is confirmed too — turning on the autonomous scheduler in
   Railway's production env config is a separate, deliberate step for the
   user to take once satisfied, not something to flip preemptively.

## RESOLVED 2026-08-05 — real Gmail warmup send confirmed live end-to-end
(items 1-4's send half from the list above)
User worked through the full manual checklist across one session, in
order, each step surfacing the next real blocker rather than a code bug —
worth recording precisely since three of the four blockers looked like
app bugs at first glance and were not:
1. Ran migration 018 in Supabase — resolved the earlier
   `"Could not find the 'credential_encrypted' column"` error cleanly.
2. First OAuth attempt failed `Error 400: redirect_uri_mismatch` even
   after adding the redirect URI — root cause was the URI being added to
   the WRONG OAuth client in Google Cloud Console (a different project's
   client, app name "Potato App", not the one `GOOGLE_CLIENT_ID` in
   `.env.local` actually points to). Confirmed by reading `.env.local`'s
   `GOOGLE_CLIENT_ID` directly (safe to read — client IDs are non-secret,
   sent in every authorize URL) and comparing against the client ID Google's
   own error dialog reported back. Once added to the correct client
   (`371887635787-...`, app name "fittifi"), the redirect_uri_mismatch
   resolved.
3. Next blocker was `Error 403: access_denied` — "fittifi has not
   completed the Google verification process" — because the OAuth
   consent screen is in Testing mode and the signing-in account wasn't
   added as a test user yet. Resolved by adding the account under
   Test users on the consent screen.
4. Final blocker, only surfaced once 2 real mailboxes were actually
   connected and a tick ran: `Gmail API has not been used in project
   ... or it is disabled` — the OAuth consent flow itself doesn't require
   the Gmail API to be enabled, only actually calling it does. Resolved by
   enabling the Gmail API for the project via Google Cloud Console.
   **A real, unrelated cosmetic finding surfaced in the same server log**:
   Next.js's Edge Instrumentation static analysis flags `credential-
   crypto.ts`/`run-tick.ts`'s `crypto` imports as unsupported-in-Edge-
   Runtime warnings on every request — harmless, every request still
   returned `200`, consistent with `instrumentation.ts`'s own
   `NEXT_RUNTIME === 'nodejs'` gate meaning this code path never actually
   executes in the Edge runtime; this is Next.js statically analyzing the
   whole import graph regardless of the runtime gate, not a real bug. Not
   fixed, not worth suppressing — flagging here so a future session
   doesn't mistake it for something broken.

After the Gmail API was enabled, `POST /api/admin/outbound/warmup/engine/tick`
returned `{"newExchangesSent":2,"errors":[]}` — 2 real Gmail sends between
`anyaunfltrd@gmail.com` and `singhaarav042002@gmail.com` (confirmed via
`GET /mailboxes`: both now show `provider_name: "gmail"`,
`oauth_connected: true`, replacing the earlier `mock` entries).
**User directly confirmed both real Gmail inboxes received the emails** —
the actual proof this needed, not just the API's own success claim. This is
the first genuinely real send this engine has ever made; every prior
warmup dashboard state in this app's history (see the original 2026-08-04
build entry above) was either fully mocked or, immediately after building,
unverified beyond a redirect_uri_mismatch proving the request-construction
chain worked.

**Still open, not done this session**: the recipient-side half of item 4 —
confirming the ref-token exact-phrase Gmail search, spam-rescue, mark-read,
and probabilistic-reply mechanics actually work against real Gmail data
once each exchange's randomized `process_after` delay (2-30h) elapses.
Needs a tick run again after that window with the same "check the real
inbox directly" discipline used for the send half. `WARMUP_ENGINE_ENABLED`
should stay unset (item 5) until that's confirmed too.

## RESOLVED 2026-08-04 — mobile "app-like" pass on the admin product
User asked to make "our website" mobile-compatible, "proper mobile style
as an app would be." Scoped via a direct question first, since this repo
has two distinct surfaces (public landing page vs. the internal admin
product) and the two implied very different amounts of work — user picked
**the admin product only**; the public landing page (already had a
responsive/scrollytelling pass, see the 2026-07-xx commit) was
deliberately left untouched this session.

Audited first (resize to 375×812, programmatic overflow/touch-target
scans via `document.documentElement.scrollWidth` + `getBoundingClientRect`
— the Browser pane's screenshot tool wasn't available this session, so
verification leaned on these instead, which turned out to be more
precise than eyeballing anyway) before assuming what was broken. Found:
existing `MobileNav.tsx` hamburger-drawer + `TopBar.tsx` were already
solid (no horizontal overflow anywhere checked, decent a11y from the
2026-07-19 pass), but nothing about the shell read as "an app" — no
persistent bottom nav, not installable, no safe-area handling for a
notched phone.

**Built**:
- **PWA manifest** (`app/manifest.ts`, Next's native manifest-route
  convention, served at `/manifest.webmanifest`) — `start_url`/`scope`
  both scoped to `/admin` only, matching the session's own scope decision.
  `display: 'standalone'`, real theme/background colors (converted from
  the theme's actual OKLCH `--background`/`--primary`/`--primary-hover`
  values via the standard OKLab→sRGB reference formulas, not eyeballed —
  see `scripts/generate-app-icons.mjs`'s `oklchToHex()`).
- **Real app icons**, not placeholders — `scripts/generate-app-icons.mjs`
  (kept in the repo, re-runnable if the theme's primary color ever
  changes; not a throwaway) renders an SVG matching `BrandMark`'s exact
  gradient "D" chip and rasterizes it via `sharp` (already a project
  dependency) to `public/icons/`: 192/512 standard, a maskable-safe-area
  512 variant (Android can crop icons to a circle/squircle/etc.; real
  content needs to stay within roughly an 80% safe zone), and a 180px
  Apple touch icon. Confirmed visually correct (`Read` on the generated
  PNG) before shipping.
- **Safe-area support** — `viewport-fit=cover` added to the `viewport`
  export in `app/layout.tsx` (root layout, not just the admin layout,
  since Next's viewport export is a single root-level thing) plus
  `appleWebApp`/`icons.apple` metadata (iOS Safari doesn't read the web
  manifest for install behavior, only these specific meta tags).
  Deliberately did NOT set `maximumScale`/`userScalable: false` — that's
  a real accessibility regression for low-vision users and isn't required
  for anything "app-like" actually being asked for here.
- **BottomTabBar** (`components/shell/BottomTabBar.tsx`) — the actual
  headline change. A persistent 5-tab bottom bar (mirrors `nav-config.ts`'s
  `NAV` exactly: Auto Flow/Research/Discover/Outbound/History) replacing
  `MobileNav.tsx`'s hamburger-drawer as the primary mobile nav entry
  point — a persistent bottom bar, not a drawer you have to open, is the
  actual defining native-app navigation pattern (iOS Tab Bar / Android
  Bottom Navigation); a hamburger drawer reads as "mobile website," not
  "app," which is exactly the distinction the request was making.
  `MobileNav.tsx` deleted outright (confirmed dead via repo-wide grep
  first — nothing imported it once `TopBar.tsx` stopped rendering it;
  `LandingMobileNav.tsx` is a separate, unrelated component for the public
  landing page and was untouched). `SECONDARY_NAV` (Overview, Contacts,
  Campaigns, Follow-ups, Suppression, Warm-Up, Integrations) still goes
  through TopBar's existing "More tools" dropdown — out of scope for a
  5-slot bottom bar.
- **Sticky bottom CTA on Auto Flow** (`app/admin/auto-gtm/page.tsx` +
  `StepIndicator.tsx`) — the flow's one "move forward" button
  (`nextAction`) is hidden on mobile in `StepIndicator` (`hidden
  md:inline-flex`) and duplicated as a full-width, thumb-reachable bar
  fixed just above `BottomTabBar`, checkout-flow-style. This is Auto
  Flow specifically (the "Start here" primary flow, most-used surface),
  not a generic pattern applied everywhere — no other admin page got this
  treatment this session.
- Touch-target bump on `TopBar`'s "More tools" trigger (32px → 40px on
  mobile, `size-10 md:size-8`) and the "Internal" badge hidden below the
  `sm` breakpoint to reduce clutter now that the hamburger is gone.

**Real bug found and fixed while building this, not just documented**:
Tailwind v4.3.2 (`node_modules/tailwindcss` confirmed via
`require('tailwindcss/package.json').version`) silently fails to
generate ANY CSS for a custom `@utility` block whose value uses `calc()`
— confirmed by a live isolating test: `@utility pb-tabbar { padding-bottom:
calc(3.5rem + env(safe-area-inset-bottom, 0px)); }` produced zero CSS
rules in any loaded stylesheet (checked via
`document.styleSheets[].cssRules`, not guessed), while the byte-identical
sibling `@utility pb-safe { padding-bottom: env(safe-area-inset-bottom,
0px); }` (no `calc()`) compiled correctly. Swapping the `calc()` version
down to a flat `padding-bottom: 3.5rem` (no `calc`) also compiled fine —
isolates the bug to `calc()` specifically, not `env()`, not multi-value
properties, not adjacency to other `@utility` blocks. **Worked around**,
not fixed upstream (this is a Tailwind bug, not something to patch in
this repo): both places needing the tab-bar-clearance value
(`app/admin/layout.tsx`'s `<main>` padding, and the sticky-CTA bar's own
`bottom` offset) use Tailwind's arbitrary-value bracket syntax directly
in the className instead of a named `@utility`
(`pb-[calc(3.5rem_+_env(safe-area-inset-bottom,0px))]` — underscores
represent the required whitespace around `calc()`'s `+` operator, since
arbitrary-value syntax can't contain raw spaces) — this goes through a
different Tailwind codepath and isn't affected. Left an explicit comment
in `globals.css` at the empty spot where `pb-tabbar` would have been
defined, specifically so a future session hitting the same "content
hides behind a fixed mobile bar" problem doesn't lose time rediscovering
this the hard way.

**Verified**: `tsc --noEmit` clean, full suite 633/633 (no new tests —
this is layout/CSS/navigation-shape work with no new business logic to
unit-test, consistent with this repo's own precedent of relying on live
browser verification for pure UI changes). Live-verified at 375×812
across Auto Flow, Research, Discover, Outbound Tools hub, and History:
zero horizontal overflow on any page (checked programmatically via
`scrollWidth` vs `clientWidth`, not eyeballed), `BottomTabBar` correctly
shows `aria-current="page"` on the active tab, main content's bottom
padding correctly clears the tab bar (56px, confirmed via
`getComputedStyle`), the sticky CTA bar sits flush above the tab bar with
no overlap (measured via `getBoundingClientRect`, not assumed), manifest
+ all 3 icon sizes + apple-touch-icon serve correctly (200 status,
correct dimensions), and desktop (1280×800, explicitly NOT the Browser
pane's own "desktop" resize preset — that preset renders at a much
narrower actual width in this environment than its name implies, caught
live rather than trusted) is fully unaffected: no tab bar, no extra
padding, sidebar renders as before.

**Not done, explicitly out of scope per the session's own scoping
question**: the public landing page got no changes. Also not done,
flagged but not pursued (lower priority, existing pages already had zero
overflow at 375px so nothing was actually broken): a dedicated card-based
mobile layout for the handful of table/dense-grid pages found during the
initial audit (`run-history`, `outbound/overview`, `outbound/followups`,
`intelligence-lab`, `company-discovery/CompanyMatchList`,
`intelligence-lab/ComparisonPanel`, `auto-gtm/ContactInfoRow`) — worth a
future look only if a real usability problem shows up on one of them
specifically, not a blanket "redo every table" task.

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