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
9. **Outreach send (Explee phase 6)** — vendor decided AND implemented
   2026-07-28 (Lemlist — dedicated cold-outreach platform with built-in
   warmup and reply webhooks, see `DECISIONS.md`). Sending provider,
   settings UI, and a reply/open/click webhook receiver are all built,
   tested (`tsc`+full suite clean), and live-UI-verified. **Not yet
   live-verified against a real Lemlist account** — still needs the user to
   create a Lemlist account, generate an API key, and manually build a
   merge-tag campaign template (Lemlist has no API for writing sequence
   content) before any real send can happen. Migration
   `014_outbound_campaign_events_provider_id.sql` also needs to be applied
   manually in the Supabase dashboard, same as every prior migration.

Item 9 is code-complete; what remains is entirely account-side setup the
user has to do themselves (Lemlist signup, API key, campaign template) plus
running the one pending migration — not further engineering work.

## Rule

Finish one milestone's full arc (architecture → schema → prompt →
implementation → test) before starting the next. Do not parallelize
roadmap items across sessions.
