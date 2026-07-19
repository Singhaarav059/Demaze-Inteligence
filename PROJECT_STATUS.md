---
tags: [demaze, status-tracker, moc]
updated: 2026-07-14
---

# Demaze Intelligence Engine — Project Status

> [!info] What this is
> A **map of content (MOC)** — the hub note that links out to each area's own status note, so the graph view actually shows how the pieces relate instead of one giant flat page. The full engineering log (root causes, benchmark numbers, the "why" behind every call) stays in [[CLAUDE]]; each note below is the tick-marked summary layered on top of it.

## What this product is (one paragraph)
A **Company Intelligence Engine** for Demaze outbound sales, expanding (2026-07-14 scope pivot, extended same day) toward the full explee.com (AutoGTM) 6-phase loop: research → competitors → ICP → company discovery → decision-maker discovery → outreach send. Core input remains a company + a named buyer that arrived pre-decided from a Sales Navigator export; the 4-step core (**find website → enrich → find problem → AI research**) is unchanged and already built. The output schema is no longer locked to exactly 5 fields. Contact-level discovery and email generation/send are now in-scope goals (Phase 2 items 8-9) but blocked on vendor decisions (a people-data API, a sending-infra provider) not yet made — see [[Left To Do]].

## Status at a glance

| Area | Status | Note |
|---|---|---|
| Scope & architecture decisions | 🟡 Fully reopened 2026-07-14 (two decisions same day — see note) | [[Scope and Architecture Decisions]] |
| Phase 2 — competitor/ICP/company-discovery/quality/eval/market/outreach/contacts/send | 🔴 Not started, architecture-first; items 8-9 also blocked on vendor picks | [[Left To Do]] |
| Phase 1 — pipeline engineering (items 1–7) | 🟢 Complete (1 live-run check open) | [[Phase 1 - Pipeline Engineering]] |
| Classifier & extraction bug fixes | 🟢 Done, real-data validated | [[Classifier and Extraction Fixes]] |
| UI, export & this session's code review | 🟢 Done, 10/10 findings fixed | [[UI Export and Code Review]] |
| Known issues (unresolved bugs) | 🔴 5 open | [[Known Issues]] |
| Left to do (planned/unbuilt work) | 🟡 Backlog | [[Left To Do]] |

## Notes in this vault
- [[Scope and Architecture Decisions]] — the locked calls: output schema, scope boundary, LinkedIn exclusion, model-quality verdict, what got demoted/deleted and why
- [[Phase 1 - Pipeline Engineering]] — Items 1–7: website discovery, parallel enrichment, PDF fetching, opportunity engine rebuild, buyer-field removal, batch upload
- [[Classifier and Extraction Fixes]] — the `primary_type` cascade bug, URL short-keyword bug, `SIGNAL_PATTERNS` coverage gaps, all found via real-data validation
- [[UI Export and Code Review]] — mobile nav, admin redesign, brief PDF/Word export, and the same-day code review that found and fixed 10 issues in that work
- [[Known Issues]] — 5 open, reproduced-but-not-yet-root-caused bugs (A-1 Fence, Muthoot Finance, AS Agri, Ace Pipeline, ATE Group, benchmark file mismatch)
- [[Left To Do]] — Item 4, `anchor-text-scorer.ts`, the deferred `detectPageType` fix, the never-written URL-classifier test matrix, and longer-horizon architecture items

## Other reference docs (ground truth, not status)
- [[DEMAZE_CAPABILITY_MAP]] — the 8 confirmed service lines
- [[SERVICE_TO_OUTREACH_MAPPING]] — Evidence → Pain → Why Demaze → Outreach Angle per service
- [[EVIDENCE_SOURCE_STRATEGY]] — source-fetching strategy
- [[FRONTEND_REDESIGN]] — the redesign plan [[UI Export and Code Review]] implemented
- [[CLAUDE]] — the full detailed engineering log this whole vault summarizes
