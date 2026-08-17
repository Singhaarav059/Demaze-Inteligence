# Demaze AI — Post-Hardening Execution Plan
## Pilot Readiness, Send Safety, Validation & Real-World Proof

**Purpose:** This is the next execution instruction for Claude Code after completion of the Production Hardening Master Plan.

The previous hardening pass is already complete for Phases 1–10 and 12. Do NOT repeat that work.

The project is now at the point where the remaining value comes from:
1. hardening the real send path,
2. closing remaining safety gaps,
3. verifying soft/unconfirmed behavior,
4. preparing pilot instrumentation,
5. running a controlled real-world pilot,
6. measuring what actually works,
7. fixing the biggest measured bottleneck.

---

# 1. Current Baseline

The previous hardening pass established:

- 820 tests passing
- clean TypeScript/typecheck
- clean production build
- scrape relevance engine implemented
- machine-readable pipeline gate reasons implemented
- standalone opportunity gate implemented
- deterministic evidence provenance implemented
- evidence/inference distinction surfaced in UI
- generic personalization warning implemented
- decision-maker identity grounding persisted through send review
- global outbound kill switch implemented
- campaign/follow-up duplicate-send race condition fixed with atomic DB claiming
- benchmark failure taxonomy implemented
- Prospeo live-tested
- UX six-question framework surfaced in production components

The detailed hardening report confirms these changes and identifies the remaining gaps.

**Do NOT undo or unnecessarily rewrite these systems.**

---

# 2. Permanent Apollo Decision

## Apollo is OUT OF SCOPE for now.

Do not:

- upgrade Apollo
- test Apollo
- spend Apollo credits
- improve Apollo integration
- troubleshoot Apollo plan restrictions
- design fallback logic around Apollo
- recommend Apollo during this execution phase

Treat Apollo as a dormant/non-essential integration.

**Prospeo is the active people-data provider.**

Only revisit Apollo in a future project decision if explicitly authorized by the user.

Do not let Apollo block any part of the current pilot.

---

# 3. New Strategic Objective

The objective is no longer:

> Build more Demaze features.

The objective is:

> Prove that the existing Demaze system can safely identify strong prospects, explain why they are worth contacting, identify an appropriate decision maker, produce evidence-backed outreach, and generate measurable real-world outbound outcomes.

The central loop is:

```text
Target company
    ↓
Research
    ↓
Evidence
    ↓
Operational signal
    ↓
Problem
    ↓
Opportunity
    ↓
Relevant stakeholder
    ↓
Evidence-backed outreach
    ↓
Human approval
    ↓
Safe send
    ↓
Reply / outcome
    ↓
Measurement
    ↓
Learning
```

Do not optimize vanity metrics such as "number of agents" or "number of features."

---

# 4. Execution Rules

## Rule 1 — Do not repeat completed work

Read the existing implementation and hardening report before making changes.

If something already exists and works, verify it rather than rebuilding it.

## Rule 2 — Do not add unnecessary AI

If a problem can be solved deterministically, solve it deterministically.

## Rule 3 — Do not add vendors

No new scraping provider, LLM provider, CRM, email provider, or people-data provider.

## Rule 4 — LinkedIn remains permanently excluded

Do not add LinkedIn scraping, automation, enrichment, or workarounds.

## Rule 5 — Apollo remains completely deferred

No Apollo work during this plan.

## Rule 6 — Sending must fail closed

When safety, identity, suppression, or deduplication is uncertain, do not send.

## Rule 7 — Human approval remains mandatory

No batch send may become autonomous simply because the technical capability exists.

## Rule 8 — Do not fake pilot results

If real target companies or real outcomes are unavailable, document the blocker. Never generate simulated business results and present them as real.

## Rule 9 — Every discovered bug becomes a regression test where practical

Especially for the send path.

## Rule 10 — Stop expanding the feature surface

The product already has enough functionality to validate the thesis.

---

# 5. PHASE A — SEND-PATH CONCURRENCY HARDENING

## Objective

The previous hardening pass found and fixed a real duplicate-send race condition.

That fix must now be attacked with tests.

The fact that the bug was discovered by code inspection rather than automated testing means the send path needs stronger adversarial testing.

## Step A1 — Inspect the actual send architecture

Find every path that can eventually reach a real Gmail send.

Build a map:

```text
manual send
campaign send
batch send
follow-up send
automatic follow-up engine
retry paths
scheduled jobs
```

Identify the single real-send choke point and all callers.

Do not assume there is only one caller.

## Step A2 — Test concurrent campaign sends

Create tests where two requests attempt to send the same queued contact simultaneously.

Expected:

```text
Request A → claims contact → sends
Request B → cannot claim → does NOT send
```

Expected total real-send operation:

```text
1
```

not:

```text
2
```

## Step A3 — Test concurrent follow-ups

Run the same concurrency test against the shared follow-up-send implementation.

Test:

- two workers
- two HTTP requests
- manual + automatic follow-up
- two browser tabs
- retry while another request is processing

## Step A4 — Test timeout ambiguity

Simulate:

```text
DB claim succeeds
Gmail send begins
Gmail response times out
```

Determine how the system behaves.

Do NOT blindly reset to "queued" if Gmail may actually have accepted the message.

Design the safest existing-compatible behavior.

If the system cannot know whether the external send happened, make that state explicit rather than risking a duplicate send.

Use an existing equivalent state if available; do not create unnecessary state names.

## Step A5 — Test retries

Test:

```text
send succeeds
request fails after send
client retries
```

The retry must not send a duplicate.

## Step A6 — Test campaign overlap

Test:

```text
Campaign A processing
+
automatic follow-up engine processing
```

against the same contact.

Only one process may claim the eligible record.

## Step A7 — Test pause races

Test:

```text
contact queued
→ send worker starts
→ campaign paused
```

Define and implement the safest behavior supported by the existing architecture.

The system must not accidentally continue processing a batch that the user has explicitly stopped.

## Step A8 — Add permanent regression tests

All discovered race conditions must remain permanently covered.

## Acceptance criteria

The send system must demonstrate:

- no duplicate send from concurrent claims
- no duplicate send from retry
- no duplicate send from manual + automatic overlap
- no duplicate follow-up
- suppression cannot be bypassed by concurrency
- pause/stop behavior is deterministic
- ambiguous external-send outcomes are not silently treated as safe-to-retry

---

# 6. PHASE B — HARD VS ADVISORY SAFETY POLICY

## Objective

Review every warning that currently appears before sending and decide whether it should be:

```text
ADVISORY
```

or:

```text
BLOCKING
```

Do not change policy blindly. First inspect current implementation and tests.

## B1 — Generic personalization

Keep advisory unless evidence shows weak personalization creates unacceptable risk.

A weak email is primarily a quality problem, not necessarily a safety violation.

## B2 — Weak evidence

Keep as:

```text
REVIEW REQUIRED
```

unless the email contains a factual claim that cannot be supported.

## B3 — Reasonable inference

Keep visible as:

```text
Reasonable inference
```

Do not present inference as confirmed fact.

## B4 — Decision-maker company mismatch

Hard block.

If:

```text
contact.company != targetCompany
```

or company identity cannot be adequately established:

```text
BLOCK SEND
```

## B5 — Unsupported factual claim

Hard block.

If the email contains a factual statement about the prospect that cannot be grounded in evidence:

```text
BLOCK SEND
```

## B6 — Invalid email

Hard block.

## B7 — Suppression

Hard block.

This includes:

- unsubscribe
- bounce
- negative reply
- explicit stop
- suppressed contact
- suppressed company

## B8 — Prior reply

Automatically stop follow-up.

Do not send another automated follow-up unless the user explicitly initiates a new outreach action.

## B9 — Duplicate

Hard block.

## B10 — Produce a policy matrix

Create:

```text
docs/outbound-safety-policy.md
```

with:

```text
Condition
Classification
Action
Reason
User override allowed?
```

Do not allow user override for:

- suppression
- invalid email
- company identity mismatch
- duplicate send
- unsupported factual claim

---

# 7. PHASE C — VERIFY REMAINING SOFT/UNCONFIRMED ITEMS

The previous report distinguished verified, soft/unverified, and deferred items.

Verify only the important production behaviors that affect the pilot.

Do NOT re-audit the entire codebase.

## C1 — Campaign pause

Verify:

```text
pause campaign
→ queued messages stop processing
```

## C2 — Reply stopping follow-up

Verify:

```text
reply detected
→ pending follow-up is cancelled/stopped
```

## C3 — Bounce suppression

Verify:

```text
bounce
→ contact suppressed
→ future follow-up blocked
```

## C4 — Unsubscribe suppression

Verify:

```text
unsubscribe
→ permanent suppression
→ future sends blocked
```

## C5 — Gmail OAuth

Verify:

- current token state
- refresh behavior
- expired token behavior
- reauthorization behavior
- failure behavior
- no credential leakage

If the existing environment currently has an expired testing-mode token, do not fake a success. Document the exact state and minimum action required before real sending.

## C6 — Tracking failure

Verify that missing/broken tracking does not cause unsafe follow-up behavior.

The system should fail closed where tracking is required to make a follow-up decision.

## C7 — Kill switch

Verify:

```text
OUTBOUND_SEND_ENABLED=false
```

blocks every real-send route.

Test all callers, not just one API endpoint.

## C8 — Produce a verification report

Create:

```text
docs/pilot-readiness-verification.md
```

For every item:

```text
Status:
Evidence:
Test:
Result:
Remaining action:
```

---

# 8. PHASE D — PILOT OBSERVABILITY

## Objective

Before sending real pilot emails, make it easy to answer:

> What happened to every company and every email?

## D1 — Company funnel

Track:

```text
companies entered
research completed
research warnings
valid opportunities
ICP matched
decision maker found
email found
email QA passed
approved
sent
delivered
replied
positive reply
meeting
```

## D2 — Failure funnel

Track:

```text
research failure
relevance failure
evidence failure
identity failure
ICP failure
company match failure
people-data failure
email failure
QA failure
send failure
suppression
```

Use the existing failure taxonomy.

Do not create a second competing taxonomy.

## D3 — Per-company trace

Every pilot company should have:

```text
Company
Why this company
Why now
Evidence
Opportunity
Why this person
Email
QA status
Send status
Outcome
```

## D4 — Campaign outcome tracking

Track:

```text
sent
delivered
bounced
spam if observable
opened if configured
replied
positive reply
negative reply
unsubscribe
meeting
```

Do not treat opens as the primary business metric.

## D5 — Pilot dashboard

If the existing UI can display these metrics without major redesign, add a focused pilot view.

Do not build a new analytics platform.

---

# 9. PHASE E — PILOT DATA INPUT

## Objective

Make it easy to provide a real 20–30 company target list.

Reuse the existing spreadsheet/batch-upload flow where possible.

The pilot list should contain, where available:

```text
company name
company website
industry
country
optional ICP/segment
optional source/list identifier
```

Do not require unnecessary fields.

Do not invent companies.

Do not automatically scrape a random list for the pilot.

The pilot must use a genuine target list supplied by the user/business.

---

# 10. PHASE F — 20–30 COMPANY REAL-WORLD PILOT

## Main milestone

Start with:

```text
20–30 highly relevant target companies
```

The exact list must come from the user/business.

## F1 — Research

For each:

- verify company identity
- inspect strongest evidence
- inspect opportunity
- inspect confidence
- inspect why-now signal
- inspect recommended stakeholder

## F2 — Human quality review

Before sending, manually inspect every pilot contact.

Confirm:

```text
right company
right problem
right evidence
right stakeholder
right email
right outreach angle
```

This is temporary validation, not the final operating model.

## F3 — Generate outreach

Emails must:

- use real evidence
- avoid unsupported claims
- avoid fake personalization
- match the stakeholder
- be concise
- have a clear reason for contact
- represent Demaze accurately

## F4 — Explicit approval

No pilot batch may send without explicit user confirmation.

## F5 — Staged sending

Do not immediately send all 20–30.

Use:

```text
Batch 1: 5
observe
review

Batch 2: 5–10
observe
review

Batch 3: remaining approved prospects
```

Require explicit confirmation before each real batch under the existing safety model.

## F6 — Follow-up

Do not enable aggressive automatic follow-up immediately.

First verify:

- replies stop follow-ups
- bounces suppress
- unsubscribe suppresses
- campaign pause works
- state transitions are correct

Then use the existing follow-up cadence conservatively.

---

# 11. PHASE G — MEASURE REAL OUTCOMES

## Primary metrics

The most important metrics are:

```text
positive reply rate
meeting rate
qualified opportunity rate
```

## Secondary metrics

```text
delivery rate
bounce rate
open rate
negative reply rate
unsubscribe rate
```

## Intelligence quality metrics

```text
evidence accuracy
opportunity relevance
stakeholder accuracy
email factual accuracy
personalization quality
```

Do not optimize for open rate alone.

An email being opened is not proof that Demaze created good outbound.

---

# 12. PHASE H — PILOT FAILURE ANALYSIS

After the pilot, categorize every failure.

Example:

```text
HIGH RESEARCH QUALITY
+
LOW POSITIVE REPLY
=
possibly wrong ICP / offer / timing / positioning
```

```text
LOW RESEARCH QUALITY
=
fix retrieval/relevance/evidence
```

```text
HIGH RESEARCH QUALITY
+
WRONG STAKEHOLDERS
=
fix role mapping / people data
```

```text
HIGH TARGETING QUALITY
+
LOW DELIVERY
=
fix deliverability
```

```text
HIGH DELIVERY
+
HIGH OPENS
+
LOW REPLIES
=
message / offer / targeting problem
```

Do not automatically solve every outcome problem with a new LLM prompt.

---

# 13. PHASE I — DECIDE WHAT TO FIX AFTER THE PILOT

Rank issues using:

```text
impact
×
frequency
×
ease of correction
```

Only fix the top bottlenecks.

Examples:

If research accuracy is weak:
→ improve retrieval/relevance/evidence.

If decision makers are weak:
→ improve Prospeo filtering/role matching.

If emails are factually strong but replies are weak:
→ investigate ICP, offer, positioning and timing.

If delivery is weak:
→ investigate sending/domain/mailbox configuration.

Do not add features before understanding the bottleneck.

---

# 14. PHASE J — EXPAND EVALUATION ONLY AFTER PILOT LEARNING

The original plan called for 100 companies.

Do NOT blindly execute that now.

After the 20–30 company pilot:

1. Review failure distribution.
2. Add representative difficult cases.
3. Expand the benchmark toward 50.
4. Eventually reach 100 if additional coverage provides value.

The final dataset should contain:

```text
normal companies
non-English companies
multinationals
subsidiaries
similar-name companies
weak websites
regional websites
JavaScript-heavy websites
companies with sparse evidence
different target industries
real target prospects
```

The benchmark should become a living regression/evaluation suite.

---

# 15. PILOT READINESS GATE

Do not declare Demaze pilot-ready until:

## Research

- [ ] relevant sources are selected
- [ ] wrong-company content is rejected
- [ ] evidence is traceable
- [ ] non-English content does not silently fail
- [ ] zero-result stages have reasons

## Intelligence

- [ ] opportunities have evidence or are explicitly marked inference
- [ ] stakeholder reasoning is visible
- [ ] company identity is correct

## Outreach

- [ ] unsupported claims are blocked
- [ ] wrong-company contacts are blocked
- [ ] invalid emails are blocked
- [ ] generic personalization is visible as a warning
- [ ] evidence/inference is visible

## Sending

- [ ] explicit approval required
- [ ] global kill switch works
- [ ] suppression works
- [ ] duplicate protection works under concurrency
- [ ] retries cannot cause duplicates
- [ ] reply stops follow-up
- [ ] bounce stops follow-up
- [ ] unsubscribe suppresses future contact

## Authentication

- [ ] Gmail OAuth state is known
- [ ] required reauthorization is completed before real sending
- [ ] credentials are protected

## Measurement

- [ ] every company has a trace
- [ ] every send has an event
- [ ] outcomes are recorded
- [ ] failures have categories

---

# 16. WHAT CLAUDE MUST NOT DO

Do not:

- work on Apollo
- upgrade Apollo
- spend Apollo credits
- add LinkedIn
- add another LLM
- add another scraper
- add another people provider
- add another email provider
- build a CRM integration
- build a huge analytics platform
- redesign the whole UI
- create fake pilot data
- send emails without explicit approval
- enable unrestricted autonomous outbound
- hide warnings to make metrics look better
- weaken tests
- remove safety checks
- rewrite working architecture for style reasons

---

# 17. STOP CONDITIONS

Stop implementation and report to the user when:

### Business decision required

Examples:

- which companies to pilot
- whether to send a batch
- whether to change target ICP
- whether to change the outbound offer

### Real vendor spending required

Do not spend automatically.

### Real email sending required

Never treat code execution as permission to send.

### Production environment change could materially affect outbound

Explain the change and require explicit confirmation where appropriate.

---

# 18. REQUIRED END-OF-PHASE REPORT

After every phase, output:

```text
PHASE:
STATUS:

What I inspected:
- ...

What I changed:
- ...

Tests added:
- ...

Tests run:
- ...

Results:
- ...

Production verification:
- ...

Risks:
- ...

Remaining blockers:
- ...

Next phase:
- ...
```

Do not claim success without evidence.

---

# 19. FINAL SUCCESS DEFINITION

The project succeeds when Demaze can take a real list of target companies and reliably produce:

```text
Company
↓
Why this company
↓
Why now
↓
Evidence
↓
Operational problem
↓
Demaze opportunity
↓
Right stakeholder
↓
Evidence-backed outreach
↓
Human approval
↓
Safe send
↓
Reply/outcome
```

and the system can explain exactly what happened at every stage.

The goal is not to prove that Demaze can send emails.

The goal is to prove:

> **Demaze can identify the right companies, find a defensible reason to contact them, reach the right person safely, and generate meaningful outbound outcomes.**

---

# 20. START HERE

Begin with:

## PHASE A — Send-Path Concurrency Hardening

Do not start the real pilot yet.

First:

1. Inspect every real-send path.
2. Build adversarial concurrency tests.
3. Test retries and ambiguous Gmail outcomes.
4. Test manual/automatic overlap.
5. Test suppression under concurrency.
6. Test campaign pause races.
7. Add permanent regression coverage.
8. Run the full test suite.
9. Report the results.

Then proceed sequentially through Phases B, C, and D.

**Do not proceed to real sending until the pilot-readiness gates are satisfied and the user has supplied a real target-company list and explicitly approved the send operation.**
