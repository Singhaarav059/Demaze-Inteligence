# Evidence Ledger Design (G2.2–G2.12)

Date: 2026-08-18
Status: Design + implementation record. See `docs/evidence-ledger-audit.md` for
the audit this design is built on.

## G2.2 — One canonical evidence object

**Decision: extend the existing `EvidenceItem` interface in `lib/pipeline/normalize.ts`, not a new type.**

The audit found `EvidenceItem` already exists (`id, subject, tier, category,
quote, source_page`) and already has the right conceptual shape — it's just
never populated with anything beyond an unverified LLM-authored array. Rather
than invent a second, differently-named canonical object (`IntelligenceEvidence`,
as the master plan's own §3 sketches), the new fields are added to it
additively, all optional, so the existing (unverified) LLM `evidence[]` path
keeps working byte-for-byte unchanged:

```ts
export interface EvidenceItem {
  id: string
  subject?: string
  tier?: string
  category: string
  quote: string
  source_page: string

  // ── G2 additions, all optional/additive ──────────────────────
  claimType?: 'observed' | 'inferred' | 'hypothesis'
  sourceUrl?: string | null          // real URL, or null if unattributable — never fabricated
  sourceType?: SourceType | 'unknown'
  sourceAuthority?: SourceAuthority  // 'first_party' | 'regulatory' | 'reputable_third_party' | 'weak' | 'unknown'
  publishedAt?: string | null        // ISO date, or null if genuinely unknown
  accessedAt?: string                // ISO timestamp, when this evidence item was built
  freshness?: Freshness              // 'very_recent' | 'recent' | 'aging' | 'stale' | 'unknown'
  companyIdentityConfidence?: 'high' | 'low' | 'unknown'
  contradictionStatus?: 'none' | 'conflict' | 'unknown'
  confidence?: number                // 0-100, deterministic (see G2.5)
  supportingEvidenceIds?: string[]
  contradictoryEvidenceIds?: string[]
}
```

`claimType` deliberately reuses the exact vocabulary already established by
`StructuredPainPoint.claim_type`/`opportunities[].claim_type`
(`'observed'`/`'inferred'`) rather than the master plan's own suggested
`confirmed_fact`/`reasonable_inference`/`hypothesis` naming — per G2.2's own
instruction to reuse existing terminology over inventing parallel vocabulary.
`'hypothesis'` is the one genuinely new value (see G2.4).

**Not done**: a parallel `EvidenceLedgerItem` type, a new Supabase table, or a
new field on `opportunities`/pain points beyond `supportingEvidenceIds`
(reusing the array-of-string-ids pattern the plan itself proposes in §G2.10).

## G2.3 — Evidence hierarchy

**Decision: reuse `SourceType` (`discovery-engine.ts`) as input, add a new,
separate `sourceAuthority` axis rather than redesigning `SourceType` itself.**

The audit's key finding (G0 §1.6, repeated in G2.1): `SourceType` +
`EvidenceStrength` + `priority_score` already form a real hierarchy, but it's
a **document-genre** hierarchy (annual report vs. news article vs. blog), not
a **source-authority** hierarchy (first-party vs. regulatory vs. independent
third-party vs. weak) — `regulatory_filing` and `annual_report` currently
score identically despite one being externally filed/audited and the other
self-published.

New pure function `classifySourceAuthority(sourceType)` in
`lib/pipeline/evidence-ledger.ts`:

```
regulatory_filing                                          → regulatory
annual_report, investor_presentation, earnings_release,
earnings_call_transcript, executive_change_announcement,
official_blog, corporate_website, press_release, careers_page,
ceo_interview                                               → first_party
news_article, sustainability_report                         → reputable_third_party
other, undefined                                             → weak
search_result (search-discovered, not yet source-typed)      → weak
unknown (LinkedIn/unavailable, or no sourceType at all)       → unknown
```

This maps directly onto the master plan's §6 four-tier hierarchy (Tier 1
primary company evidence / Tier 2 executive-employee / Tier 3 reputable
external / Tier 4 weak-discovery), with `regulatory` as an explicit fifth
value rather than folded into Tier 1 — the audit's own flagged distinction.
Tier 2 (executive/employee statements) isn't separately reachable from
`SourceType` today (no `SourceType` value distinguishes "an executive's own
statement" from "the company's own press release") — documented as a known
gap, not faked.

## G2.4 — Fact vs. inference vs. hypothesis

**Decision: reuse the existing `'observed'`/`'inferred'` split unchanged;
`'hypothesis'` is new but currently unreachable from the LLM prompt.**

`claim_type: 'observed'` (quote-verified) already maps to the plan's
"CONFIRMED FACT." `claim_type: 'inferred'` (reasoning-based, `inferred_from`
required) already maps to "INFERENCE." Both are real, working, code-enforced
distinctions — not touched.

**"HYPOTHESIS" is genuinely new** and, honestly, not wired to anything that
currently produces it: `analyze-v2.ts`'s narrative prompt only ever asks for
`claim_type: 'observed' | 'inferred'`, so no LLM output can arrive tagged
`'hypothesis'` today. The new evidence-ledger code accepts `'hypothesis'` as
a valid `claimType` value (for forward-compatibility and for evidence items
the ledger itself builds with genuinely no attribution — see G2.6) but does
**not** modify `analyze-v2.ts`'s schema to ask the LLM for a three-way split.
That's a real, separate prompt-engineering change with its own regression
risk (a schema change to the narrative prompt that every downstream
opportunity/pain-point consumer would need re-validating against) —
explicitly out of scope for this session, flagged here rather than silently
faked by relabeling `'inferred'` as `'hypothesis'` under some threshold.

**Enforced rule (already true, verified not weakened)**: only `'observed'`
and properly-gated `'inferred'` claims reach `opportunities`/`pain_points` at
all (`normalize.ts`'s existing filters) — nothing labeled `'hypothesis'` can
reach an automated email today, because nothing produces that label yet. The
ledger's `computeEvidenceConfidence()` (G2.5) still treats a hypothetical
future `'hypothesis'` claim as directness=0, so if one is ever wired in it
won't silently inherit inference-level confidence.

## G2.5 — Source quality scoring

**Decision: new deterministic additive score, confirmed not duplicating any
existing scoring system.**

Checked before building: `lib/pipeline/scorer.ts`'s `ScoreWithBreakdown` /
`outreach_priority_score` is a **lead-priority** score (should Demaze
prioritize calling this company), confirmed via the G0 audit to read
`detected_factors`/`signal_clusters` only — it never reads `opportunities`,
`pain_points`, or anything evidence-shaped. `service-evidence.ts`'s
`ServiceThreshold` (`none/weak/medium/strong`) is a per-service capability
match tier, not a general evidence-confidence score. Neither overlaps with
"how much should we trust this specific claim" — so a new scorer is the
correct call, not a duplicate.

`computeEvidenceConfidence(item)` in `lib/pipeline/evidence-ledger.ts`:

```
score = sourceAuthorityPoints(item.sourceAuthority)     // first_party/regulatory: 40, reputable_third_party: 25, weak: 10, unknown: 5
      + identityPoints(item.companyIdentityConfidence)   // high: 20, low: 5, unknown: 0
      + directnessPoints(item.claimType)                 // observed: 25, inferred: 10, hypothesis: 0
      + freshnessPoints(item.freshness)                  // very_recent: 15, recent: 10, aging: 5, stale: 0, unknown: 5
      - contradictionPenalty(item.contradictionStatus)   // conflict: 30, else 0
clamp(score, 0, 100)
```

Explained by construction (each contributing term is itself a named,
independently-inspectable field on the `EvidenceItem`) — satisfies G2.5's
"produce a score that can be explained." Weights are a first pass, explicitly
not tuned against real data yet (same "initial policy values, calibrate
later" discipline the master plan itself uses for its own confidence-ceiling
proposal in §8).

## G2.6 — Company identity verification

**Decision: reuse `mentionsCompany()` (`lib/enrichment/extraction-guards.ts`)
directly — the exact function already used as competitor/ICP discovery's
"is this really about the researched company" relevance gate.**

`computeCompanyIdentityConfidence(quoteWindowText, companyName)`:
- No `companyName` available → `'unknown'` (never guess).
- `mentionsCompany(quoteWindowText, companyName)` true → `'high'`.
- Otherwise → `'low'` (not `'unknown'` — the company name WAS checked for
  and wasn't found near the quote, a real, if weak, negative signal, distinct
  from never having checked at all).

This deliberately does **not** re-derive the company-level identity
resolution already done upstream in `website-discovery.ts`'s
`discoverCompanyWebsite()` (domain/name/subsidiary/parent matching) — that
question ("is this the right company's website at all") is already answered
before scraping starts. This function answers a narrower, per-evidence-item
question: "does this specific quote actually reference the company by name,"
which matters because a scraped page can legitimately contain third-party
mentions (a partner, a customer, a competitor named in passing) that aren't
about the researched company even though the page itself is confirmed to
belong to that company.

**Known edge case, documented not solved**: pronoun-only references ("we
operate six facilities" with no literal company name nearby) will score
`'low'` even though a human reader would recognize first-person company
voice. `classifySubject()`'s existing "we/our" first-person detection
(`evidence-extractor.ts`) already solves this for a different purpose
(subject classification) but isn't consulted here — folding it in is a
reasonable future refinement, not done this session to keep the new
module's dependency surface small and auditable.

## G2.7 — Contradiction detection

**Decision: new, deterministic, keyword-polarity-pair matching — genuinely
built, not a stub.**

`detectContradictions(items: EvidenceItem[])` in `evidence-ledger.ts`:
for every pair of evidence items belonging to the same run, checks whether
one matches a "has/is-doing X" pattern and the other matches a paired
"lacks/is-not-doing X" pattern from a fixed polarity-pair table (e.g.
implementing/rolling out/deployed/adopted a system vs. lacks/no/manual/
legacy that same system; centralized vs. fragmented; automated vs. manual),
AND the two quotes share real word overlap (reusing `significantWords()`
from `quote-verification.ts`, ≥2 shared significant words) so two unrelated
sentences that each independently mention "system" don't false-positive.
On a match: both items get `contradictionStatus: 'conflict'` and each other's
id pushed into `contradictoryEvidenceIds`; **older evidence loses**, matching
plan §10's "prefer newer evidence only when dates are reliable" — when
`publishedAt` is available on both, the older item's confidence is capped
lower; when neither has a real date, both are downgraded, since which one is
current can't be determined honestly.

**Never silently overwrites either claim** — both items stay in the ledger,
tagged, not deleted. The consumer (opportunity/pain-point construction, see
G2.10) is the one that decides to downgrade/suppress based on
`contradictionStatus`, not this function.

**Explicitly narrow first pass**: the polarity-pair table is small (~6 pairs)
and English-only — a genuine limitation, same "vocabulary gap to extend
later" precedent as this repo's existing `NON_COMPETITOR_NAMES`/adversarial-
content keyword lists (see `CLAUDE.md`'s own 2026-08-13 entry for that exact
precedent). Not claimed to catch every contradiction shape, only the
plan's own example shape (implementing X vs. lacking X).

## G2.8 — Freshness

**Decision: pure date-bucket function, never invents a date.**

`classifyFreshness(publishedAt: string | null, now = new Date())`:
- `publishedAt` null/unparseable → `'unknown'` (not "recent" — the master
  plan is explicit: "Do not silently assume current information").
- < 90 days → `'very_recent'`
- < 365 days → `'recent'`
- < 3 years → `'aging'`
- ≥ 3 years → `'stale'`

**Where a real `publishedAt` is actually available today, confirmed by
reading the code, not assumed**: EDGAR filings (`edgar-client.ts`'s
`filingDate`, a real SEC-reported date) are the only reliable source. Scraped
website content and Tavily/Serper search snippets carry no structured
publish date anywhere in this pipeline today — so the overwhelming majority
of evidence items this session's implementation produces will honestly
report `freshness: 'unknown'`, not a fabricated bucket. This is a correct,
if unsatisfying, outcome per the plan's own explicit instruction — extracting
publish dates from scraped HTML/markdown (meta tags, dateline text) is real
future work, not attempted this session to avoid inventing a shaky
date-extraction heuristic under time pressure.

## G2.9 — Persistence

**Decision: no migration. Reuse the existing JSONB-passthrough pattern.**

Same reasoning as the G1 `research_metrics` field: `NormalizedAnalysis`
already flows into `pipeline_test_runs.final_result` (JSONB) with zero schema
changes needed. A new top-level `evidence_ledger: EvidenceItem[]` field on
`NormalizedAnalysis` persists automatically the same way `research_metrics`,
`competitors`, `icp_segments`, etc. already do — no new table, no migration,
nothing to stop-and-report per the plan's own migration stop-condition
(§G2.9's own instruction: "if a migration is genuinely required, document
before executing" — one was not required, so this section is short).

**Why not `outbound_sales_intelligence` (migration 022, the one table with a
real confidence-tier CHECK constraint)?** Checked before deciding: that
table is scoped to Sales Knowledge's 8-industry system (a different,
DB-backed, admin-editable content system per `CLAUDE.md`'s 2026-08-17
"sector playbook" entry), not per-research-run evidence — reusing it would
conflate two genuinely different concerns (curated sales content vs.
per-run extracted evidence), which the plan's own G2.2 instruction
("prefer one canonical structure" for evidence specifically, not for
unrelated systems) doesn't call for.

## G2.10 — Propagation

**Decision: wire real `EvidenceItem` construction into the two paths that
already do genuine quote verification — opportunities Path B1
(`llm_verified`) and pain-points' `'observed'` branch — rather than
rebuilding the whole opportunity/pain-point pipeline.**

Both paths already call `verifyQuoteInContent()`/`isQuoteGrounded()`
against `llmContentPool` before a claim survives. The new code adds, at
exactly that point (once verification has already succeeded):

1. `attributeQuoteToSource(quote, llmContentPool)` — parses `llmContentPool`
   via `evidence-extractor.ts`'s existing `parseContentSegments()` (exported
   for this reuse, see below) to find which `--- PAGE: /path (url) ---` or
   `[SOURCE: type | tier | url]` segment the quote's matched snippet falls
   inside, returning a real `{ sourceUrl, sourceType }` or `{ sourceUrl:
   null, sourceType: 'unknown' }` if the quote can't be localized to a
   specific segment (e.g. content with no headers, an older cached run).
   **Never fabricates a URL** — the null case is the honest, expected
   outcome for a meaningful fraction of runs.
2. `classifySourceAuthority(sourceType)`, `classifyFreshness(null)` (no
   publish date available from scraped/search content, see G2.8),
   `computeCompanyIdentityConfidence(quoteWindow, companyName)`,
   `computeEvidenceConfidence(item)`.
3. A real `EvidenceItem` is pushed onto a new `evidence_ledger` array built
   during normalization, and its `id` is pushed onto the opportunity's or
   pain point's `supportingEvidenceIds`.
4. After all evidence items for a run are built, `detectContradictions()`
   runs once over the full `evidence_ledger`; any opportunity/pain-point
   whose supporting evidence flipped to `contradictionStatus: 'conflict'`
   has its `confidence`/`opportunity_confidence` downgraded to `'low'` (never
   silently dropped — visible, downgraded, per plan §10).

**`parseContentSegments`/`ContentSegment` exported from
`evidence-extractor.ts`** — a one-line change (add `export`), reusing the
exact, already-correct parser instead of writing a second regex for the
same `--- PAGE: ... ---` / `[SOURCE: ...]` header formats (which would risk
the exact kind of subtle regex-divergence bug this codebase's own audit
chain has repeatedly found and fixed — see `CLAUDE.md`'s
`detectPageType()`/`matchesKeyword()` history).

**Not done this session**: wiring the same attribution into opportunities
Path A (deterministic) or the LLM-inferred paths (B2, and pain points'
`'inferred'` branch) — those paths either already have a strong code-owned
identity (Path A's `deterministic_id`) or have no quote to attribute in the
first place (inferred claims are reasoning, not a located quote) — G2.10's
propagation chain is demonstrated end-to-end for the one path where a real,
attributable, verified quote exists to build a genuine `EvidenceItem` from.

## G2.11 — Email safety

**Confirmed intact, not touched.** `claim-grounding.ts`'s B5 numeric-claim
check and `prompts.ts`'s `"(unconfirmed inference)"` hedging-instruction
mechanism (see audit) already implement exactly what this section asks for —
verified by reading both files in full during the audit, not assumed. No
code in either file was modified this session. `supportingEvidenceIds` (new,
G2.10) is additive to the opportunity/pain-point objects these two existing
mechanisms already consume by `claim_type`/text — it does not change what
`assemble-input.ts` or `prompts.ts` read today; a future session could
extend the email prompt to cite `sourceUrl`/`sourceAuthority` directly, not
done here to keep this session's change surface to evidence construction,
not prompt/generation changes (per the plan's own "Do not add LLMs just to
solve isolated quality issues" and general scope discipline).

## Live verification (G2.14 — small representative fixture, no new API spend)

Per the master plan's own "do not run the entire expensive benchmark
repeatedly" instruction, verification used two already-persisted real runs
from `pipeline_test_runs` (re-running the pure `normalizeAnalysisResult()`
function against their stored `_raw` input — zero Firecrawl/Tavily/LLM
quota spent) instead of a fresh paid run:

- **Lechler (non-English, thin-evidence company)**: `evidence_ledger: []` —
  correct and honest. This run's real LLM output had 5 opportunities, all
  `claim_type: 'inferred'` (0 `'observed'`), so nothing qualified to build a
  ledger entry. Confirms the ledger doesn't fabricate evidence when a real
  run genuinely has none to verify — consistent with this company's own
  long, already-documented thin-evidence history in `CLAUDE.md`.
- **Ador Welding (strong first-party evidence, per `CLAUDE.md`'s own
  reference case)**: 1 real `evidence_ledger` entry built —
  `claimType: 'observed'`, `sourceUrl: null` (this quote's containing
  segment had no page/source header wrapping it in this particular run's
  stored content — an honest null, not a bug), `companyIdentityConfidence:
  'low'` (the quote genuinely doesn't name "Ador Welding" nearby — a real,
  correct assessment of that specific sentence, not a false negative),
  `confidence: 40` (matches the formula exactly: weak/unknown source 5 +
  low identity 5 + observed directness 25 + unknown freshness 5 = 40).
  `pain_points_structured[?].supportingEvidenceIds` correctly links to it;
  the run's one `llm_inferred` opportunity correctly has no
  `supportingEvidenceIds` (nothing to link — inferred, no located quote).

Both outcomes are honest reflections of real data, not the maximally
impressive case cherry-picked — the Lechler zero-result is exactly the
"insufficient evidence" outcome the whole rest of this pipeline already
treats as correct, not a bug in the new code.

## G2.12 — LinkedIn

**No code written.** Confirmed via the audit: no `LinkedInEvidenceAdapter`
or LinkedIn-specific fetch/parse logic exists anywhere in the repo today —
only a hard `isFetchable()` exclusion (`source-prioritizer.ts`) and a
manually-pasted `linkedinUrl` contact field. `CLAUDE.md`'s own history
(reaffirmed 2026-08-04, after a direct prompt to build it anyway) already
settled this: LinkedIn stays excluded, no automation, no scraping, no
bypass. In the new `sourceAuthority` classifier, any evidence item whose
source can't be determined (including a hypothetical LinkedIn URL that
somehow reached this code, which it structurally cannot today since
`isFetchable()` filters it out upstream) maps to `sourceAuthority: 'unknown'`
— never fabricated as `'first_party'` or any other real tier. No further
LinkedIn work was in scope for G2's evidence-ledger implementation
specifically; G2.12 was a documentation/confirmation checkpoint, not a
build task, per the plan's own phrasing ("investigate... if unavailable,
document exactly what is and isn't possible").
