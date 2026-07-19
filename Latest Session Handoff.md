# Session Handoff

## Milestone Completed

**Competitor Discovery Engine** (Roadmap Phase 2, item 1) — full arc
finished this session: architecture and schema and prompt design were
already done from prior sessions; this session completed real
implementation, gating, testing, and UI, taking the milestone from
"scaffolded but inert" to "live in the pipeline."

Given an already-researched company, the pipeline now searches for real
competitors (Tavily/Serper), extracts candidate names via regex (no LLM
guessing), filters out self-name/directory/customer/supplier/certifying-
body/association false positives, tiers confidence, caps at 5, has the LLM
narrate `why_they_compete`/`market_position`/`differentiator` for those
exact candidates only (never inventing a new name), merges that narration
back onto the code-derived list by name, and renders it in a new
"Competitors" section in `ResearchCard.tsx`.

This session also bootstrapped the `docs/` living-memory system
(`PROJECT_STATE.md`, `ROADMAP.md`, `DECISIONS.md`, `CURRENT_TASK.md`) that
this development mode requires, since none of those files existed yet.

---

## Files Modified

- `lib/enrichment/competitor-discovery.ts` — added real `discoverCompetitors()`
  logic (search, regex extraction, filtering, tiering) below the existing
  schema; added a `candidates` field to `CompetitorDiscoveryResult`.
- `app/api/admin/test-analysis/route.ts` — kicked off `competitorDiscoveryPromise`
  parallel with `discoveryPromise`; bounded 12s await before prompt build;
  new `COMPETITOR` gate; threaded result to `normalize.ts` via `merged._competitor_discovery`.
- `lib/pipeline/normalize.ts` — replaced the hardcoded `competitors: []`
  default with a real merge-by-name step (code skeletons + LLM narration);
  added `competitorNameMatch()`.
- `app/admin/intelligence-lab/ResearchCard.tsx` — new "Competitors" section.
- `tests/competitor-discovery.test.ts` — new, 27 assertions.
- `CLAUDE.md` — Phase 2 / item 1 section marked COMPLETE with full detail.
- **New**: `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`,
  `docs/CURRENT_TASK.md` — bootstrapped this session (none existed before).
- This file (`Latest Session Handoff.md`).

---

## Key Decisions

- `CompetitorDiscoveryResult` needed both a `competitors: CompetitorProfile[]`
  (final, tiered, LLM-ready-to-merge) AND a `candidates: CompetitorCandidate[]`
  (same survivors, richer pre-narration shape) — the prompt block needs the
  latter's `mention_count`/`snippets`/`explicit_vs_framing`, the merge step
  needs the former's `confidence`/fallback text. Not anticipated by the
  earlier Schema session; added as an additive field, not a redesign.
- `why_they_compete` on `discoverCompetitors()`'s output is a code-derived
  fallback string, overwritten by LLM narration only when a name match
  exists — mirrors `DeterministicOpportunity.strategic_challenge`'s
  fallback pattern exactly, so competitors always have *some* explanation
  even if the LLM step fails or times out.
- Competitor name matching in the `normalize.ts` merge uses a normalized
  near-exact match (`competitorNameMatch()`), deliberately NOT the fuzzy
  keyword-overlap `titleMatch()` opportunities use — company identity needs
  higher precision than a free-text title, to avoid cross-merging narration
  between two different companies that share one word.
- Competitor discovery's await is a simple bounded race (12s), intentionally
  NOT integrated into ENRICHMENT's existing soft/hard/late-arrival timeout
  machinery — kept separate to avoid regression risk in that
  timing-critical, already-fragile code path, since competitor discovery
  has no "late" continuation need (it's a one-shot list, not
  re-extraction-feeding content).
- Two real bugs found by writing tests before trusting the implementation:
  `extractVsPair()` missed "Vs"/"VS" (case-sensitive trigger); `classifyRejection()`
  reported the wrong reason for short known-directory names like "G2"
  (check-order issue). Both fixed; this is the argument for writing tests
  as part of the same milestone, not a separate session.

---

## Current System State

Competitor Discovery is live end-to-end in code: `tsc --noEmit` clean, full
test suite 79/79 passing (52 pre-existing + 27 new), dev server compiles
and renders `/admin/intelligence-lab` with zero console/server errors.

**Not yet done**: a live run against a real company, spending real
Tavily/Serper quota, to confirm the whole chain (search → filter → LLM
narration → merged report → UI) works against real-world data, not just
unit-level correctness. Deferred deliberately — same pattern as Phase 1
Item 3's PDF work — because it spends real API quota and this repo's
convention requires explicit confirmation before that.

`docs/PROJECT_STATE.md` / `ROADMAP.md` / `DECISIONS.md` / `CURRENT_TASK.md`
now exist and are the source of truth for a fresh session, per this
session's DEMAZE DEVELOPMENT MODE instructions. `CLAUDE.md` remains the
detailed historical record; the `docs/` files are the concise index.

---

## Remaining Work

Only Roadmap-relevant items:

- Live end-to-end verification of Competitor Discovery against real API
  quota (optional cleanup, not blocking the next milestone).
- Phase 2 item 2: **ICP Generator** — not started.
- Phase 2 items 3-9: Company Discovery Engine, Research Quality Framework,
  Research Evaluation Framework, Market Intelligence Layer, Outreach
  Intelligence Layer (mostly built, needs field-naming reconciliation),
  Decision-maker discovery (blocked on vendor decision), Outreach send
  (blocked on vendor decision).
- Phase 1 item 4 (executive-change/investor-transcript query targeting) —
  deferred, independent of Phase 2, can be picked up anytime.

---

## Recommended Next Milestone

ICP Generator

---

## Files Next Session Should Read

- `CLAUDE.md`
- `docs/PROJECT_STATE.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`
- `docs/CURRENT_TASK.md`
- This handoff

---

## Project Summary

Demaze's Outbound Intelligence Platform researches companies for B2B
outbound sales. Core pipeline (URL → scrape → enrich → classify → extract
signals → LLM narrative → normalize → validate) is done and stable
(Phase 1, complete). Current work is Phase 2: building toward Explee's
6-phase AutoGTM loop (research → competitors → ICP → find companies → find
contacts → send outreach). Only phase 1 (research) was built before this
week; phases 5-6 (contact discovery, email send) are in-scope-but-blocked
on vendor decisions not yet made (people-data API, sending infra) — do not
build those opportunistically.

Competitor Discovery Engine (Phase 2 item 1) just finished this session:
search-grounded competitor discovery (Tavily/Serper), regex-based name
extraction with no LLM guessing, aggressive filtering against false
positives (self-name, directories, customers/suppliers/certifying bodies),
confidence tiering, LLM narration constrained to only the code-found
candidates, merged into the final report and rendered in the admin UI. Full
test coverage, type-checks clean, dev server verified with no errors. A
live run against real API quota is the only deferred piece, intentionally
not spent without user confirmation.

**Buyer/contact identity stays input-only** — never generate, rank, or
infer who the buyer is; that's on the lead row already. **LinkedIn stays
excluded** regardless of scope changes. **Windows dev server doesn't
pick up file changes from a Linux shell** — restart `npm run dev` after
editing pipeline files before trusting a live run reflects a fix.

Development mode for this project is now milestone-based, not
micro-session-based: one full feature (architecture → schema → prompt →
implementation → test → UI) per session, tracked via `docs/CURRENT_TASK.md`,
with `docs/ROADMAP.md` as the priority-ordered backlog and
`docs/DECISIONS.md` as the durable-decision log. `CLAUDE.md` stays the
detailed historical record underneath those.

Next milestone: **ICP Generator** (Phase 2 item 2) — given a researched
company, generate target-customer ICP segments (who *they* sell to) with
reason/signals/buying indicators. Distinct from the existing demoted
`company_fit` score (that scores whether a lead is a good fit for Demaze,
a single number) — reconcile naming, don't build a parallel system.

---

## Resume Prompt

Read PROJECT_STATE.md, CURRENT_TASK.md, DECISIONS.md and the handoff below.
Continue ONLY the recommended next milestone. Do not revisit completed
decisions unless blocked.
