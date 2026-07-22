// ============================================================
// Deterministic Opportunity Engine — v3
// ============================================================
// Maps the 8 CONFIRMED Demaze service lines (DEMAZE_CAPABILITY_MAP.md) directly
// to detected evidence. The LLM EXPLAINS these opportunities; it does not invent
// them, and it cannot surface a service outside these 8.
//
// v3 rewrite (2026-07-11): the entire v2 catalog (~20 generic "AI opportunity"
// titles like "Predictive Maintenance AI", "Production Optimization AI") is
// gone — those were invented services that don't correspond to anything Demaze
// actually sells. A live AITG test showed the old catalog surfacing exactly
// these titles as "Demaze Opportunities", i.e. real misleading output implying
// capabilities that may not exist. See CLAUDE.md "Item 5" for the full
// root-cause writeup.
//
// Gating no longer runs through signal_clusters (signal-clustering.ts) — those
// clusters were purpose-built for the old invented catalog's evidence shape
// and don't map onto what the 8 real services actually need (see
// service-evidence.ts's file header). Each of the 8 services now has its own
// Evidence/Disqualifier/Threshold detection, run directly against raw content,
// per SERVICE_TO_OUTREACH_MAPPING.md. signal_clusters remains an input to
// clusterSignals()/scorer.ts elsewhere in the pipeline but is not consulted here.
//
// Threshold is a real gate: only 'medium'/'strong' surface here. 'weak' matches
// are computed by service-evidence.ts but intentionally excluded from the
// output entirely — surfacing them would recreate the generic "Digital
// Transformation for every company" anti-pattern (CLAUDE.md "Why this exists").
//
// No cap on how many services surface — a company with two genuine,
// evidence-backed problems shows both, ranked by evidence strength
// (strong > medium, then by evidence-match count). Forcing a single pick when
// multiple services genuinely clear the bar would hide real signal.
// ============================================================

import type { CompanyProfile } from './evidence-extractor'
import { detectServiceEvidence, ServiceThresholdResult, ServiceThreshold } from './service-evidence'

export type OpportunityCategory = string  // slugified service name — see CONFIRMED_SERVICES below

export interface DeterministicOpportunity {
  id: string
  title: string                    // one of the 8 confirmed service names, verbatim — never invented
  service: string                  // same as title; kept as a separate field for normalize.ts compatibility
  category: OpportunityCategory
  strategic_challenge: string      // "Likely Pain" from SERVICE_TO_OUTREACH_MAPPING.md
  llm_explanation_prompt: string   // what to ask the LLM to explain, seeded with the actual matched evidence
  entry_point: string              // "Outreach Angle" from the mapping doc — a usable first-line opener
  priority: number                 // derived from threshold: strong=90, medium=60
  relevance: 'High' | 'Medium'      // strong->High, medium->Medium ('weak'/'none' never reach here)
  threshold: ServiceThreshold
  disqualifier_matched?: string
  // Debug/traceability — kept under the pre-existing field name so the admin
  // debug UI (app/admin/intelligence-lab/page.tsx) continues to render
  // something meaningful without requiring an immediate UI change.
  triggered_by_clusters?: Array<{ id: string; name: string; confidence: string }>
  priority_source?: string
}

// ── The 8 confirmed services (verbatim from DEMAZE_CAPABILITY_MAP.md) ───────
// Content (strategic_challenge / entry_point) sourced directly from
// SERVICE_TO_OUTREACH_MAPPING.md's "Likely Pain" / "Outreach Angle" fields —
// never paraphrased into a punchier invented title.

const SERVICE_CONTENT: Record<string, { strategic_challenge: string; entry_point: string; slug: string }> = {
  'AI-powered business applications': {
    slug: 'ai_powered_business_applications',
    strategic_challenge: 'Decisions (sales prioritization, lead scoring, resource allocation) made on gut feel or spreadsheets instead of systematic intelligence; field/dealer/distributed teams not getting consistent guidance from HQ.',
    entry_point: 'With a network this size, how is lead/opportunity prioritization currently handled across regions — manually, or is there a system doing it?',
  },
  'Custom SaaS platforms': {
    slug: 'custom_saas_platforms',
    strategic_challenge: 'No software fits their specific operational model; using spreadsheets or disconnected tools to patch the gap, and growth is being slowed by a process that doesn’t scale without custom tooling.',
    entry_point: 'Is [specific process you found evidence of] still running on spreadsheets, or has that moved to a dedicated tool?',
  },
  'Ecommerce ecosystems': {
    slug: 'ecommerce_ecosystems',
    strategic_challenge: 'Fragmented view across channels (own site, marketplaces, social); payment friction specific to the Indian market; no unified attribution/analytics across the funnel.',
    entry_point: 'Running sales across [own site + marketplaces] usually means the revenue picture is scattered across three dashboards — worth seeing what a unified view looks like?',
  },
  'Marketplace platforms': {
    slug: 'marketplace_platforms',
    strategic_challenge: 'Managing a growing two-sided network without a platform built for it (onboarding, matching, payments, trust/reviews); manual vendor/partner coordination that doesn’t scale.',
    entry_point: 'As the vendor/partner side grows, is onboarding and matching still handled manually, or is there a platform doing that already?',
  },
  'Workflow automation systems': {
    slug: 'workflow_automation_systems',
    strategic_challenge: 'Manual handoffs between teams/steps causing delay or errors; no visibility into where a request/ticket/order currently sits in the process; compliance/SLA tracking done manually.',
    entry_point: 'How many hand-offs does a [complaint/order/ticket] go through before it’s resolved today — and is that tracked automatically or manually?',
  },
  'Internal operational software': {
    slug: 'internal_operational_software',
    strategic_challenge: 'HQ lacks real-time visibility into what’s happening at individual locations; reporting is manual, delayed, and inconsistent across sites; no single source of truth for operational status.',
    entry_point: 'Coordinating reporting across [N] locations usually means someone’s stitching together updates manually each week — worth 15 minutes to see how that gets automated?',
  },
  'Analytics and reporting systems': {
    slug: 'analytics_and_reporting_systems',
    strategic_challenge: 'Data exists in silos (per-location, per-channel, per-department) with no unified view; decisions made without timely access to consolidated numbers.',
    entry_point: 'How are you currently consolidating operational data across [locations/regions/dealers] — manually, or is there a system doing it?',
  },
  'AI integrations and intelligent automation': {
    slug: 'ai_integrations_and_intelligent_automation',
    strategic_challenge: 'Existing tools operate in isolation with no AI layer connecting or enhancing them; repetitive content/analysis work still done manually despite being automatable.',
    entry_point: 'Is [named tool/process] connected to anything AI-driven yet, or still a manual step in the workflow?',
  },
}

// The literal 8 confirmed service-line names, exported for reuse as a
// whitelist elsewhere (normalize.ts's evidence-grounded LLM opportunity path
// — see CLAUDE.md "Research-quality initiative" 2026-07-22 Session 2 — checks
// an LLM-proposed opportunity's service_line against this exact list so it
// can never invent a 9th service).
export const CONFIRMED_SERVICE_NAMES: readonly string[] = Object.keys(SERVICE_CONTENT)

function toOpportunity(r: ServiceThresholdResult): DeterministicOpportunity {
  const content = SERVICE_CONTENT[r.service]
  const evidenceQuotes = r.evidence.map(e => `"${e.matched}" (${e.pattern})`).join('; ')

  return {
    id: content.slug,
    title: r.service,
    service: r.service,
    category: content.slug,
    strategic_challenge: content.strategic_challenge,
    llm_explanation_prompt: `Explain why "${r.service}" is relevant given this evidence from the company's own content: ${evidenceQuotes || '(no direct quote captured)'}. Quote specific evidence, don't restate generically.`,
    entry_point: content.entry_point,
    priority: r.threshold === 'strong' ? 90 : 60,
    relevance: r.threshold === 'strong' ? 'High' : 'Medium',
    threshold: r.threshold,
    disqualifier_matched: r.disqualifier_matched,
    triggered_by_clusters: r.evidence.map(e => ({ id: e.pattern, name: e.matched, confidence: r.threshold })),
    priority_source: `Threshold: ${r.threshold} | Evidence: ${r.evidence.length} pattern(s) matched`,
  }
}

// ── Main function ──────────────────────────────────────────────

/**
 * Given raw content and company profile, detect which of the 8 confirmed
 * Demaze services genuinely clear the evidence bar for this company.
 *
 * No cap — returns every service that clears 'medium' or 'strong', ranked by
 * threshold (strong first) then by evidence-match count. 'weak' and
 * disqualified services never reach the output.
 */
export function generateDeterministicOpportunities(
  content: string,
  profile: CompanyProfile,
  growthOrHiringSignal: boolean,
): DeterministicOpportunity[] {
  const results = detectServiceEvidence(content, profile, growthOrHiringSignal)

  const qualifying = results.filter(r => !r.disqualified && (r.threshold === 'medium' || r.threshold === 'strong'))

  qualifying.sort((a, b) => {
    if (a.threshold !== b.threshold) return a.threshold === 'strong' ? -1 : 1
    return b.evidence.length - a.evidence.length
  })

  return qualifying.map(toOpportunity)
}
