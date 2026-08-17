# Demaze AI Outbound Intelligence Platform — Production Hardening Report

**Date:** 2026-08-17
**Scope:** Execution of a 12-phase Production Hardening Master Plan against an existing, feature-complete AutoGTM prototype.
**Status:** Phases 1–10 and 12 complete and committed. Phase 11 (real-world pilot) intentionally not started — requires business input (a real target-company list) this session couldn't supply.

---

## 1. What this product is

Demaze is a six-phase AI-driven go-to-market platform:

1. Research a company (scrape + multi-source enrichment + evidence extraction + signal detection + opportunity generation)
2. Explore competitors
3. Define ICP / customer segments
4. Find potential customer companies
5. Find decision makers (via Prospeo, a people-data API)
6. Generate and send outreach, track opens/replies, and follow up (via Gmail OAuth)

Stack: Next.js App Router, TypeScript, Supabase/Postgres, Tailwind v4, Railway. LLM: Google Gemini (Vertex AI) primary, NVIDIA NIM/OpenAI-compatible fallbacks. Search/scrape: Firecrawl, Tavily, Serper, Jina Reader. People data: Prospeo (active), Apollo.io (built but currently plan-blocked). Sending: Gmail OAuth.

Before this effort, the six-phase loop was functionally built end to end, but the project had shifted from "feature construction" to needing reliability, evidence quality, safety, deliverability, measurable evaluation, and real-world validation — the subject of this hardening pass.

---

## 2. Why this hardening pass happened

A separate planning document (a "Production Hardening Master Plan") was introduced specifying 12 sequential phases, non-negotiable rules (don't expand scope casually, preserve working functionality, evidence beats model confidence, sending safety, fail closed on external communication), and a target architecture emphasizing one thing above all: **every claim the system makes to a salesperson must be traceable back to real evidence**, and **every send must be safe, deduplicated, and reversible/stoppable**.

The instruction was to execute the plan sequentially, auditing existing code before building anything new (the codebase already had substantial infrastructure from prior work — the risk was duplicating what already existed rather than closing real gaps).

---

## 3. Phase-by-phase summary

### Phase 1 — Baseline Audit
Mapped the repo, ran the full test suite, typecheck, build, lint, and the real benchmark suite (10 companies, real Firecrawl/Tavily/LLM quota, explicit confirmation given first).

**Results:** 770/770 tests passing, clean typecheck (after removing a corrupted `.next` build cache from an interrupted dev-server session), clean build, 17 pre-existing lint errors (mostly React Compiler `set-state-in-effect` warnings, cosmetic, not gating). First benchmark attempt failed instantly for all 10 companies — root cause was simply no dev server running (not a real regression). Re-ran with a server up: **7 passed, 3 warned, 0 failed, mean evaluation score 51.64/100** (up from a previously documented 46.08).

### Phase 2 — Pipeline Observability
**Problem:** the pipeline had a well-documented, recurring "silent zero" bug class — a stage (signals, opportunities, pain points) could quietly return nothing with no machine-readable reason why.

**Found:** the codebase already had a validation-gate system (`PASS`/`WARN`/`PARTIAL`/`FAIL` per pipeline stage, logged and returned in the API response) — good bones, but reasons were free text only, and **opportunities had no standalone gate** — a run with zero opportunities but several pain points showed no distinct signal anywhere that opportunities specifically were the empty one.

**Built:** a 9-value machine-readable `GateReasonCode` enum (`NO_EVIDENCE`, `SOURCE_FAILURE`, `PARSER_FAILURE`, `PROVIDER_FAILURE`, `IDENTITY_MISMATCH`, etc.) attached to every failure-relevant gate, plus a new standalone `OPPORTUNITY` gate mirroring the existing `PAIN_POINTS` gate.

### Phase 3 — Scrape Relevance Engine
**Problem:** the existing scrape-quality scorer was quantity-only (page count, char count) — 15 pages of wrong content scored identically to 15 pages of right content, and there was no page-level identity check (a scraped page could belong to an unrelated company) or content-level deduplication (only exact-URL dedup existed).

**Built:** `lib/pipeline/scrape-relevance.ts` — a deterministic, per-scraped-page relevance scorer combining URL category score + a word-boundary-safe company-identity match + content density, with:
- Identity-mismatch rejection for weak-category pages that never mention the company (with an explicit exemption for careers/blog/press pages, which legitimately don't repeat the brand name)
- Boilerplate URL filtering (privacy/cookie/login/etc.)
- Near-duplicate detection via cheap Jaccard word-set similarity (catches regional-locale clones)
- A safety net: if every page would be rejected, falls back to the full unfiltered set (never leaves the pipeline worse off than not running the stage)

16 new tests covering every required fixture shape (wrong company, similarly-named-but-unrelated company, duplicate regional pages, boilerplate, non-English-but-relevant content not being zeroed out).

### Phase 4 — Evidence Provenance System
**The most consequential finding of the whole effort.** The Phase 1 benchmark run's own evaluator output was the tell: `Evidence-backed opportunities 0/20 — 0/4 opportunities carry an evidence_id`, repeated across nearly every one of the 10 benchmark companies.

**Root cause:** `evidence_id` on every opportunity/pain-point came straight from the LLM's own free-text output field — never generated or cross-checked by code — even for items that already had a real, independently quote-verified evidence string sitting right next to the empty ID field. The LLM's field was essentially always empty in practice.

**Fix:** a deterministic `stableEvidenceId()` helper (short hash, no new dependency) that derives a real ID **from the evidence content itself** wherever genuine evidence exists — a regex-matched deterministic-catalog match, or an LLM claim that already passed independent quote verification. Claims explicitly marked "inferred" (no verified quote) deliberately do NOT get a manufactured evidence_id — staying honest about what's actually evidence-backed vs. reasoned inference.

Also added "Confirmed evidence" / "Reasonable inference" badges plus the actual evidence quote to the opportunities section of the main report UI — previously only titles/descriptions were shown, with confidence/source data sitting unused in the same object.

**Live-verified**, not just unit tested: loaded a real saved run and confirmed the badges rendered correctly against real data — one opportunity correctly tagged "Confirmed evidence" (a real quote from the company's own site), three tagged "Reasonable inference" (each showing its real inference basis).

### Phase 5 — Research/Outreach Quality Gates
Audited first: unsupported-claim detection and a confidence audit already existed. Two genuine gaps found and closed — both **advisory, not blocking**, per the plan's own "guidance, not absolute rules" instruction and this codebase's established "never silently reject" philosophy:

1. **Generic personalization detector** (`lib/outbound/generation/personalization-check.ts`) — deterministic, no new LLM call. Combines a blacklist of filler phrases ("I was impressed by your commitment to innovation," etc.) with a check for whether the email actually shares specific vocabulary with the real evidence it was generated from. Surfaces as a review-time warning badge.
2. **Decision-maker identity grounding was computed at discovery time and then discarded** — by the time a contact reached Review & Send (the actual pre-send checkpoint), the "does this person really work at this company" signal was gone. Fixed by persisting it through a new migration and surfacing a warning badge + an extra line in the send-confirmation dialog when a contact's company identity couldn't be confirmed.

**Note on execution:** this phase was delegated to a subagent that hit an account-level API spend limit right as it finished. Rather than re-running the task, every changed file was reviewed directly against the original brief — this is how the unapplied-migration issue below was caught.

**Real regression caught before it shipped:** the new code selected two new database columns that didn't exist yet in the live database — Review & Send (an existing, working feature) would have broken with a "column does not exist" error. The migration was small and purely additive; applied live with explicit confirmation, verified before/after via direct DB query.

### Phase 6 — Evaluation Harness (pilot scope)
Scoped to the existing 10-company set per an explicit decision (not the full 100 the plan specifies) — deferred quota spend on dataset expansion.

**Found:** metrics, machine-readable output, and per-company trace already existed. The one real gap: no failure taxonomy — every failure was a free-text string, no fixed categorization.

**Built:** `benchmarks/failure-taxonomy.ts` — deterministically maps existing gate reason codes (from Phase 2) and benchmark check names onto a fixed 13-category taxonomy (`RETRIEVAL_FAILURE`, `EVIDENCE_FAILURE`, `MATCH_FAILURE`, `CLASSIFICATION_FAILURE`, etc.), wired into the benchmark runner's console output, debug dumps, and evaluation history. 22 new tests — the first test coverage the `benchmarks/` directory has ever had.

### Phase 7 — Email Safety and Deliverability
Audited first: suppression is checked **twice** (at review time and again at actual send dispatch — genuine defense in depth), duplicate-send guarding existed at the campaign level, per-campaign daily send limits + send windows already existed, campaign pause routes existed, Gmail OAuth reliability was already extensively hardened from prior work.

**The one clear gap:** no global kill switch. Every existing safety mechanism was per-campaign or per-contact — none of them could stop **all** sending at once during an incident.

**Built:** `OUTBOUND_SEND_ENABLED` env var, checked at the single real-send choke point every send path funnels through. Defaults to enabled (preserves current behavior) — setting it to the literal string `'false'` immediately stops every real send path, overriding all campaign-level settings.

**Honestly flagged, not fabricated:** SPF/DKIM/DMARC verification isn't something this codebase can check — sending goes through Gmail OAuth (real Google accounts), not a custom SMTP domain, so DNS authentication is Google's own responsibility, not something to verify from source code. A real deliverability test already happened in prior work (a live send landed in Spam) — not repeated here to avoid spending real send/reputation quota re-confirming a known finding.

### Phase 8 — Campaign State Machine and Follow-Up Hardening
Audited first: a real, working state machine already existed (DB-enforced status values, an immutable event log for every transition, reply/bounce already stopping follow-ups). Rebuilding the whole status vocabulary to match the plan's exact literal state names would have been a large, mostly cosmetic diff for no real safety gain — not done.

**The real gap, found via direct code reading, not assumed:** a genuine **duplicate-send race condition**. The campaign-send route fetched every "queued" contact in one query, then sent and updated status one at a time in a loop — two overlapping calls to the same route (a double-click, two open tabs) would both read the same queued contacts before either updated a single row, and both would send a real duplicate email to the same prospect. The exact same shape existed in the shared follow-up-send function (the single implementation behind manual sends, "Process Follow-ups," and the automatic follow-up engine).

**Fixed:** an atomic conditional database update used as a claim — flip a contact's status to "sent"/"followup_N" guarded by its current status, before calling the actual send function. Only one concurrent request's guard condition can match (Postgres row-level updates are atomic), so a losing concurrent request skips instead of double-sending. Rolled back to the prior status if the send itself then fails, preserving retry-eligibility. Fixed in both the campaign-send route and the shared follow-up function (the higher-leverage fix, since it covers three separate callers with one change).

### Phase 9 — Apollo Decision
This phase requires either spending real vendor credits or making a real cost decision — flagged as exactly the kind of check-in-worthy decision point, and the user chose to spend a small amount of real Prospeo credits to get an actual baseline rather than defer or spend blindly.

**Real, live-measured results** (via the app's own real API routes, not a throwaway script):
- Decision-maker search: 25 real candidates returned in 7.2 seconds
- Email finder + enrichment (one unified call): a verified email address, plus — for free in the same call — full job history, company funding data ($3.0B total across 3 rounds), employee count, revenue range, and a 40-item technology stack

**Finding:** all 25 decision-maker candidates carried the generic title "Director" — likely matched against a formal board/directorship registry rather than operational leadership, a real precision gap worth watching, not a coverage failure.

**Recommendation:** do not upgrade Apollo's plan based on this baseline. Prospeo already delivers, in one call, what would require both of Apollo's currently-plan-blocked capabilities combined. If Apollo is reconsidered later, the trigger should be a measured Prospeo gap across real target companies, not speculative "more coverage might help."

### Phase 10 — Product UX Simplification
Explicitly scoped small per the plan's own "don't redesign the whole app" instruction. Audited first: most of the target six-question framework ("why this company," "why now," "why this problem," "why this person," "why Demaze," "what supports this") already existed as real backend fields.

**Found:** two of the six questions ("why this company/why now" and "why this problem") existed as real, populated fields on every research result but were only ever rendered in the internal debug-tooling page — never in the shared component the actual production surfaces (batch upload, run history, Auto Flow) all use.

**Fixed**, with a real debugging story: the first fix only touched one component; live verification against a real saved run showed the fields still weren't appearing even after restarting the dev server and confirming via direct network inspection that the correct data was reaching the browser. Traced the actual cause by finding every consumer of the shared UI section — two more independent components turned out to render the same section without going through the one that was fixed first. All three were updated; live-reverified afterward with the real data now showing correctly.

### Phase 11 — Real-World Pilot (not started)
This phase requires selecting 20–30 real target companies from an actual go-to-market list and, eventually, sending real emails with explicit per-batch confirmation. This is business input, not an engineering task — it was correctly not fabricated or simulated.

### Phase 12 — Final Production Gate
A full audit against the master plan's own end-to-end checklist (Research / Intelligence / People / Outreach / Sending / Tracking / Evaluation / Business), documented item by item and honestly marked as verified-this-session, pre-existing-and-plausible-but-not-re-verified, or genuinely open. The one hard blocker for a true "production ready" declaration is Phase 11 — no amount of further code work substitutes for a real pilot with real reply/meeting outcomes.

---

## 4. Real bugs found and fixed (the substantive findings, not process notes)

1. **Opportunities/pain-points almost never carried real evidence traceability** — a benchmark-confirmed, scored-0-across-the-board bug (Phase 4).
2. **A genuine duplicate-send race condition** in the primary send path and the shared follow-up-send function — could have sent real duplicate emails to real prospects under normal double-click/multi-tab usage (Phase 8).
3. **No global kill switch existed** — no way to stop all sending at once during an incident (Phase 7).
4. **A live regression caught before shipping**: a migration-dependent code change would have broken the existing Review & Send feature had the migration not been applied (Phase 5).
5. **Three independent UI components silently duplicated a rendering path** — fixing one didn't fix the user-visible symptom; the actual debugging chase found and fixed all three (Phase 10).
6. **Opportunities had no standalone failure gate** — the single most historically-recurring bug class in this codebase (opportunities silently going to zero) had no independent visibility (Phase 2).

## 5. What's verified vs. what's still soft/unconfirmed

**Verified this session** via `tsc --noEmit` + the full test suite (770 → 820 passing tests) after every phase, plus live browser verification or real API calls for the highest-risk changes (evidence badges rendering on real data, the kill switch's boolean logic, real Prospeo calls, a live post-fix benchmark run).

**Deliberately soft, not hard-gated** (matches the plan's own instructions and this codebase's established philosophy): generic-personalization detection, decision-maker identity conflicts, and confidence-flag warnings are all surfaced as visible warnings before send — never silent auto-rejections. This was a deliberate design choice, not an oversight.

**Not re-verified live this session** (pre-existing, unchanged, cited from prior documented work rather than fabricated as freshly confirmed): campaign pause, reply/bounce stopping follow-ups, unsubscribe suppression, current Gmail OAuth token status.

**Explicitly deferred by decision, not forgotten:** expanding the evaluation dataset toward 100 companies (Phase 6), an Apollo plan upgrade (Phase 9), the real-world pilot (Phase 11).

## 6. Discussion points worth raising

- Is the "advisory warning, never silent block" philosophy the right call for a product this close to sending real email on someone's behalf, or should some of these (e.g. decision-maker identity conflict) become a hard block before Phase 11's pilot?
- The Apollo recommendation (don't upgrade) rests on n=1 for email-finder accuracy and a single decision-maker search showing a title-genericness pattern — is that enough signal, or worth a slightly larger real-quota test before treating it as settled?
- Phase 6 was intentionally scoped down from 100 companies to the existing 10 — what's the actual bar for "enough" evaluation coverage before trusting this pipeline against a real, larger pilot list?
- The single highest-leverage fix this session (the duplicate-send race condition) was found by reading code directly, not by an automated test catching it — what does that imply about testing strategy for the send path specifically, given it's real external communication?
- Phase 11 is the one remaining gate before any real business validation exists for this product. What would make a good first pilot list, and what does "success" look like numerically before scaling further?

---

*Full phase-by-phase technical writeups (with exact file paths, code snippets, and verification commands) are available in `docs/production-hardening/` in the repository — this document is a synthesized, standalone summary for external discussion.*
