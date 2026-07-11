# Evidence Source Strategy

Status: DRAFT. Built from the manual benchmark-mapping review (2026-07-10) of Ace
Pipeline, Ador Welding, AS Agri and Aqua, AITG, A-1 Fence Products, and ATE Group —
see `SERVICE_TO_OUTREACH_MAPPING.md` for the service-line mapping this evidence feeds.
Pending review. Do not build the evidence-extractor rebuild against this until
reviewed — same sequencing constraint as `SERVICE_TO_OUTREACH_MAPPING.md`.

## Why this document exists

The benchmark review's central finding: **the bottleneck is evidence extraction, not
service mapping.** AITG manually qualified STRONG for two service lines (named SAP
modules in job postings, an explicit data-interpretation workshop) — but the live
pipeline extracted 0 signals for AITG. Ace Pipeline and A-1 Fence showed the same
gap: clear, STRONG-qualifying evidence existed in the scraped content, but the
current 20-pattern `SIGNAL_PATTERNS` regex library in `evidence-extractor.ts` never
matched it, because that library only looks for narrow phrase patterns on
about/homepage-style pages — it has no concept of job postings, named tools, or
named individuals as evidence sources at all.

This document defines *where* reliable evidence lives and *how much to trust it*,
so the eventual extractor rebuild targets real evidence sources instead of more
regex patterns on the same page types that already proved insufficient.

**Scope note (2026-07-10 reframe, see CLAUDE.md "Core reframe")**: this document
was written entirely from scraped-website evidence, since that's what the pipeline
currently ingests. The source tiers below are conceptually source-agnostic — a
"named leadership contact" or "facility count" is Tier 1 whether it comes from the
company's own site or from LinkedIn/news/investor calls. See the new entry under
Tier 1 for the external sources this reframe adds.

## Evidence Source Tiers

Distinct from — and a layer beneath — the content-pattern tiers already defined in
`CLAUDE.md`'s Research Standards section (facility counts vs. marketing adjectives).
This tiering is about the **page/document type the evidence comes from**, not the
phrase pattern within it. A fact can be Tier 1 by source and still need the content
itself to be a genuine fact rather than marketing copy — the two tiers work together.

### Tier 1 — High-reliability sources
Structural, legally-accurate, or objectively countable. Low false-positive risk.
These are documents the company had to write accurately for a purpose other than
marketing — a job requisition, a leadership bio, a facility list.

```yaml
Job postings:
  reliability: very high
  why: A hiring manager writing required skills for a real role has no incentive to
       exaggerate or use marketing language — "Knowledge of SAP (MM Module) is
       Mandatory" is either true or the posting is broken.
  benchmark_example: >
    AITG — two open roles ("DGM Materials/Purchase", "Head-Finance") explicitly
    require SAP MM and SAP FICO respectively. This single source alone confirmed an
    existing ERP deployment that no other page on the site mentioned anywhere.
  also_yields: >
    Internal workflow evidence via the responsibilities/duties list, not just the
    "required skills" line — see ATE Group example under Internal Operations below.

ERP/CRM/named-tool mentions (wherever they appear — job postings, press, about pages):
  reliability: very high
  why: A specific product name (SAP, Salesforce, Tableau, Oracle) is either present
       in the source text or it isn't — near-zero ambiguity, unlike a phrase like
       "data-driven" which could mean anything or nothing.
  benchmark_example: >
    AITG's SAP MM/FICO mentions (see above). Contrast: Ador Welding, A-1 Fence, and
    ATE Group show ZERO named tools anywhere in what was scraped — for companies
    this size, that is far more likely a scraper page-selection gap (job/careers
    pages weren't selected, or existing pages didn't mention tooling) than genuine
    absence of any ERP/CRM system.

Leadership responsibilities (named individual + explicitly stated portfolio):
  reliability: very high
  why: A stated title/portfolio on a bio page is a direct organizational fact, and
       is dramatically more useful for buyer targeting than a generic title guess.
  benchmark_example: >
    Ace Pipeline — Director Tarun Singh is explicitly described as heading "Bid
    Strategy, Business Development and New Technology/Innovation for the entire
    Group." AITG — Dr. Sunil Deshpande's title "Administrative Director" is a
    near-exact match for the cross-company coordination pain the group's own
    "About" copy describes.
  caution: >
    ATE Group surfaced a live data-quality bug on the company's OWN site: URL
    `/group-executive-lead/a-suresh-5` rendered the H1 "Anand Mehta" — a stale or
    reused URL slug. Never trust a name inferred from a URL path; only trust the
    name as it appears in the page's own rendered heading/body text.

Facility / location counts:
  reliability: very high
  why: An objectively countable, low-ambiguity fact once stated ("six manufacturing
       facilities", "nine locations").
  benchmark_example: >
    Ador Welding (6 manufacturing facilities), A-1 Fence (6 manufacturing units
    across India/Oman/UAE, 50+ countries served), ATE Group (6 business units, 9
    locations). All three cleared "strong" thresholds for Internal Operational
    Software purely on this source type, with zero internal tooling mentioned
    anywhere alongside the count.

External professional / financial sources (LinkedIn, investor-call transcripts,
executive-change announcements, financial databases):
  reliability: very high — added 2026-07-10, see CLAUDE.md "Core reframe"
  why: A company's own website is frequently stale or incomplete on exactly the
       facts these sources track continuously — who currently holds a role
       (LinkedIn beats an outdated "About" page), quarterly financial performance
       and forward guidance (investor calls), and leadership changes (news/
       announcements, often before the website itself is updated). These are
       first-party or heavily-vetted third-party facts, not inference.
  benchmark_example: >
    Ador Welding specifically — its own site's scraped content was almost entirely
    financial-disclosure listing pages (annual reports, dividend notices), not
    substantive About/leadership content. The company can be far better profiled
    through LinkedIn, investor-call transcripts, and news coverage than through
    adorwelding.com's own scraped pages.
  implementation_status: >
    NOT YET INGESTED. `lib/enrichment/source-prioritizer.ts`'s `isFetchable()`
    explicitly skips LinkedIn and Glassdoor today ("requires auth"). Investor
    calls / executive-change news are reachable in principle via the existing
    Tavily/Serper discovery queries but aren't a dedicated query category yet
    (`discovery-engine.ts`'s `QueryCategory` is `investor | hiring | expansion |
    strategy` — no explicit "leadership change" or "earnings call" category).
```

### Tier 2 — Moderate-reliability sources
Real signal, but requires interpretation rather than being a stated fact on its own.
Corroborate with a Tier 1 source where possible before treating as a strong signal.

```yaml
Workshops, training programs, consultant engagements:
  reliability: moderate — strong indirect signal, but inferential
  why: Describes an event, not a stated fact about ongoing capability. The company
       telling us "we ran a workshop" implies a felt gap, but requires a reasoning
       step ("they brought in an outside consultant to teach manual data
       interpretation" -> "they lack a reporting tool") rather than being the fact
       itself.
  benchmark_example: >
    AITG — "Workshop on Interpreting Data and Understanding Variation," a full day,
    external consultant, senior management from two group companies, "Statistical
    as well as Experience Based Exercises," "every participant present with a
    laptop." This is the strongest single piece of evidence found in the entire
    review, but it is still an inference away from "AITG lacks a BI/reporting
    layer" — which is why it sits in Tier 2 rather than Tier 1 despite being
    highly persuasive.

Press articles / interview headlines about the company (not written by the company):
  reliability: moderate, and sometimes unresolvable without the full article
  why: Could be genuinely about the company's own operations, or could be generic
       industry commentary the company is merely quoted in or linked to.
  benchmark_example: >
    Ador Welding's own "Media and Events" section links a headline: "Advanced
    digital welding technologies are powering a manufacturing boom... integrated
    software and AI are driving profitability, despite challenges in implementing
    them on the shop floor." This COULD be Ador describing its own shop-floor AI
    struggles — or generic trade-press commentary Ador merely linked to. The
    scraper captured only the headline, not the article body, so this could not be
    resolved either way in this review. Treat as Tier 2 pending the actual article
    content, never promote to Tier 1 on a headline alone.

Supply chain / dealer network / field team / compliance mentions:
  reliability: moderate (carried over from CLAUDE.md's existing Tier 2 definition)
  why: Real operational detail, but usually descriptive rather than confirming a
       specific gap or tool.
```

### Tier 3 — Low / near-zero-reliability sources
Marketing copy. Should not move confidence or opportunity scoring on its own.

```yaml
Pure marketing/promotional language:
  reliability: near zero
  why: No cost to the company to write "world-class," "innovative," "cutting-edge"
       whether or not it's true — carries no evidentiary weight.
  benchmark_examples:
    - "world-class products" (Ador Welding)
    - "Global Brand. Global Solutions" / "Certified Protection. Proven to Perform"
      (A-1 Fence)
    - "cutting-edge technology and an expert team" (Ace Pipeline)
    - "value-driven, world class group, spearheading innovative and sustainable
      solutions" (ATE Group)
    - "revolutionary technology," "most reliable and trusted company" (AS Agri and
      Aqua — notable because this was almost the ONLY content available for this
      company; see Insufficient Evidence below)
  rule: >
    This matches CLAUDE.md's existing standard and is restated here for
    completeness — do not re-litigate, just enforce it consistently when the
    extractor is rebuilt. Still unverified whether `scorer.ts` actually suppresses
    this today (open item from the prior session).
```

## Evidence Categories

A taxonomy of *what the evidence is about*, orthogonal to the source tiers above (a
single piece of evidence has both a source tier and a category). Use these
categories to organize evidence before it's mapped to a service line in
`SERVICE_TO_OUTREACH_MAPPING.md`.

```yaml
Internal Operations:
  definition: >
    How the company runs itself day-to-day — multi-site coordination, internal
    process steps, administrative structure.
  benchmark_examples:
    - ATE Group's job posting for "Sr. Executive – Design (Mechanical and Piping)"
      lists an actual multi-step internal process by hand: drawings -> BOQ checks
      -> P&ID review -> compliance/audit -> procurement handoff, plus "check and
      implement new software as required" (implies no unified system).
    - AITG's "About" copy: the 7-company group exists specifically to "bring about
      synergy in administrative activities of the group companies" — a stated
      cross-entity coordination need, distinct from a single company's multi-plant
      reporting gap.
    - Ace Pipeline's many concurrent nationwide project sites (DVPL, KG-D6,
      Vashishta, Subhanshari river crossing) imply — but do not state — a
      site-to-HQ coordination need.

Technology Stack:
  definition: >
    Named software/systems the company already runs internally (ERP, CRM, BI
    tools, industry-specific platforms).
  benchmark_examples:
    - AITG's SAP MM + SAP FICO (the clearest example in the entire review).
    - Ador Welding, A-1 Fence, ATE Group: ZERO named tools found. For companies of
      this scale, treat this as "likely a scraper gap" rather than "confirmed no
      tooling exists" — this category is disproportionately dependent on Tier-1
      job-posting sources being scraped at all, which none of these three had
      selected in this benchmark run.

Reporting & Analytics:
  definition: >
    Evidence of a data-consolidation or visibility gap — data existing somewhere
    but not being systematically used.
  benchmark_examples:
    - AITG's data-interpretation workshop (clearest example; see Tier 2 above).
    - Ador Welding / A-1 Fence: inferred from multi-facility-with-no-BI-tool-named,
      weaker than AITG's direct evidence because it requires stacking two absences
      (no tool named AND scale implies a need) rather than one stated event.

Hiring Signals:
  definition: >
    Open roles, their required skills, and their described responsibilities —
    doubles as both a hiring/growth signal AND (via the responsibilities list) an
    Internal Operations / Technology Stack evidence source.
  benchmark_examples:
    - AITG's 4 open roles (DGM Materials/Purchase, Head-Finance, Company Secretary,
      Officer-HR&Admin), 2 of which name specific SAP modules.
    - ATE Group's Sr. Executive Design posting (see Internal Operations above).

Expansion Signals:
  definition: >
    Growth, new facilities, new markets, revenue/scale milestones.
  benchmark_examples:
    - Ace Pipeline: "34+ years... 3500+ km of pipeline... more than 40 Projects."
    - A-1 Fence: "10X growth" as a stated vision, operations spread across 6 units
      and 50+ countries.
    - ATE Group: "85+ years of growth," TeraSpin's acquisition of SKF India's
      textile-components business.

Customer Offerings:
  definition: >
    What the company sells or provides TO its customers — products, services,
    solutions. This category exists specifically so it can be EXCLUDED from
    internal-pain reasoning; see the hard rule below.
  benchmark_examples:
    - Ace Pipeline's "Pipeline Integrity Management" page describes a service Ace
      SELLS to clients (risk assessments, inspection plans, maintenance
      procedures) — not evidence of Ace's own internal workflow.
    - A-1 Fence's FenSense / Liminal-F products (smart intrusion detection systems)
      — customer-facing product line, not internal AI/tooling need.
    - ATE Group's EcoAxis / SuperAxis™ (an Industrial IoT analytics platform ATE
      itself sells to its customers) — not evidence that ATE has strong internal
      analytics for its OWN 6-business-unit reporting.
    - Ador Welding's welding automation solutions and cobots — products sold to
      customers, not evidence of Ador's own shop-floor automation maturity.
```

## Hard Rule: Customer-facing evidence is not internal-pain evidence

**Evidence describing what a company sells or provides to its customers must never
be treated as evidence of that company's own internal operational pain.** This is
the single most concrete false-positive risk the benchmark review surfaced, and it
appeared in 3 of 6 companies:

- Ace Pipeline's Pipeline Integrity Management service copy is marketing to
  *clients*, not a description of Ace's own broken process.
- A-1 Fence sells "smart"/"AI"-branded detection products; that is not evidence A-1
  Fence needs AI internally.
- ATE Group runs an Industrial IoT analytics *business unit* (EcoAxis); that is not
  evidence ATE Group has strong internal analytics for its own cross-business-unit
  executive reporting — it's a different system serving a different (external)
  audience entirely.

**Practical test:** does the sentence describe what the company does *for its
customers*, or what the company does *inside its own operations*? "We help
customers manage X" / "Our platform enables clients to Y" / a dedicated
products/solutions page → Customer Offerings, excluded. "Our team processes X
manually" / "we are deploying Y internally" / a job posting's own responsibilities
list → Internal Operations or Technology Stack, included.

**Implementation note (not being built now):** `evidence-extractor.ts` already has
a `classifySubject()` function that distinguishes `product_capability` /
`customer_use_case` (customer-facing) from `company_operations` /
`company_strategy` / `internal_technology` (internal). The eventual rebuild should
reuse that existing distinction rather than invent parallel logic — it already
solves most of this problem structurally, it just isn't wired into
`SERVICE_TO_OUTREACH_MAPPING.md`'s evidence patterns yet.

## New Outcome: "Insufficient Evidence"

Today, every company gets *some* service-fit output, even when the underlying
content can't support one. The benchmark review's clearest example: **AS Agri and
Aqua** — a single-page Google Sites site, no employee count, no facility count
beyond two farm sites, no first-person operational language anywhere
(`companySubjectCount: 0`), and the only concrete forward-looking signal is a
"SHOP WITH US (coming soon)" line — prospective, not live, ecommerce.

Manually applying `SERVICE_TO_OUTREACH_MAPPING.md` to this company, nothing clears
even the "weak" threshold reliably. Forcing a recommendation anyway — inventing an
outreach angle off a single "coming soon" mention — would read as presumptuous, not
sharp, and would misrepresent how little is actually known about this company.

**Proposed trigger conditions** (draft, needs review):
```yaml
Insufficient Evidence fires when:
  - Zero Tier 1 evidence items found across all 8 service lines, AND
  - Fewer than ~3 total evidence items (any tier) found, AND
  - Effectively single-page content (no distinct sub-pages scraped, or all scraped
    pages are near-duplicates of the homepage)
```

**What the report should do instead of forcing a fit:** explicitly state
"insufficient evidence for a confident service-fit recommendation" — surfacing
whatever thin evidence does exist (company identity, industry, the "coming soon"
mention) without manufacturing a Demaze Fit / Stakeholder / Outreach Angle out of
it. This is consistent with — and should reuse — the PARTIAL validation-gate work
already shipped in `app/api/admin/test-analysis/route.ts` (AS Agri already returns
`PARTIAL` today for exactly this reason at the pipeline-status level; this outcome
extends the same "don't force it" principle to the service-mapping layer
specifically).

## Summary table — source reliability quick reference

| Source | Tier | Category it usually feeds |
|---|---|---|
| Job posting requirements | 1 | Technology Stack |
| Job posting responsibilities | 1 | Internal Operations |
| Named ERP/CRM/tool mention (any page) | 1 | Technology Stack |
| Leadership bio with stated portfolio | 1 | Internal Operations (buyer targeting) |
| Facility/location counts | 1 | Internal Operations, Reporting & Analytics |
| Workshop / training / consultant engagement | 2 | Reporting & Analytics |
| Press headline/interview (company not the author) | 2 (verify before trusting) | varies — resolve before use |
| Supply chain / dealer network / compliance mentions | 2 | Internal Operations |
| Products/solutions pages, "we help customers..." copy | — | Customer Offerings (excluded from internal-pain reasoning) |
| Marketing adjectives ("world-class," "innovative") | 3 | none — near-zero weight |
