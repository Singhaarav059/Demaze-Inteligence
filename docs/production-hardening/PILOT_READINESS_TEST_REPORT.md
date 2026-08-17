# Demaze AI Outbound Intelligence Platform — Pilot Readiness Test Report

**Scope:** Post-Hardening Pilot Readiness Plan, Phases A–F1, plus the Phase
F2 review tool. This document is self-contained — written for an external
reader (or another model) with no access to the working session, so it
restates context rather than assuming it.

**Overall test suite status: 901/901 passing, `tsc --noEmit` clean**, as of
this report. All numbers below were captured by actually running the
suite, not estimated.

---

## 1. What this product is

An AI-driven B2B outbound platform: given a company, it researches the
company (scrape + multi-source enrichment + LLM synthesis), extracts
evidence-backed signals/pain-points/opportunities, finds real decision-maker
contacts (Prospeo), generates personalized outreach email (LLM, grounded in
the extracted evidence), and sends it (Gmail OAuth), with follow-up
automation, open tracking, bounce/reply/unsubscribe handling, and a
suppression list.

## 2. Why this test report exists

A prior hardening pass (`docs/production-hardening/FULL_REPORT.md`, Phases
1–10/12) found and fixed a real duplicate-send race condition, added a
kill switch, and added evidence provenance to the report. It explicitly
left several items **soft/unverified**: campaign pause, reply/bounce
stopping follow-ups, unsubscribe suppression, current Gmail OAuth token
state. A follow-on plan (`Demaze_Post_Hardening_Pilot_Readiness_Plan.md`)
was written to close those gaps and get the product to an actual
20–30-company real-world pilot. This report covers the execution of that
plan, phase by phase, with what was tested, how, and the result.

---

## 3. Test suite composition

| Category | Files | Assertions | Notes |
|---|---|---|---|
| Send-path concurrency (Phase A) | `campaign-review-blocking`, `claim-concurrency`, `claim-grounding`, `process-followup-concurrency`, `send-eligibility`, `send-route-concurrency` | 40 | Duplicate-send races, atomic claims, ambiguous-timeout handling, B4/B5/B6 safety-check enforcement at the route level |
| Safety-policy support (Phase A/B) | `gmail-client` (+3), `outbound-generation` (+5) | +8 | HTML email / tracking-pixel support in the MIME builder; generation-prompt grounding changes |
| Verification/hardening (Phase C) | `kill-switch-callers`, `process-followups-route-pause`, `suppression`, `process-followup-reply-bounce` | 12 | Kill switch checked before any DB/provider call; pause gate on the follow-up route; direct coverage of the suppression list (previously zero); the actual reply→cancel and bounce→suppress mechanism |
| Pilot observability (Phase D) | `pilot-funnel`, `pilot-funnel-route` | 12 | Pure funnel/failure aggregation logic + the route's real-data JOIN/shaping logic |
| Pilot data input (Phase E) | `file-parser-pilot-fields` | 5 | New optional `icpSegment`/`sourceListId` CSV columns, including a real header-collision bug found and fixed during this work |
| Pilot review (Phase F2) | `pilot-review-route` | 5 | GET (shaping/sorting/pilot-only filter) and PATCH (validation, 404, happy path) for the review-decision API |
| **Total new to this plan** | 14 new files + 2 extended | **82** | |
| Pre-existing suite (prior hardening + original build) | 60 files | ~819 | Unaffected — full suite re-run after every change in this plan, zero regressions at any point |

**Grand total: 901 tests, 74 files, 100% passing.** `npx tsc --noEmit` is
clean throughout — every phase in this plan was verified with both before
moving to the next.

---

## 4. Phase-by-phase report

### Phase A — Send-Path Concurrency Hardening
Found and fixed a real duplicate-send race condition (two overlapping
requests could both send to the same contact). Fixed with an atomic
conditional `UPDATE ... WHERE status = expectedStatus` claim
(`lib/outbound/sending/claim.ts`), shared by the manual send route and the
shared follow-up-send function, so there is exactly one implementation to
get right. Ambiguous Gmail-timeout outcomes are deliberately never rolled
back to retry-eligible (a genuine "did it send or not" case is left
claimed, flagged for human review, not risked as a possible duplicate).
Verified via `send-route-concurrency.test.ts`/`process-followup-concurrency.test.ts`
firing two overlapping requests at the same contact and asserting exactly
one real send occurs.

### Phase B — Hard vs Advisory Safety Policy
Reviewed every pre-send warning and classified each as ADVISORY (shown,
still allowed) or BLOCKING (no override). Documented in
`docs/outbound-safety-policy.md` with a full condition/classification/
action/reason/override table. Hard blocks: invalid email format, company-
identity conflict (not absence-of-evidence — a deliberate, documented
judgment call), unsupported factual claim in the draft, suppression list
membership, duplicate send. All hard blocks are enforced twice: once for
UI classification (`campaign-review.ts`) and again at the real send route
(`send/route.ts`, `process-followup.ts`) — the UI classification alone
would be bypassable by calling the API directly.

### Phase C — Verify Remaining Soft/Unconfirmed Items
Verified all 7 items the prior report left soft, each with code evidence +
a test + (where meaningful) a live check against real data:

- **C1 Campaign pause** — verified both real-send routes check
  `campaign.status === 'paused'` before touching any queued contact.
  Documented, accepted limitation: a pause mid-batch doesn't abort an
  already-fetched request's remaining loop iterations.
- **C2 Reply stopping follow-up** — verified via a new test that directly
  exercises the reply-detection branch (not just the downstream status
  exclusion): a detected reply short-circuits to `cancelled_reply`,
  `sendEmail()` is never called.
- **C3 Bounce suppression** — same mechanism as C2's branch; a bounce sets
  status `bounced` AND writes a real row to `outbound_suppression_list`.
  Test confirms the row is actually written and a subsequent lookup for
  that exact address returns suppressed.
- **C4 Unsubscribe suppression** — verified enforcement is real (the same
  `isSuppressed()` hard gate every send funnels through), but **there is
  no automatic detection** — unsubscribe is admin-entered only, a real
  product characteristic, documented rather than silently assumed.
- **C5 Gmail OAuth** — live-verified: queried the real `outbound_integrations`
  row, then ran a real (no-email-sent) token-refresh call against the
  currently stored credential — succeeded, token valid, no credential
  values ever appear in any error path.
- **C6 Tracking failure** — verified the auto-follow-up engine's
  `trackingConfigured` gate fails closed when `OUTBOUND_TRACKING_BASE_URL`
  is unset. **Found a real operational gap**: the var is currently set to
  a dead, ephemeral tunnel URL from an earlier ad hoc test — confirmed
  unreachable via a live curl. The code-level fail-closed contract is
  correct; a stale-but-present URL is a gap the code cannot see. Flagged,
  not code-fixed (config issue, and the automatic engine is unset/inactive
  regardless).
- **C7 Kill switch** — verified there is exactly one real-send chokepoint
  (`sendEmail()` in `provider-factory.ts`) by grepping every caller; new
  test proves the switch is checked before suppression lookup or provider
  resolution (both mocked to throw if reached — with the switch off,
  neither fires).

**One real finding not fixed, flagged for a decision**: `isSuppressed()`
fails OPEN (treats a DB read error as "not suppressed") — a documented,
deliberate design choice, but in tension with the plan's own Rule 6 ("fail
closed when suppression is uncertain"). Recommended for a decision before
the real pilot sends anything at scale.

Full detail: `docs/pilot-readiness-verification.md`.

### Phase D — Pilot Observability
Built a company funnel (companies entered → research completed → valid
opportunities → ICP matched → decision maker found → email found → QA
passed → approved → sent → replied), a failure funnel (relevance/evidence,
identity, ICP, people-data, email, QA, send, suppression), and a
per-company trace — all as pure aggregation over already-persisted data
(zero new taxonomy, reusing the exact same `checkEmailFormat`/
`checkCompanyIdentity` checks the real send routes enforce for "QA
passed"). Folded into the existing Outbound Overview page as a collapsible
panel rather than a new dashboard/nav entry.

**Real finding**: the richer per-stage gate-reasonCode taxonomy
(`GateReasonCode`: `NO_RELEVANT_CONTENT`, `SOURCE_FAILURE`, etc.) is
computed live during research but never persisted to `pipeline_test_runs`
— only `evidence_sufficiency`/`validation_warnings` are. The funnel uses
those coarser-but-persisted signals instead. Also: a genuinely-crashed
research attempt is never saved at all, so "research failure" can't be
counted from the DB alone — it requires diffing against the known pilot
input list (solved naturally once Phase E's list exists).

Live-verified against real production data: 198 real companies, correct
funnel counts (81 valid opportunities, 48 ICP matched, 24 decision maker
found, 21 email found, 20 QA passed, 9 approved, 8 sent), correct failure
breakdown, zero console errors.

### Phase E — Pilot Data Input
Extended the existing batch-upload parser (`lib/batch/file-parser.ts`,
already covering company name/website/industry/country) with two new
optional columns: `icpSegment` and `sourceListId`, carried through dedup
and displayed in both batch-upload UIs (Auto Flow, Research wizard).

**Real bug found and fixed**: a header literally named "List Name" was
being greedily claimed by the pre-existing `personName` field's bare
`'name'` fallback alias (which ran earlier in the column-matching priority
order) instead of the new `sourceListId` field. Fixed by reordering the
new, more-specific fields ahead of the generic fallback. Covered by a
named regression test plus a non-regression test confirming a genuine
"Full Name" person column still maps correctly.

Live-verified: uploaded a real CSV through Auto Flow's actual upload UI
(real file, real `DataTransfer` injection, real API call) — the new fields
rendered correctly under the company row.

### Phase F1 — 20–30 Company Real-World Pilot: Research
The user supplied a genuine 30-company target list (Indian automotive-
components manufacturers, SaaS companies, and financial institutions,
with website/industry/country/ICP-segment/source-list columns — nothing
invented or auto-selected, per the plan's explicit "do not invent
companies" / "do not automatically scrape a random list" rules).

Ran the real research + decision-maker-discovery pipeline against all 30
(one company individually validated end-to-end and cross-checked directly
against Postgres before committing quota to the remaining 29; then the
remaining 29 run as a background job hitting the exact same API routes
Auto Flow's own batch button calls — `test-analysis` → `test-runs` →
`decision-makers/discover` → `contacts`, same request/response shapes,
same quota-pause detection reused from `lib/batch/quota-pause.ts`).

**Result: 30/30 succeeded, zero failures, zero quota pauses.**
24/30 came back with sufficient evidence and real, evidence-quoted
opportunities (avg 3.0 per company). 6/30 (mostly the financial-services
companies) came back with insufficient evidence and correctly produced
zero forced/fabricated opportunities — a known, documented pipeline
characteristic (bank sites are dominated by customer-facing product copy,
which the evidence extractor correctly declines to treat as internal
operational pain). Decision-maker discovery found 1–25 real contacts per
company. All 30 runs and their contacts confirmed directly in Postgres,
not just via API response.

### Phase F2 — Human Quality Review (tool build, review itself pending)
Built `/admin/outbound/pilot-review`: a per-company review screen showing
company identity, industry/HQ/ICP segment/source list, "why this company,"
"why now," the strongest opportunity with its real evidence quote, and
every candidate stakeholder found — with Approve/Needs Work/Reject
controls plus an optional note, persisted via a new additive migration
(`025_pilot_review.sql`, 5 nullable columns on `pipeline_test_runs`,
applied to the live Supabase project with explicit confirmation first).
This tool records a decision; it does not gate or trigger anything
automatically — outreach generation and sending remain independently
gated by their own existing checks regardless of what's recorded here.

Live-verified: all 30 real companies render correctly with real data;
a real Approve click was round-tripped through to a live Postgres write,
confirmed, then reverted (it was a verification click, not a real
decision — the actual 30-company review is still pending the user's own
pass).

---

## 5. Live/production verification performed (not just unit tests)

This plan's own rules require verifying against real data wherever
practical, not just unit-testing in isolation. Beyond the 901 unit/route
tests above, the following were checked against the real, running
application and/or the real Supabase project:

- Real Gmail OAuth token refresh against the live stored credential (no
  email sent) — succeeded.
- Real `outbound_integrations`/`outbound_suppression_list`/
  `pipeline_test_runs` queries against production Postgres, at multiple
  points, to confirm code behavior matches actual stored state rather than
  trusting the API layer alone.
- Real curl against the configured tracking-pixel base URL — confirmed
  dead (a real operational finding, see Phase C6 above).
- Real browser sessions (not screenshots-only) exercising: the Pilot
  Funnel panel against 198 real companies, a real CSV upload through Auto
  Flow's actual file input, and the Pilot Review page against the real
  30-company pilot batch — including a real Approve click verified via a
  direct database read, then reverted.
- The full 30-company pilot research run itself — real Firecrawl/Tavily/
  LLM/Prospeo calls, not mocked, with every result cross-checked against
  Postgres.

## 6. Known gaps / open findings (not fixed, flagged for a decision)

1. **`isSuppressed()` fails open on a DB read error** (Phase C3/C4) — in
   tension with the plan's "fail closed" rule. Small, isolated fix if the
   decision is made to flip it.
2. **`OUTBOUND_TRACKING_BASE_URL` currently points at a dead URL** (Phase
   C6) — must be pointed at a real live origin before the automatic
   follow-up engine is ever enabled (it's currently unset/inactive, so
   this isn't live-impacting yet).
3. **Gate-level failure taxonomy (`GateReasonCode`) is not persisted**
   (Phase D) — the pilot funnel uses a coarser but real signal instead;
   full granularity would need a schema change, not done.
4. **Unsubscribe has no automatic detection** (Phase C4) — admin-entered
   only. A real product characteristic; worth a conscious decision on
   whether that's acceptable at pilot scale (it's plausible for 20–30
   companies, less so at larger scale).

## 7. Where this leaves the pilot

Research (F1) is done and verified for all 30 companies. The review tool
(F2) is built and verified against the real data, but the actual
human review pass — approve/reject/flag each of the 30 — has not been
done yet; that's a deliberate human checkpoint (Rule 7: human approval is
mandatory), not something automated on the user's behalf. Outreach
generation (F3), explicit batch approval (F4), and staged sending (F5)
have not started and will not start until the review pass is complete and
the user explicitly authorizes each subsequent step, per the plan's own
stop conditions.
