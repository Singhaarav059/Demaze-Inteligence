# Demaze Capability Map

Status: CONFIRMED service list (given directly), draft mapping to problems/evidence.
The 8 service lines below are ground truth, not inferred. Everything mapped to them
(evidence examples, problem-fit) is still draft until reviewed.

## Confirmed services (source: given directly, this is the authoritative list)
```yaml
1. AI-powered business applications
2. Custom SaaS platforms
3. Ecommerce ecosystems
4. Marketplace platforms
5. Workflow automation systems
6. Internal operational software
7. Analytics and reporting systems
8. AI integrations and intelligent automation
```
This list REPLACES the inferred bucket structure from the earlier draft. Any prior
mention of "Virtual CTO / Embedded Team Model" as a distinct service line was
speculation from a single proposal's framing — treat it as a positioning choice
Demaze sometimes uses, not a 9th service line, unless told otherwise.

## Mapping known delivered work to the confirmed service lines
(This mapping is still draft — it's my inference of which known engagement fits
which official service line, not confirmed line-by-line.)

```yaml
AI-powered business applications:
  - AI-powered dealer/sales intelligence system (automotive dealer network)
  - AI-powered ad video generation platform

Custom SaaS platforms:
  - Revenue analytics platform for D2C brands (own product)
  - Personal health records application (own product)

Ecommerce ecosystems:
  - E-commerce app work incl. India-specific payment integration (Razorpay over Stripe)

Marketplace platforms:
  - Hyperlocal commerce / marketplace platform
  - Quick-commerce delivery platform
  - Prediction market / event-contract trading platform

Workflow automation systems:
  - Complaint/lifecycle management system (industrial manufacturing client)
  - WhatsApp chatbot / microservices tender (telecom)

Internal operational software:
  - Multi-location operational reporting tools (as a component of larger engagements)

Analytics and reporting systems:
  - Revenue/traffic dashboards
  - Business-value translation (technical capability -> quantified client outcomes)

AI integrations and intelligent automation:
  - Influencer marketing multi-dashboard platform
  - CRM/Sales Navigator workflow advisory
```

## Legacy positioning — explicitly out of scope now
Older directory listings (LinkedIn, Crunchbase, TheOrg) describe a much broader,
more generic scope: general web/mobile app development, computer vision/NLP/"data
science" as standalone lines, game development (Unity/Unreal), digital marketing.
None of that appears in the confirmed 8-service list above. Treat the directory
listings as stale — likely leftover from the company's earlier (2021-era) phase —
and do not let the pipeline classify or score companies against those legacy
categories.

## What's still genuinely unconfirmed
(The 8 service lines themselves are now confirmed — these are the remaining gaps.)
- Which of the 8 confirmed service lines generates the most revenue vs. which is
  highest-effort lowest-return
- Whether "Virtual CTO / embedded team" is a positioning device used on some
  proposals, or should be treated as absent entirely from outreach copy
- Whether the engagement-to-service-line mapping above is correct — it's my
  inference of which known project maps to which official line, not confirmed
  by anyone at Demaze

## Draft — Ideal Customer Problems (by problem, not just industry)
```yaml
Manufacturing / Industrial:
  - Multi-plant/multi-facility coordination and visibility gaps
  - Manual, delayed plant-to-HQ reporting
  - Legacy systems with no AI-driven decision support

D2C / E-commerce:
  - Analytics fragmentation, no unified revenue/traffic view
  - India-specific payment gaps (Stripe invite-only)

Dealer / Distribution Networks:
  - Sales intelligence not surfaced at the individual-dealer level
  - Siloed inventory/service data vs. sales opportunity

Regulated-adjacent platforms (fintech, trading, marketplaces):
  - Need jurisdiction-aware, phased-delivery architecture

SMBs with informal ops:
  - No CRM, tracking via spreadsheets/WhatsApp
  - Founder-dependent decision-making, no dashboard layer
```

## Output schema — see CLAUDE.md "Output schema" for the current authoritative
## version (2026-07-11). No buyer/stakeholder field — every real lead row already
## has a named person and title attached (Sales Navigator export); this pipeline
## does not generate or rank buyers. The schema below is superseded, kept only for
## historical reference:
```yaml
Company:
Signals:
Likely Problems:
Demaze Fit:
Outreach Angle:
Confidence:
```

## What would move this from draft to confirmed
Someone at Demaze (whoever owns this decision) reviewing:
1. The "evidence_strength: high/medium/low" buckets above — correcting anything wrong
2. Whether the "legacy" bucket should be dropped entirely or kept for specific segments
3. Actual revenue mix across the buckets, if known

Until that review happens, treat every "Demaze Fit" this pipeline generates as a
hypothesis, not a fact — the confidence field in every report should reflect that.
