# Outbound Safety Policy

Produced by Post-Hardening Pilot Readiness Plan, Phase B. Reviews every
warning/check that runs on outbound email content or send eligibility and
classifies each as **ADVISORY** (shown, sending still allowed) or
**BLOCKING** (send route refuses, no way around it except fixing the
underlying issue). This is the enforcement contract — the code is the
source of truth, this document explains *why* each line is where it is.

Two enforcement layers exist for every BLOCKING check: `campaign-review.ts`
classifies a contact as `'blocked'` (kept out of the "Ready" bucket the
Review & Send UI lets you select), **and** the real send routes
(`send/route.ts`, `process-followup.ts`) re-check the same condition
directly. The UI classification alone would be bypassable by calling the
API directly — the route-level check is the real gate.

| # | Condition | Classification | Action | Reason | User override allowed? |
|---|---|---|---|---|---|
| B1 | Generic / non-specific personalization (`personalization-check.ts`) | ADVISORY | Badge on the draft in Outreach step | A weak/generic email is a quality problem, not a safety violation — the human reviewer decides whether it's good enough | Yes (implicit — nothing blocks it) |
| B2 | Weak/thin research evidence (`research-quality.ts`'s `auditResearchQuality`) | ADVISORY | Warning banner on Review & Send | "Review required," not "provably wrong" — the underlying pipeline already suppresses forced/fabricated content when evidence is genuinely insufficient (`insufficientEvidence` gate); this is a softer confidence signal on top of that | Yes |
| B3 | Reasonable inference vs. confirmed fact (`claim_type: 'inferred'` vs `'observed'`) | Visibility fix, not a gate | The generation prompt now explicitly hedges any `pain_points`/`opportunities` item marked `(unconfirmed inference)` — never presented as a confirmed fact. Was previously invisible to the LLM at generation time (stripped by `assemble-input.ts`); this phase restored it | N/A | N/A |
| B4 | Decision-maker company identity mismatch (`discovery_grounding_status`) | **BLOCKING** for `'conflict'` only. `'not_found'` stays ADVISORY | `checkCompanyIdentity()` in `send-eligibility.ts`, enforced in `campaign-review.ts` + `send/route.ts` + `process-followup.ts` | `'conflict'` is a positive, evidence-based contradiction (the candidate's name/title actively disagrees with the company's own scraped leadership page) — high confidence, low false-positive risk. `'not_found'` is an absence of evidence (most companies never get their leadership page scraped at all) — blocking on it would refuse the majority of otherwise-legitimate sends on no actual signal of a problem. This is a deliberate judgment call, not a literal reading of the plan's "cannot be adequately established" — see the code comment in `send-eligibility.ts` | **No** |
| B5 | Unsupported factual claim in the generated email | **BLOCKING** | `checkUnsupportedClaims()` in `claim-grounding.ts`, computed once at generation time, enforced in `campaign-review.ts` + `send/route.ts` | Scoped deterministically, not a general NLP fact-checker (Rule 2 — no new AI call; Rule 10 — don't expand the feature surface): flags a number/percentage stated in a sentence that names the researched company, when that number doesn't appear anywhere in the exact research data the email was generated from. Numbers are the highest-risk, most checkable hallucination class in this domain (see CLAUDE.md's own signal-confidence examples) | **No** |
| B6 | Invalid email (format) | **BLOCKING**. Missing email was already blocking before this phase | `checkEmailFormat()` in `send-eligibility.ts`, enforced in `campaign-review.ts` + `send/route.ts` + `process-followup.ts` | No format validator existed at all before this phase — only a presence check. A syntactically malformed address (`"not-an-email"`) previously sailed through to a real send attempt. Deliberately a simple syntax check, not full RFC 5322 or an MX/deliverability lookup — vendor-reported `email_confidence` ('low'/'none') already covers the deliverability-risk signal and stays advisory | **No** |
| B7 | Suppression list (unsubscribe, bounce, manual, negative reply) | **BLOCKING** (pre-existing, unchanged) | `isSuppressed()` checked in `provider-factory.ts`'s `sendEmail()` before any provider is called — the single choke point every real send path funnels through | Already correct before this phase; verified, not modified | **No** |
| B8 | Prior reply detected before a follow-up send | **BLOCKING** (pre-existing, unchanged) | `processFollowupForContact()` checks for a reply via Gmail thread polling before claiming/sending; a genuine reply returns `cancelled_reply` and the follow-up never sends | A reply means the prospect already responded — an automated follow-up landing after that reads as not paying attention | **No** |
| B9 | Duplicate send (concurrent claim, timeout retry, manual/automatic overlap) | **BLOCKING** (Phase A) | `claimCampaignContact()` — atomic conditional UPDATE, only one of any two racing callers can claim a row; an ambiguous (timeout) outcome is never rolled back to retry-eligible | Covered in full in Phase A of this plan — see that phase's end-of-phase report | **No** |

## Notes

- **B1/B2 are unchanged from before this phase** — the plan's own
  instruction was "keep advisory unless evidence shows unacceptable risk,"
  and no such evidence exists yet. Revisit after real pilot data if either
  turns out to correlate with a real bad outcome (a bounce, a complaint, a
  negative reply).
- **B4's `'not_found'` / B2's thin-evidence cases are exactly what Phase F's
  "F2 — Human quality review" step exists to catch** before the pilot's
  first real sends — this document doesn't claim every risk is closed by
  code, only that the ones cheap and reliable enough to enforce
  deterministically now are.
- Every BLOCKING check here is deterministic (regex/status-comparison), not
  a new LLM call — consistent with Rule 2 ("if a problem can be solved
  deterministically, solve it deterministically").
- A contact/draft with none of these fields computed yet (generated before
  this phase shipped) is treated as passing — the same graceful-degradation
  contract every other optional field in this codebase already uses. It
  will get a real `claimGroundingCheck` the next time its email is
  (re)generated.
