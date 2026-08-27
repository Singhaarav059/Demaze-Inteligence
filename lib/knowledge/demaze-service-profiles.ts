// ============================================================
// Demaze Service Profiles — structured, extensible knowledge config
// ============================================================
// One entry per each of the 8 CONFIRMED Demaze service lines
// (DEMAZE_CAPABILITY_MAP.md). `problemsSolvedConfidently` /
// `typicalCompanyCharacteristics` / `preferredOutreachAngle` are copied
// verbatim from SERVICE_TO_OUTREACH_MAPPING.md's "Likely Pain" / "Evidence"
// / "Outreach Angle" fields — this file is the machine-readable counterpart
// of that doc, not a second independent source. opportunity-engine.ts reads
// its per-service narrative content from here instead of a second hardcoded
// copy.
//
// Fields marked NEEDS_DEMAZE_INPUT genuinely don't exist anywhere in the
// codebase yet (verified against DEMAZE_CAPABILITY_MAP.md,
// SERVICE_TO_OUTREACH_MAPPING.md, and lib/sales-knowledge/*) — do not
// guess these. When Krupal supplies them, replace the sentinel with real
// content; nothing else needs to change, since every consumer of this file
// reads through its exported shape only.
//
// `idealBuyerPersona` is deliberately NOT the same thing as the standing
// "buyer identity is input, not generated" rule in CLAUDE.md — that rule
// covers rows that already arrive with a named contact attached (Sales
// Navigator exports). This field is Demaze-side ICP/targeting config for
// the no-contact-given company-discovery + decision-maker-discovery flow,
// where deciding which TITLES to search for is a real, already-built
// capability (lib/outbound/decision-maker-discovery/types.ts's
// `targetTitles`) that currently has no service-specific guidance to draw
// on.
//
// exampleEngagements/proof-point linkage is deliberately NOT built here —
// DEMAZE_CAPABILITY_MAP.md already marks the engagement-to-service-line
// mapping as unconfirmed ("not confirmed by anyone at Demaze"); adding a
// second automatic tag-matching guess in this file would be exactly the
// kind of invented mapping this system is supposed to avoid. See that
// doc's "Mapping known delivered work to the confirmed service lines"
// section for the existing (draft) version of that mapping.
// ============================================================

export const NEEDS_DEMAZE_INPUT = 'NEEDS_DEMAZE_INPUT' as const
export type NeedsDemazeInput = typeof NEEDS_DEMAZE_INPUT

export interface DemazeServiceProfile {
  service: string
  problemsSolvedConfidently: string[]
  problemsNotSolved: string[] | NeedsDemazeInput
  idealBuyerPersona: string[] | NeedsDemazeInput
  typicalCompanyCharacteristics: string[]
  strongestTriggers: string[] | NeedsDemazeInput
  preferredOutreachAngle: string
  projectFitRange: { min: string; max: string } | NeedsDemazeInput
  strongestIndustries: string[] | NeedsDemazeInput
  commonObjections: string[] | NeedsDemazeInput
}

export const DEMAZE_SERVICE_PROFILES: Record<string, DemazeServiceProfile> = {
  'AI-powered business applications': {
    service: 'AI-powered business applications',
    problemsSolvedConfidently: [
      'Decisions (sales prioritization, lead scoring, resource allocation) made on gut feel or spreadsheets instead of systematic intelligence',
      'Field/dealer/distributed teams not getting consistent guidance from HQ',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Sales/ops teams described as large or distributed (dealer networks, field teams, regional offices)',
      'Existing but clearly manual "intelligence" work (market research, lead scoring, competitive analysis mentioned as a role/department)',
      'No AI/ML mentioned anywhere on the site despite scale that would benefit from it',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'With a network this size, how is lead/opportunity prioritization currently handled across regions — manually, or is there a system doing it?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Custom SaaS platforms': {
    service: 'Custom SaaS platforms',
    problemsSolvedConfidently: [
      'No software fits their specific operational model; using spreadsheets or disconnected tools to patch the gap',
      "Growth is being slowed by a process that doesn't scale without custom tooling",
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      "Company describes a workflow, process, or dataset that's clearly internal/proprietary and not served by off-the-shelf software",
      'Mentions of "we built our own tool" or "internal system" in a job posting or about page',
      'A recurring, structured business process specific to their vertical',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'Is [specific process you found evidence of] still running on spreadsheets, or has that moved to a dedicated tool?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Ecommerce ecosystems': {
    service: 'Ecommerce ecosystems',
    problemsSolvedConfidently: [
      'Fragmented view across channels (own site, marketplaces, social)',
      'Payment friction specific to the Indian market (Stripe invite-only)',
      'No unified attribution/analytics across the funnel',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Company sells products online (own storefront, not just marketplace listing)',
      'India-based D2C brand',
      'Mentions of multiple sales channels (own site + marketplaces + social commerce)',
      'No analytics/attribution language on the site despite clear online sales activity',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'Running sales across [own site + marketplaces] usually means the revenue picture is scattered across three dashboards — worth seeing what a unified view looks like?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Marketplace platforms': {
    service: 'Marketplace platforms',
    problemsSolvedConfidently: [
      'Managing a growing two-sided network without a platform built for it (onboarding, matching, payments, trust/reviews)',
      "Manual vendor/partner coordination that doesn't scale",
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Explicit two-sided language: buyers AND sellers, vendors AND customers, drivers AND riders, etc.',
      'Mentions of onboarding a network of partners/vendors/merchants',
      'Commission/transaction-based language rather than direct-sale language',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'As the vendor/partner side grows, is onboarding and matching still handled manually, or is there a platform doing that already?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Workflow automation systems': {
    service: 'Workflow automation systems',
    problemsSolvedConfidently: [
      'Manual handoffs between teams/steps causing delay or errors',
      "No visibility into where a request/ticket/order currently sits in the process",
      'Compliance/SLA tracking done manually, risk of missed deadlines',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Explicit description of a multi-step internal process (approvals, complaints, service tickets, order lifecycle)',
      'Words like "our team processes/handles/manages" describing a repetitive task',
      'Multiple departments/teams mentioned as touching the same process',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: "How many hand-offs does a [complaint/order/ticket] go through before it's resolved today — and is that tracked automatically or manually?",
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Internal operational software': {
    service: 'Internal operational software',
    problemsSolvedConfidently: [
      "HQ lacks real-time visibility into what's happening at individual locations",
      'Reporting is manual, delayed, and inconsistent across sites',
      'No single source of truth for operational status across the business',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Multiple facilities, plants, offices, or locations mentioned',
      'Language implying HQ needs visibility into distributed operations',
      'Mentions of manual reporting cadence ("monthly reports," "weekly updates")',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: "Coordinating reporting across [N] locations usually means someone's stitching together updates manually each week — worth 15 minutes to see how that gets automated?",
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'Analytics and reporting systems': {
    service: 'Analytics and reporting systems',
    problemsSolvedConfidently: [
      'Data exists in silos (per-location, per-channel, per-department) with no unified view',
      'Decisions made without timely access to consolidated numbers',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Multiple business units, regions, or locations',
      'Dealer/distributor/franchise network mentioned',
      'Data mentioned as existing but not "used" (raw sales data, raw traffic data)',
      'No mention of dashboards, BI tools, or reporting infrastructure at all',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'How are you currently consolidating operational data across [locations/regions/dealers] — manually, or is there a system doing it?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
  'AI integrations and intelligent automation': {
    service: 'AI integrations and intelligent automation',
    problemsSolvedConfidently: [
      'Existing tools operate in isolation; no AI layer connecting or enhancing them',
      'Repetitive content/analysis work still done manually despite being automatable',
    ],
    problemsNotSolved: NEEDS_DEMAZE_INPUT,
    idealBuyerPersona: NEEDS_DEMAZE_INPUT,
    typicalCompanyCharacteristics: [
      'Existing tools/systems named (CRM, ERP, e-commerce platform) that could be connected/enhanced with AI, but no such integration mentioned',
      'Repetitive content/communication tasks described (marketing content, customer responses, reporting narratives)',
      'Company already has digital infrastructure (website, app, CRM)',
    ],
    strongestTriggers: NEEDS_DEMAZE_INPUT,
    preferredOutreachAngle: 'Is [named tool/process] connected to anything AI-driven yet, or still a manual step in the workflow?',
    projectFitRange: NEEDS_DEMAZE_INPUT,
    strongestIndustries: NEEDS_DEMAZE_INPUT,
    commonObjections: NEEDS_DEMAZE_INPUT,
  },
}
