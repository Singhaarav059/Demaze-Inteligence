# Roadmap

Full decision history: `docs/DECISIONS.md`. This file is status only.

## Phase 1 — Pipeline Engineering — COMPLETE (2026-07-12)

Core 4-step pipeline (find website → enrich → find problem → AI research),
batch lead-list upload, buyer/contact field removal, quota-pause handling.
Items 2 (parallel enrichment), 3 (PDF fetch), and 4 (executive-change /
investor-transcript query targeting) all done — item 4 done 2026-07-23,
code + unit tests, live verification pending (same pattern as every other
quota-spending discovery module in this repo).

## Phase 2 — AutoGTM loop (scope pivot 2026-07-14)

Target: Explee's 6-phase loop. Priority order, one milestone at a time:

1. **Competitor Discovery Engine** — COMPLETE (2026-07-15), including live
   end-to-end verification against real API quota.
2. **ICP Generator** — COMPLETE (2026-07-15), including live end-to-end
   verification against real API quota.
3. **Company Discovery Engine (ICP → matching companies)** — COMPLETE
   (2026-07-15), including live end-to-end verification against real API
   quota.
4. **Research Quality Framework** — COMPLETE (2026-07-15), including the UI
   pass (Research Quality section in `ResearchCard.tsx` +
   `getResearchQuality()` getter) and a live end-to-end verification run
   that produced 4 real flags (self-name-collision competitors, single-
   mention high-confidence ICP segments). Per-item confidence audit,
   informational-only, no gating. See `DECISIONS.md`.
5. **Research Evaluation Framework (0-100 benchmarking)** — COMPLETE
   (2026-07-15). Offline, `benchmarks/`-only aggregator; see `DECISIONS.md`.
6. **Market Intelligence Layer** — COMPLETE (2026-07-15), including live
   end-to-end verification against real API quota. Pure deterministic
   (search → categorize trend/growth_indicator/challenge/shift → tier →
   cap), no LLM narration layer — a deliberate divergence from the
   Competitor/ICP pattern. See `DECISIONS.md`.
7. Outreach Intelligence Layer — **substantially built already**
   (`OutreachIntelligence` in `lib/pipeline/analysis-sections.ts`,
   populated by `lib/prompts/analyze-v2.ts`, rendered in
   `ResearchCard.tsx`). Only needs field-naming reconciliation against this
   doc, not a rebuild.
8. Decision-maker discovery (Explee phase 5) — blocked on people-data
   vendor decision (Apollo/PDL/Proxycurl/Hunter-class). Not started.
9. Outreach send (Explee phase 6) — blocked on sending-infra vendor
   decision (domain warming, deliverability, provider). Not started.

Items 8-9 cannot start until their vendor questions are answered — that is
its own session, separate from pipeline code.

## Rule

Finish one milestone's full arc (architecture → schema → prompt →
implementation → test) before starting the next. Do not parallelize
roadmap items across sessions.
