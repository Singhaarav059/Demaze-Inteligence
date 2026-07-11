# Service-to-Outreach Mapping

Status: DRAFT. The 8 service lines are confirmed ground truth (see
DEMAZE_CAPABILITY_MAP.md). Everything below — evidence signals, pain inference,
disqualifiers, thresholds, buyer titles, outreach angles — is a first-pass
construction and needs review before the opportunity engine is rebuilt against it.

This is the blueprint `generateDeterministicOpportunities()`, the challenge engine,
and stakeholder mapping should target. Don't rebuild that code until this file is
reviewed — same sequencing constraint as before.

**Evidence source note (2026-07-10 reframe, see CLAUDE.md "Core reframe")**: every
"Evidence" field below was written and validated against the company's own scraped
website content, since that's what the pipeline currently ingests. That is a
current-implementation artifact, not a design constraint — the same evidence
categories (named tools, leadership portfolios, facility counts, workshop/training
signals) are equally valid, and sometimes stronger, when found via LinkedIn,
investor-call transcripts, news coverage, or third-party company data. Don't read
"scraper/evidence-extractor" below as "website only."

## How to read each entry
```yaml
Service:            # one of the 8 confirmed lines
Evidence:            # what the scraper/evidence-extractor needs to find (from the
                     # website OR from other researched sources — see note above)
Disqualifiers:       # negative evidence — presence of this should SUPPRESS the fit,
                     # not just fail to add points. Prevents every company getting
                     # every service.
Likely Pain:         # the operational problem the evidence implies
Why Demaze:          # the specific capability that addresses it (not generic)
Threshold:           # weak / medium / strong — gates whether this should even
                     # surface in the report, not just how confident it is
Buyer:
  Primary:           # decision-maker who'd actually greenlight this
  Secondary:         # co-sponsor / budget holder
  Influencer:        # shapes the decision but doesn't sign off
Outreach Angle:       # one sentence, usable as a first-line opener
```

All buyer titles below are inferred from typical org structures for each problem
type — NOT confirmed from actual closed deals. Treat as a starting hypothesis,
correct once real win data is available.

---

## 1. AI-powered business applications

```yaml
Evidence:
  - Mentions of manual decision-making processes (approvals, scoring, triage)
  - Sales/ops teams described as large or distributed (dealer networks, field teams,
    regional offices)
  - Existing but clearly manual "intelligence" work (market research, lead scoring,
    competitive analysis mentioned as a role/department)
  - No AI/ML mentioned anywhere on the site despite scale that would benefit from it

Disqualifiers:
  - Company already has a named in-house AI/data science team of meaningful size
  - Very small company (<10 employees) with no distributed team structure —
    unlikely to have a decision-support gap worth solving at this scale

Likely Pain:
  - Decisions (sales prioritization, lead scoring, resource allocation) made on
    gut feel or spreadsheets instead of systematic intelligence
  - Field/dealer/distributed teams not getting consistent guidance from HQ

Why Demaze:
  Custom AI application built around the specific decision the team already makes
  manually — not a generic "AI strategy" pitch.

Threshold:
  weak: company mentions "data-driven" as marketing language only
  medium: distributed sales/ops structure exists, no AI/automation mentioned
  strong: explicit manual process described (e.g. "our team reviews X manually") + scale

Buyer:
  Primary: Head of Sales / VP Sales Operations
  Secondary: CTO / Head of Technology
  Influencer: Regional/Field Ops leads (feel the pain directly, escalate it)

Outreach Angle:
  "With a network this size, how is lead/opportunity prioritization currently
  handled across regions — manually, or is there a system doing it?"
```

---

## 2. Custom SaaS platforms

```yaml
Evidence:
  - Company describes a workflow, process, or dataset that's clearly internal/
    proprietary and not served by off-the-shelf software
  - Mentions of "we built our own tool" or "internal system" in a job posting or
    about page
  - A recurring, structured business process specific to their vertical
    (e.g. inventory reconciliation specific to their product type)

Disqualifiers:
  - Company IS a SaaS company itself in the same space Demaze would build for —
    competitor, not customer
  - Evidence only shows generic, already-commoditized needs (basic CRM, basic
    accounting) well served by existing off-the-shelf tools

Likely Pain:
  - No software fits their specific operational model; using spreadsheets or
    disconnected tools to patch the gap
  - Growth is being slowed by a process that doesn't scale without custom tooling

Why Demaze:
  Build the vertical-specific platform from scratch, informed by direct delivered
  experience building products like Srota (D2C analytics) and Amret AI (health records).

Threshold:
  weak: generic "we use spreadsheets" mention, no scale indicator
  medium: described proprietary process + growth signal (hiring, expansion)
  strong: explicit statement of a process/tool gap blocking a stated business goal

Buyer:
  Primary: Founder / CEO (especially at SMB/mid-size)
  Secondary: CTO / Head of Product (if one exists)
  Influencer: Ops lead who owns the broken process day-to-day

Outreach Angle:
  "Is [specific process you found evidence of] still running on spreadsheets, or
  has that moved to a dedicated tool?"
```

---

## 3. Ecommerce ecosystems

```yaml
Evidence:
  - Company sells products online (own storefront, not just marketplace listing)
  - India-based D2C brand — Stripe unavailability is a near-universal pain point
  - Mentions of multiple sales channels (own site + marketplaces + social commerce)
  - No analytics/attribution language on the site despite clear online sales activity

Disqualifiers:
  - Pure B2B company with no direct-to-consumer online sales at all
  - Enterprise-scale ecommerce already running well-known platforms (Shopify Plus
    custom builds, etc.) with visible sophisticated tooling — lower-priority target,
    not a disqualifier but should lower confidence

Likely Pain:
  - Fragmented view across channels (own site, marketplaces, social)
  - Payment friction specific to the Indian market (Stripe invite-only)
  - No unified attribution/analytics across the funnel

Why Demaze:
  Full ecommerce ecosystem build or extension — checkout, payments (Razorpay
  integration expertise), multi-channel data unification — informed by direct
  Aavak.in and Srota delivery experience.

Threshold:
  weak: company has a website with a "shop" page, no other signal
  medium: multiple sales channels evident, India-based
  strong: explicit growth/expansion language + fragmented-channel evidence

Buyer:
  Primary: Founder / Head of Growth
  Secondary: CTO (if technical co-founder exists)
  Influencer: Marketing lead (feels the attribution gap most directly)

Outreach Angle:
  "Running sales across [own site + marketplaces] usually means the revenue picture
  is scattered across three dashboards — worth seeing what a unified view looks like?"
```

---

## 4. Marketplace platforms

```yaml
Evidence:
  - Explicit two-sided language: buyers AND sellers, vendors AND customers,
    drivers AND riders, etc.
  - Mentions of onboarding a network of partners/vendors/merchants
  - Commission/transaction-based language rather than direct-sale language
  - Hyperlocal or category-specific commerce framing

Disqualifiers:
  - Purely manufacturing/industrial company with no network-effect business model
  - Single-sided ecommerce (direct sales only, no vendor/partner network)
  - No mention of any third-party sellers, vendors, or service providers at all

Likely Pain:
  - Managing a growing two-sided network without a platform built for it
    (onboarding, matching, payments, trust/reviews)
  - Manual vendor/partner coordination that doesn't scale

Why Demaze:
  Marketplace-specific architecture (two-sided matching, vendor onboarding, trust
  systems) — informed by direct LAONI (hyperlocal commerce) and quick-commerce
  platform delivery experience.

Threshold:
  weak: mentions "partners" once, no structural two-sided language
  medium: clear vendor/seller network described, unclear platform maturity
  strong: explicit scaling pain — "onboarding partners" as a stated challenge/goal

Buyer:
  Primary: Founder / CEO
  Secondary: Head of Operations / Head of Partnerships
  Influencer: Whoever manages vendor relationships day-to-day

Outreach Angle:
  "As the vendor/partner side grows, is onboarding and matching still handled
  manually, or is there a platform doing that already?"
```

---

## 5. Workflow automation systems

```yaml
Evidence:
  - Explicit description of a multi-step internal process (approvals, complaints,
    service tickets, order lifecycle)
  - Words like "our team processes/handles/manages" describing a repetitive task
  - Compliance or SLA language implying tracked but manual steps
  - Multiple departments/teams mentioned as touching the same process

Disqualifiers:
  - Very small team (<15 people) — workflow complexity unlikely to justify
    a dedicated automation build yet
  - Process already described as "automated" or "system-driven" explicitly

Likely Pain:
  - Manual handoffs between teams/steps causing delay or errors
  - No visibility into where a request/ticket/order currently sits in the process
  - Compliance/SLA tracking done manually, risk of missed deadlines

Why Demaze:
  Purpose-built workflow/lifecycle management system — direct delivered evidence:
  complaint/lifecycle management system for an industrial manufacturing client.

Threshold:
  weak: generic mention of "customer service process," no complexity signal
  medium: multi-step process described, multiple teams involved
  strong: explicit pain language — delays, errors, compliance risk mentioned

Buyer:
  Primary: COO / Head of Operations
  Secondary: Quality/Compliance lead (if process is compliance-adjacent)
  Influencer: Customer service / process owner (feels the friction daily)

Outreach Angle:
  "How many hand-offs does a [complaint/order/ticket] go through before it's
  resolved today — and is that tracked automatically or manually?"
```

---

## 6. Internal operational software

```yaml
Evidence:
  - Multiple facilities, plants, offices, or locations mentioned
  - Language implying HQ needs visibility into distributed operations
  - Mentions of manual reporting cadence ("monthly reports," "weekly updates")
  - No internal tooling/dashboard mentioned despite multi-location structure

Disqualifiers:
  - Single-location business with no distributed structure at all
  - Explicit mention of an existing internal operational system/ERP already in place
    and described as working well

Likely Pain:
  - HQ lacks real-time visibility into what's happening at individual locations
  - Reporting is manual, delayed, and inconsistent across sites
  - No single source of truth for operational status across the business

Why Demaze:
  Custom internal operations platform — direct delivered evidence: complaint/
  lifecycle system, dealer network reporting work (Volvo Pulse AI engagement).

Threshold:
  weak: "multiple locations" mentioned once, no reporting-gap language
  medium: 3+ locations/facilities confirmed, no visible internal tooling
  strong: explicit reporting-delay or visibility-gap language, or facility count >=5

Buyer:
  Primary: COO
  Secondary: VP Operations / Plant Operations Head
  Influencer: CFO (cares about reporting accuracy/timeliness for financial reasons)

Outreach Angle:
  "Coordinating reporting across [N] locations usually means someone's stitching
  together updates manually each week — worth 15 minutes to see how that gets automated?"
```

---

## 7. Analytics and reporting systems

```yaml
Evidence:
  - Multiple business units, regions, or locations (same evidence as #6, different pain)
  - Dealer/distributor/franchise network mentioned
  - Data mentioned as existing but not "used" (raw sales data, raw traffic data)
  - No mention of dashboards, BI tools, or reporting infrastructure at all

Disqualifiers:
  - Company explicitly names a mature BI/analytics stack already in use
    (e.g. "powered by Tableau," "our data team uses Looker")
  - Single-location, single-product business too small to have a reporting
    consolidation problem

Likely Pain:
  - Data exists in silos (per-location, per-channel, per-department) with no
    unified view
  - Decisions made without timely access to consolidated numbers

Why Demaze:
  Custom reporting layer / operational dashboards — direct delivered evidence:
  Srota (D2C analytics), Volvo Business Value Brief work translating capability
  into quantified outcomes.

Threshold:
  weak: mentions "data" or "insights" as marketing language only
  medium: multiple locations/units + data existence implied, no BI tool named
  strong: multiple locations/units confirmed AND no BI tool named AND scale
    (dealer network, regional offices) suggests real consolidation pain

Buyer:
  Primary: COO
  Secondary: Operations Head / Regional Ops Lead
  Influencer: Finance Controller (cares about numbers accuracy and speed)

Outreach Angle:
  "How are you currently consolidating operational data across [locations/regions/
  dealers] — manually, or is there a system doing it?"
```

---

## 8. AI integrations and intelligent automation

```yaml
Evidence:
  - Existing tools/systems named (CRM, ERP, e-commerce platform) that could be
    connected/enhanced with AI, but no such integration mentioned
  - Repetitive content/communication tasks described (marketing content, customer
    responses, reporting narratives)
  - Company already has digital infrastructure (website, app, CRM) — the base
    layer AI integration needs already exists

Disqualifiers:
  - No digital infrastructure at all yet (this service needs something to
    integrate INTO — pair with Custom SaaS Platforms instead if starting from zero)
  - Company already names a specific AI integration/tool in active use for the
    same function

Likely Pain:
  - Existing tools operate in isolation; no AI layer connecting or enhancing them
  - Repetitive content/analysis work still done manually despite being automatable

Why Demaze:
  Targeted AI integration into existing stack — direct delivered evidence:
  AI ad video generation platform, influencer marketing multi-dashboard platform.

Threshold:
  weak: company just mentions "AI" as a buzzword with no specific tool/process
  medium: named existing tools (CRM/ERP) with an obvious automatable gap nearby
  strong: explicit repetitive-task description (e.g. "our team creates X content
    weekly") + existing digital infrastructure to integrate into

Buyer:
  Primary: CTO / Head of Technology
  Secondary: CMO / Head of Marketing (if integration is content/campaign-facing)
  Influencer: Whoever owns the specific repetitive task day-to-day

Outreach Angle:
  "Is [named tool/process] connected to anything AI-driven yet, or still a manual
  step in the workflow?"
```

---

## What this file still needs before the opportunity engine is rebuilt against it
1. Correction of buyer titles against real closed-deal data, once available
2. Validation that the disqualifiers actually prevent false positives on the
   existing benchmark set (run the 6 benchmark companies through this mapping
   manually and check nothing gets a service it obviously shouldn't)
3. A decision on what happens when a company clears the threshold for 3+ services
   at once — does the report show all of them ranked, or force a single top pick?
   Not yet decided.
4. Confirmation that the Threshold tiers (weak/medium/strong) map cleanly onto the
   existing Confidence field, or whether they're a separate gating layer that runs
   before confidence scoring even starts (recommended: gating layer — a service that
   doesn't clear "weak" shouldn't appear in the report at all, regardless of
   confidence score)
