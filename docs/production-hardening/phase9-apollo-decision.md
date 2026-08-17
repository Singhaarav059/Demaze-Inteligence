# Phase 9 — Apollo Decision

## Step 9.1 — Real Prospeo baseline (live-measured, real credits spent)

Explicit user confirmation given first ("spend a small amount of Prospeo
credits now"). Ran through the app's own real API routes (not a
throwaway script) against a real company already in run-history:

**Decision-maker discovery** — `POST /api/admin/outbound/decision-makers/discover`
against Flipkart (flipkart.com):
```
Latency:    7,154ms
Provider:   prospeo
Candidates: 25
Titles:     all "Director" (board-registry-shaped, not operational
            executives — see "Coverage/accuracy notes" below)
```

**Email finder + enrichment** — created one real contact from a
candidate above (Nikhil Gupta, Director), then
`POST /contacts/{id}/find-email`:
```
Latency:      3,946ms
Provider:     prospeo
Email found:  nikhil.gupta@flipkart.com
Email status: VERIFIED (Prospeo's own verification, not just "found")
```

The same single call also returned, for free (Prospeo's unified
`enrich-person` endpoint, per this repo's own architecture — confirmed by
reading the raw response): full job history (11 prior roles), company
funding history ($3.0B total, 3 rounds with dates/amounts), employee count
(94,386 / "10000+" range), revenue range ($1B-$5B), a 40-item technology
stack, and industry/location data. This matches CLAUDE.md's own
documentation that Prospeo's endpoint is unified (email + enrichment in
one call, one credit), not two separate lookups.

## Coverage/accuracy notes (real, not projected)

- Decision-maker search returned 25 candidates but **every one carried the
  generic title "Director"** — likely Prospeo's search matched against a
  formal board/directorship registry rather than operational leadership
  (VP Engineering, Head of Ops, etc.). For Demaze's actual use case
  (finding a relevant operational buyer, not a board director), this is a
  real precision gap worth noting — not a coverage failure (25 real names
  came back), but a relevance one.
- Grounding (`lib/outbound/decision-maker-discovery/grounding.ts`) showed
  0/25 confirmed — but this test call didn't pass `leadershipContacts`
  (the company's own scraped leadership evidence), so this is an artifact
  of the test call's own scope, not a real finding about grounding
  accuracy. Not counted as a Prospeo weakness.
- The one email-finder test returned a `VERIFIED` (not just "found")
  email on the first real attempt — a strong single data point, not
  enough to claim a reliable verification rate from n=1.

## Step 9.2 — Apollo comparison: still blocked, unchanged from prior sessions

Per CLAUDE.md's existing, already-verified findings (not re-tested this
session — no reason to re-spend quota confirming an unchanged plan
restriction): Apollo's Organization Search and People Match both return
`403 API_INACCESSIBLE` on the current Basic/Trial plan — confirmed
against real Apollo API calls in a prior session, not just documentation.
**Upgrading the Apollo account is a real subscription cost** — this
repo/session has no visibility into Apollo's current pricing tiers or
what the user is willing to spend, so no upgrade was attempted or
recommended as a fait accompli.

## Step 9.3 — Decision rule (recommendation, not a unilateral action)

Given the real baseline above:

- Prospeo already delivers, in ONE call: name, title, seniority, LinkedIn
  URL, a verified email, and rich firmographic/technographic enrichment —
  functionally covering both Apollo capabilities (Organization Search +
  People Match) that are currently plan-blocked anyway.
- Apollo's own documented advantage (per CLAUDE.md) was never actually
  about coverage — it was evaluated as a possible SECOND data source for
  cross-verification/higher volume, not a replacement. That evaluation
  can't happen at all while the account remains plan-blocked.
- **Recommendation**: do not upgrade Apollo's plan based on this baseline
  alone. Prospeo is already doing real, verified work at good latency
  (3-7s per call) with zero additional cost beyond what's already being
  spent. If Apollo is reconsidered later, the real trigger should be a
  measured Prospeo *gap* (e.g., a real company where Prospeo consistently
  returns nothing, or the "everything comes back as Director" precision
  issue proving to be a widespread pattern across the real target list)
  rather than a speculative "more coverage might help."
- **The one real, cheap thing worth doing regardless of the Apollo
  question**: the "everything is Director" title-genericness finding is
  worth watching across a few more real searches before concluding
  anything — flagged here as a real observation from this session's data,
  not something fixed or further investigated given the "small amount of
  credits" scope.

## Live test data left in place

One real contact record was created during this test (Nikhil Gupta /
Flipkart, `outbound_contacts` id `f369579f-22d9-47e4-a658-cfe388849921`)
— left in the database rather than cleaned up mid-verification, matching
this repo's own established precedent for live-verification artifacts
(clearly attributable, harmless, easy to delete later if wanted).

## Phase completion report

```
PHASE: 9 — Apollo Decision
STATUS: Complete

Changed:
- None (no code changes this phase — pure measurement + decision writeup)

Tests:
- N/A (no code changed)

Failures:
- None

New files:
- docs/production-hardening/phase9-apollo-decision.md (this file)

Database changes:
- One real outbound_contacts row created during live testing (see above)

External dependencies:
- Real Prospeo credits spent: 1 decision-maker search (25 candidates),
  1 email-finder+enrichment call — explicit user confirmation given first

Known limitations:
- n=1 for email-finder accuracy — not enough to claim a reliable
  verification rate, just a real positive data point
- Apollo's plan-block was not re-tested this session (unchanged from
  prior sessions' confirmed findings, no reason to re-spend quota)
- No Apollo plan upgrade attempted or recommended — that remains the
  user's own cost decision

Next phase:
- Phase 10 — Product UX Simplification (center the UI around the six
  "why" questions, evidence display cards, uncertainty labels)
```
