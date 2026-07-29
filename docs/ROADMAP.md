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
8. **Decision-maker discovery (Explee phase 5)** — COMPLETE. Vendor decision
   made (Prospeo Search Person endpoint), provider built and wired into the
   standard `lib/outbound/decision-maker-discovery/` provider-factory
   pattern, candidates grounded against scraped leadership evidence, and
   user-confirmed working via a real live test (2026-07-28). See
   `DECISIONS.md`. Known remaining gaps (not blockers): the standalone
   `/admin/outbound/contacts` page can't ground candidates from runs saved
   before the grounding field existed; phone/mobile enrichment via Prospeo
   is deliberately not wired (extra per-lookup cost).
9. **Outreach send (Explee phase 6)** — **REVERSED 2026-07-29.** Lemlist
   (chosen and implemented 2026-07-28) was removed entirely at the user's
   explicit request in favor of a free, no-vendor path: Gmail (OAuth,
   already-existing `lib/outbound/sending/providers/gmail.ts`) as the
   sending provider, plus a new free poll-on-demand reply-tracking route
   (`POST /api/admin/outbound/campaigns/[id]/check-replies`, Gmail
   `gmail.metadata` scope, no background scheduler needed). See
   `DECISIONS.md`'s "Outreach send" section for the full history including
   the reversal. The user has completed the Google Cloud OAuth app setup
   (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` configured); the one remaining
   step is clicking "Connect with Google" on `/admin/outbound/integrations`
   themselves to grant real send+read access — not yet done as of this
   writing.

Item 9 is code-complete on the Gmail path; what remains is the user
clicking through Google's consent screen once (cannot be done on their
behalf) and then switching Email Sending to `gmail` in
`/admin/outbound/integrations`.

## Rule

Finish one milestone's full arc (architecture → schema → prompt →
implementation → test) before starting the next. Do not parallelize
roadmap items across sessions.
