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
7. **Outreach Intelligence Layer** — COMPLETE (2026-07-23). Field-naming
   reconciled against this doc (`trigger`→`why_contact`,
   `problem`→`likely_problem`, `service`→`recommended_service`,
   `opening_angle`→`conversation_angle`), no rebuild needed —
   `OutreachIntelligence` in `lib/pipeline/analysis-sections.ts`, populated
   by `lib/prompts/analyze-v2.ts`, rendered in `ResearchCard.tsx`.
8. **Decision-maker discovery (Explee phase 5)** — COMPLETE. Vendor decision
   made (Prospeo Search Person endpoint), provider built and wired into the
   standard `lib/outbound/decision-maker-discovery/` provider-factory
   pattern, candidates grounded against scraped leadership evidence, and
   user-confirmed working via a real live test (2026-07-28). See
   `DECISIONS.md`. Known remaining gaps (not blockers): the standalone
   `/admin/outbound/contacts` page can't ground candidates from runs saved
   before the grounding field existed; phone/mobile enrichment via Prospeo
   is deliberately not wired (extra per-lookup cost, needs its own decision).
9. **Outreach send (Explee phase 6)** — COMPLETE. Reversed 2026-07-29 from
   Lemlist (paid) to Gmail (OAuth, free) at the user's explicit request —
   see `DECISIONS.md`'s "Outreach send" section for the full reversal
   history. **Fully live-verified, not just code-complete**: the user
   completed the Google OAuth consent click-through, a real send succeeded,
   and real cross-account reply detection (including idempotent event
   recording) was confirmed against a real Gmail thread (2026-07-29).

Phases 1-9 of the original Explee-parity roadmap are now all COMPLETE. See
"Phase 3" below for what was built on top of that once outreach send went
live.

## Phase 3 — Outbound execution modules + post-send automation

Built across several sessions after the Phase 2 loop closed, once Gmail
sending was live. Full detail in `DECISIONS.md`; this section is status
only.

- **Outbound Workflow Modules (2026-07-17/18)** — Email Finder, Email
  Validation, Contact Enrichment, Generation (subject lines/email/
  follow-ups), Email Sending, Email Warm-Up. Each follows one standard
  provider-abstraction pattern (`lib/outbound/<module>/{types.ts,
  provider-factory.ts, providers/{mock,<vendor>}.ts}`), selected per
  capability via `/admin/outbound/integrations`. **Prospeo** is the vendor
  for Email Finder, Contact Enrichment, and Decision-maker Discovery (item
  8 above) — live and user-confirmed working. Sending is Gmail (item 9
  above). Warm-Up's real provider is the DIY engine below, not a vendor.
- **DIY Gmail warmup engine (2026-08-04/05)** — replaced the original
  fully-mocked warmup dashboard with a real OAuth-pool engine: connects the
  user's own multiple Gmail accounts, ticks on a schedule (manual button or
  `WARMUP_ENGINE_ENABLED` autonomous scheduler, off by default), sends
  between pool mailboxes with a ramping daily cap, and processes the
  recipient side (spam-rescue, mark-read, probabilistic reply) after a
  randomized delay. Both the send half and the recipient half are now
  live-verified against real Gmail data (2026-08-10) — see `DECISIONS.md`.
- **Open tracking + automatic follow-up engine (2026-08-05)** — a tracking
  pixel records real opens; a second autonomous engine
  (`FOLLOWUP_ENGINE_ENABLED`, off by default) auto-sends the next follow-up
  step ONLY for contacts confirmed unopened past the cadence, failing
  closed (skips entirely) if tracking isn't configured. Auto Flow gained a
  5th step ("Track & Follow Up") and a persistent per-company pipeline
  list. Both halves of the auto-send gating logic (withhold-if-opened,
  send-if-unopened-and-due) are live-verified against real sends
  (2026-08-10).
- **SEC EDGAR enrichment source (2026-08-04)** — built, free, no API key.
  **India's MCA registry explicitly ruled out** — no public API exists,
  only a CAPTCHA-gated portal; not something this codebase will build
  around. A paid third-party aggregator (Probe42/Tofler/Zauba) would be a
  separate future vendor decision if this is ever wanted.
- **Mobile "app-like" pass (2026-08-04)**, admin product only (public
  landing page untouched by choice): PWA manifest + real app icons, safe-area
  support, and a persistent bottom tab bar replacing the old hamburger drawer.
- **Standing exclusions, reconfirmed (2026-08-04)**: LinkedIn scraping/
  automation stays excluded regardless of any of the above. Mobile/phone
  enrichment via Prospeo stays deliberately unwired (real per-lookup cost).

## Rule

Finish one milestone's full arc (architecture → schema → prompt →
implementation → test) before starting the next. Do not parallelize
roadmap items across sessions.
