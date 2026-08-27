# Epitaxy vNext — Audit & Prioritized Architecture Plan

Produced per `Epitaxy_vNext_Architecture_Brief.md` §18. No code was changed to
produce this — it's grounded in (a) reading Epitaxy's actual current source,
including a substantial uncommitted in-flight change already sitting in the
working tree, and (b) five parallel research passes that fetched and read the
actual source of each reference repo (not their README claims).

**Scope note on LinkedIn:** `CLAUDE.md` permanently excludes LinkedIn
scraping/automation. The user explicitly lifted that exclusion **for this
initiative only** (not a standing policy change) so §E below could be
written in full. Treat §E's non-recommendation of browser-automation LinkedIn
access as the operative answer unless that specific sub-decision is revisited
separately.

---

## A. Executive verdict

**Epitaxy is already architecturally ahead of all five reference repos on
the dimension that matters most for outbound sales: evidence discipline.**
None of the five is a mature system — every one of them is a solo/hackathon-
or freelancer-funnel-tier project, several with materially unfinished or
unconfigured code shipped as if complete (details in §C/§D). Epitaxy's
gap is not "these systems do evidence better" — it's that Epitaxy is
**underbuilt on people/LinkedIn discovery breadth** and has, until a moment
ago, been carrying two real evidence-reliability bugs that are now fixed
(uncommitted, tested) sitting in the working tree.

The honest read of what "vNext" should mean: keep Epitaxy's core
evidence/opportunity architecture almost entirely as-is, land the
already-written Phase 0 fix, and spend real new-build effort narrowly on
people discovery — nothing else in the brief clears the bar for a rebuild.

---

## B. Top 10 improvements (ranked)

| # | Priority | Item | Why |
|---|----------|------|-----|
| 1 | **P0** | Commit and benchmark the uncommitted evidence-reliability work already in the working tree | See §L Phase 0 — it's done, tested, tsc-clean, and directly closes the brief's own P0 items. Sitting uncommitted is the single biggest current risk (lost work, drift). |
| 2 | **P1** | Add a public search-discovery path for LinkedIn profile URLs (`site:linkedin.com/in/ "Company" "Title"` via existing search provider) as a new decision-maker-discovery input, alongside Prospeo | Real gap: today, a person Epitaxy hasn't found via Prospeo or the company's own site is simply not found. This is the lowest-risk, ToS-clean way to close it. |
| 3 | **P1** | Wire `role-recommendation.ts`'s opportunity→role-category output directly into decision-maker search queries | The pieces exist (role categories, Prospeo search, website-grounding) but aren't yet chained end-to-end into "opportunity → relevant titles → search now." |
| 4 | **P1** | Add `published_at`/`retrieved_at` as optional fields on `ExtractedEvidence`, populated only when genuinely extractable (news/press metadata, dated filings) | Directly closes brief §3's dated P0/P1 evidence-dates gap. Additive only — no consumer breaks if the field is absent. |
| 5 | **P2** | Improve team/leadership-page person extraction using JSON-LD `Person` schema (pattern verified real and working in `b2b-lead-intelligence`) | Epitaxy already extracts leadership contacts from scraped content; this is a precision upgrade to an existing capability, not new architecture. |
| 6 | **P2** | Formalize `layoffs_restructuring`/`funding_round`/`acquisition`/`leadership_change` into a shared lightweight "business event" view (dates optional) for Why-Now to read | Nice-to-have organization of signal types that already exist; not a new detection capability. |
| 7 | **P2** | Incremental research / change detection (diff two runs' `DetectedSignal` sets) | Genuinely new capability the brief asks for (§14) and nothing today does — real value, but no urgency, no user ask yet. |
| 8 | **P3** | Formal `ResearchSource` adapter interface | Epitaxy already has the *effect* of this (scraper's Firecrawl→Jina→Tavily→direct fallback chain, discovery's 3-tier AI-knowledge→search-grounded→regex chain) without the interface. Worth extracting only when a genuine 4th provider is being added — building it speculatively now is exactly the premature abstraction ponytail/YAGNI flags. |
| 9 | **P3** | Person-to-opportunity numeric ranking table (the brief's "VP Operations — 94" example) | `role-recommendation.ts` already gives an explainable role-category match; a numeric composite on top of that is cosmetic until there's a concrete downstream consumer (e.g. sorting multiple Prospeo candidates) that needs a single sortable number. |
| 10 | **P3** | Logged-in-browser LinkedIn enrichment (Playwright/CDP, `linkedin-leadgen`-style) | Explicitly **not recommended** — see §E. Real ToS/legal exposure and DOM-fragility risk for a capability (rich profile data) that search-discovery + Prospeo already cover for outbound purposes. |

Nothing here recommends replacing deterministic qualification with LLM
scoring, loosening disqualifiers, or creating opportunities from sector match
alone — all five repos' scoring models are weaker than Epitaxy's existing
one, not stronger (see §C, §D).

---

## C. What to copy

| Repo | Source | Pattern | Adaptation plan |
|---|---|---|---|
| `b2b-lead-intelligence` | `src/main.ts`, `src/feed-lead.ts` | Real `feed` (cheap, discovery-only) vs `enriched` (full crawl) mode split, charged differently | Epitaxy's discovery→scrape flow already has a similar cheap-first shape informally (enrichment discovery runs before/parallel to scrape). Formalizing an explicit cheap/deep mode toggle is P3 — only worth it if cost becomes a real complaint. |
| `b2b-lead-intelligence` | `src/extractors/key-people.ts` | JSON-LD `Person` schema parsing + anchor-proximity text windows for team/about pages | Adapt into Epitaxy's existing leadership-contact extraction in `evidence-extractor.ts` as a precision improvement (item B.5). No LinkedIn involved — fully compliant. |
| `50k-lead-generation-system` | Node "Builds a Google Query" | `site:linkedin.com/in/ "{Title}" "{Company}"` search-discovery query shape | This is the recommended LinkedIn-adjacent pattern (§E, option 1) — a public search result URL, no login, no scraping. |
| `linkedin-leadgen` | `scripts/db.ts` upsert (`relevance = MAX(relevance, ?)`, `COALESCE` for text fields) | "Never downgrade a stronger existing record" upsert discipline | Worth adapting generically for any future evidence/contact dedup store Epitaxy builds — independent of LinkedIn, a genuinely good small pattern. |
| `linkedin-leadgen` | `scripts/db.ts` (`hashProfileUrl`) | SHA256-of-canonical-URL as a dedup key | Same idea Epitaxy already applies via canonical-domain/name normalization elsewhere (`company-dedup.ts`) — reuse the *principle*, not the code. |

Everything else across all five repos is either weaker than what Epitaxy
already has (opaque single-number LLM scoring with no rubric traceability,
in 3 of 5 repos) or not worth the compliance/fragility cost (LinkedIn
browser automation).

---

## D. What not to copy

- **The 0–10 / 1-to-10 single-integer LLM scoring models** (`50k-lead-generation-system`, `ai-linkedin-lead-generation-machine`) — no rubric breakdown, no audit trail, in one case literally a copy-pasted hotel-industry prompt never genericized. Epitaxy's existing threshold/disqualifier/evidence-count model is more rigorous than all of these.
- **n8n/Airtable/Apify as infrastructure** — three of the five repos are single n8n workflow exports with zero error handling, zero retry logic (verified by grepping every node for `retryOnFail`/`onError` — none set), and hardcoded array-index field access that breaks if a form field reorders. Not a foundation to build on; CLAUDE.md's existing "don't add providers/vendors without a measured need" rule already covers this.
- **`ai-linkedin-lead-generation-machine` wholesale** — every LinkedIn-touching node in every one of its 5 workflow files ships with genuinely empty `parameters`/`credentials` in the committed JSON. Its outreach workflow has no LLM node at all. This repo is a marketing README wrapped around non-functional exports; there is nothing here to adapt.
- **`lead-gen-hacker` wholesale** — a single hand-wired, disabled (`"active": false`) n8n export built as a lead magnet for a consulting funnel, not a system. Its "cost-aware routing" gates a Sheet write *after* the expensive LLM call already ran, which is not what it claims to be.
- **Full browser-automation LinkedIn access** (`linkedin-leadgen`'s pattern) — see §E for the specific reasoning; this is a "don't build it" call, not just "don't copy the code."

---

## E. LinkedIn strategy

Three viable architectures, from the actual verified patterns in the reference repos:

1. **Search-discovery only** (recommended) — query a search provider Epitaxy
   already uses for `site:linkedin.com/in/ "Company Name" "Target Title"`,
   surfacing a public profile URL + search snippet only. No login, no
   session, no scraping of LinkedIn's own pages. Matches the pattern
   verified real in `50k-lead-generation-system`. Lowest risk, lowest
   richness (URL + snippet, not full profile data) — but that's enough to
   hand a rep a working link, which is most of what §9's example table
   actually needs.
2. **Company-website people discovery** (already partially built) —
   `evidence-extractor.ts` already extracts leadership contacts from the
   company's own scraped pages; item B.5 (JSON-LD `Person` parsing,
   verified real in `b2b-lead-intelligence`) improves its precision. Zero
   LinkedIn dependency, fully compliant, but coverage is limited to
   companies with a public team/leadership page.
3. **Logged-in browser automation** (`linkedin-leadgen`'s pattern: Playwright
   attached via CDP to an externally-authenticated LinkedIn session) — the
   only option that gets full profile data (headline, work history, recent
   posts). **Not recommended.** This isn't just an engineering risk
   (DOM-shape fragility, no anti-detection layer found in the reference repo
   at all): LinkedIn's own Terms of Service prohibit automated
   access/scraping regardless of whether the session is a real logged-in
   account, and that's a genuine legal-exposure question distinct from "we
   decided to allow LinkedIn work architecturally for this initiative." If
   this option is wanted, it should be a separate, explicit decision made
   with that specific tradeoff in view — not a byproduct of this audit.

**Recommendation: build option 1 as new work, ship option 2's precision
upgrade, do not build option 3.**

---

## F. Data model

Additive only — no rename/restructure of `ExtractedEvidence`, which already
carries most of the brief's proposed evidence shape under existing names
(`origin` ≈ proposed `origin`, `evidence_strength` ≈ proposed `confidence`
bucket, `pattern_matched`/`SignalType` ≈ proposed `signalType`, `source_tier`
≈ proposed `sourceTier`).

Proposed changes:
- `ExtractedEvidence.published_at?: string` — populated only when a real
  date is extractable (press/news metadata, dated filings); absent
  otherwise, never inferred/guessed.
- `ExtractedEvidence.retrieved_at: string` — trivial to add, always known at
  extraction time.

Not proposed: a separate `BusinessEvent` type, a separate unified
`ResearchSource`/normalized-source object, or `personId`/`companyId` fields
on evidence — none of these have a concrete consumer yet; adding them now
would be schema for a future that hasn't arrived (see B.6, B.8 — deferred to
P2/P3 pending real need).

---

## G. Research pipeline (recommended end-to-end flow, unchanged in shape)

```
Company URL/name
  -> Scraper (Firecrawl -> Jina -> Tavily -> direct fetch)          [existing]
  -> Enrichment discovery+fetch, parallel with scrape                [existing]
  -> buildSupplementedCompanyProfile (website-primary, external-supplement)  [existing, uncommitted — see L]
  -> Signal extraction + evidence-origin tagging                     [existing, uncommitted — see L]
  -> Deterministic opportunity generation (8 confirmed services)      [existing]
  -> Why-Now trace (fact/inference split, evidence_ids)               [existing, uncommitted — see L]
  -> [NEW] Role-category -> title recommendation -> decision-maker search (Prospeo + search-discovery LinkedIn URL)
  -> Grounded outreach generation                                    [existing]
```

No stage is being replaced. The one new stage is the people-discovery chain
in B.2/B.3/E.1.

---

## H. Evidence lifecycle (current state, verified against source)

```
Discovery (search / enrichment sources)
  -> Retrieval (scraper / web-enricher, tagged with origin: own_site | filing | job_posting | news | other_external)
  -> Pattern match (service-evidence.ts / SIGNAL_PATTERNS) or quote-verification.ts (LLM-claimed quotes)
  -> Verified evidence (ExtractedEvidence / ServiceEvidenceMatch, both origin-tagged)
  -> Opportunity (deterministic threshold, or llm_verified/llm_inferred — never silently promoted to confirmed)
```

This already matches the brief's §7 "discovery is not verification" diagram.
No change recommended to the lifecycle shape itself.

---

## I. Provider strategy

Existing pattern (already a real fallback chain, not a single provider):
scraper: Firecrawl → Jina Reader → Tavily → direct fetch. Discovery
(competitor/ICP): AI direct-knowledge → search-grounded synthesis → legacy
regex extraction. People: Prospeo (+ Explee) → website-grounding cross-check.

New provider surface needed: none for search-discovery LinkedIn URLs — reuse
whichever search provider (Serper/Tavily/etc.) is already wired in. No new
vendor account required if one is already active; confirm via
`/admin/outbound/integrations` before assuming.

---

## J. Cost strategy

Nothing in the five reference repos' cost handling is worth adopting
wholesale — `50k-lead-generation-system`'s cost gate filters what gets
*saved* after the expensive LLM call already ran, not what gets *paid for*.
Epitaxy's existing parallel-not-sequential enrichment discovery and 3-tier
discovery fallback already amount to real cost-aware routing without a
named "tier" abstraction. Recommend: no new cost-tier framework (B.8);
add cost-awareness only at the point of the new search-discovery calls
(B.2) — skip the query if Prospeo already returned a confirmed contact for
that role.

---

## K. Reliability strategy

Biggest real failure modes, in order:
1. **Evidence loss under a thin scrape** — the exact bug already fixed
   uncommitted (`buildSupplementedCompanyProfile`, §L Phase 0). Landing and
   benchmarking this is the top action item.
2. **Provider timeout/failure cascading to no evidence at all** — already
   isolated via the existing multi-tier scraper fallback and the
   PASS/WARN/PARTIAL (never hard FAIL) validation gate. No change needed.
3. **New search-discovery LinkedIn calls failing silently** — when B.2 is
   built, it must fail closed (no candidate surfaced) exactly like every
   other provider path in this codebase, never fabricate a profile URL.

---

## L. Implementation roadmap

### Phase 0 — correctness/reliability: ALREADY WRITTEN, uncommitted, verified working

The working tree already contains a substantial, tested fix for the exact
issues the brief's own §3 describes as P0:

- `EvidenceOrigin` tagging (`own_site`/`filing`/`job_posting`/`news`/
  `other_external`) threaded through `evidence-extractor.ts` →
  `service-evidence.ts` → `opportunity-engine.ts` → `normalize.ts`.
- `buildSupplementedCompanyProfile()` — fixes exactly the "website-only
  classification vs. website+enriched signal scanning" scoping bug the
  brief describes in its own §3, with the same website-trusted-first
  ordering the brief asks to preserve.
- `deriveWhyNowTrace()` — fact/inference-separated, evidence-ID-traceable
  Why Now, replacing free LLM narrative for this field; returns an explicit
  `no_verified_signal` state rather than inventing urgency.
- `layoffs_restructuring`/`funding_round` signals wired as **boost-only**
  gates (never an independent evidence tier or their own service) —
  matches the brief's cross-cutting rule against sector/single-signal-driven
  opportunities.
- A real fix in `assemble-input.ts`: sector match alone no longer reaches
  outreach copy without a real matched opportunity — directly closes the
  brief's own rule #1/#2.
- New tests: `evidence-origin.test.ts`, `why-now-trace.test.ts`,
  `layoffs-funding-signals.test.ts`, `company-profile-supplement.test.ts`,
  `opportunity-disqualifiers.test.ts`, `opportunity-engine.test.ts`,
  `evidence-extractor-financial-signals.test.ts`. All 8 new/touched test
  files verified passing (110 assertions) and `tsc --noEmit` clean during
  this audit.

**Action: run the full suite + `npm run benchmark` against the current
10-company set, compare to the last snapshot, then commit.** This should
happen before any vNext work starts, not as part of it.

### Phase 1 — thin, mostly documentation

Add `published_at`/`retrieved_at` to `ExtractedEvidence` (F). No source
unification needed — origin+tier already does that job.

### Phase 2 — people/LinkedIn (the real new-build phase)

Search-discovery LinkedIn URL path (B.2) wired to `role-recommendation.ts`'s
category output (B.3); JSON-LD `Person` precision upgrade on existing
leadership extraction (B.5). Explicitly skip browser-automation LinkedIn.

### Phase 3 — monitoring

Incremental refresh / change detection (B.7) — genuinely new, no existing
partial implementation found. Lowest priority of the four phases; no user
ask for it yet.

### Phase 4 — outreach

Already substantially built (`claim-grounding.ts`, `quote-verification.ts`,
`personalization-check.ts` all exist and are wired into
`assemble-input.ts`/`prompts.ts`). Only new wiring: thread
`why_now_evidence_ids`/`source_urls` (already produced by Phase 0's
`deriveWhyNowTrace`) into the outreach prompt context if not already
consumed there — worth a quick grep-check before assuming it's needed, since
Phase 0 may have already covered it in `normalize.ts`'s `why_now_*` fields.

**Do not implement all four phases at once — Phase 0 lands first, on its
own, before Phase 2 (the only phase with real new scope) starts.**

---

## Untested / uncertain areas (stated plainly, not hidden)

- The five reference repos were read via fetched source (README + key files
  + workflow JSON where applicable), not fully cloned and executed — verdicts
  on "what's implemented vs. stubbed" are based on static reading, which is
  what the brief asked for, but isn't runtime verification of those repos.
- `assemble-input.ts`'s consumption of the new `why_now_*` fields (Phase 4
  note above) was not directly traced line-by-line in this audit — flagged
  as a two-minute grep check before Phase 4 work starts, not assumed done.
- Phase 0's uncommitted work has passing unit tests and clean `tsc`, but has
  **not** been re-run against the `npm run benchmark` 10-company set as part
  of this audit — that's the explicit next action, not something this audit
  claims to have verified.
