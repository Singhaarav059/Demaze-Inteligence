// ============================================================
// Assembles EmailGenerationInput from an outbound_contacts row + its
// linked pipeline_test_runs.final_result — reuses lib/pipeline/
// analysis-sections.ts's getters exactly like every UI consumer does,
// rather than re-deriving field access here.
// ============================================================

import {
  getOpportunities,
  getExecutiveBrief,
  getOutreachIntelligence,
  getPainPointsStructured,
} from '@/lib/pipeline/analysis-sections'
import { qualifyCompany } from '@/lib/sector-playbook/qualify'
import type { EmailGenerationInput, EmailGenerationSalesIntelligence } from './types'

interface ContactLike {
  person_name: string
  title_hint: string | null
  company_name: string
}

function toStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function painPointText(item: Record<string, unknown>): string | null {
  // item.title is StructuredPainPoint's real field (lib/pipeline/normalize.ts)
  // — checked first. point/description/text never actually appear on that
  // shape; this masked a real bug until Session 3 of the research-quality
  // initiative (2026-07-22, see CLAUDE.md) started producing genuine
  // structured pain points — before that, pain_points_structured was always
  // [], so this function was silently a no-op and fallbackPainPoints below
  // did all the work.
  const text = toStr(item.title) ?? toStr(item.point) ?? toStr(item.description) ?? toStr(item.text)
  return text ?? null
}

function claimTypeOf(item: Record<string, unknown>): 'observed' | 'inferred' | undefined {
  const raw = item.claim_type
  return raw === 'observed' || raw === 'inferred' ? raw : undefined
}

export function buildEmailGenerationInput(
  contact: ContactLike,
  finalResult: Record<string, unknown> | null | undefined,
  // Optional, already-resolved (active override applied, matched case study
  // fetched) — see fetch-context.ts for how this gets built. Absent for any
  // run with no Sales Strategy recommendation: every field below behaves
  // byte-for-byte identically to before this parameter existed.
  salesIntelligence?: EmailGenerationSalesIntelligence | null
): EmailGenerationInput {
  const data = finalResult ?? {}

  const structuredPainPointItems = getPainPointsStructured(data)
  const painPointsStructured = structuredPainPointItems
    .map(painPointText)
    .filter((p): p is string => p !== null)
  const painPointsDetailed = structuredPainPointItems.flatMap(item => {
    const text = painPointText(item)
    return text ? [{ text, claimType: claimTypeOf(item) }] : []
  })
  const fallbackPainPoints = Array.isArray(data.pain_points)
    ? (data.pain_points as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []

  const opportunities: Array<{ title: string; description?: string; claimType?: 'observed' | 'inferred' }> = getOpportunities(data).flatMap(o => {
    const title = toStr(o.title)
    return title ? [{ title, description: toStr(o.description), claimType: claimTypeOf(o) }] : []
  })

  const recentActivity = Array.isArray(data.recent_activity)
    ? (data.recent_activity as unknown[]).filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : []

  const executiveBrief = getExecutiveBrief(data)
  const outreachIntelligence = getOutreachIntelligence(data)

  // Fallback source when no DB-backed Sales Knowledge match exists for this
  // run (the common case today — see CLAUDE.md's Sales Intelligence Layer
  // history): the DRAFT sector playbook (lib/sector-playbook), scoped to
  // exactly the 3 active target sectors. Only used when a sector confidently
  // matched and at least one opportunity pattern found real evidence.
  // Deliberately never overrides the company's own narrative fields
  // (outreachIntelligence/executiveBrief) below, which are more specific,
  // per-company-grounded content — the playbook only fills the gap when
  // that narrative is absent, and always rides along in the salesIntelligence
  // object itself so the prompt still gets its recommended CTA/evidence
  // framing regardless.
  const playbookFallback = salesIntelligence ? undefined : buildPlaybookSalesIntelligence(data)
  const resolvedSalesIntelligence = salesIntelligence ?? playbookFallback

  return {
    personName: contact.person_name,
    titleHint: contact.title_hint ?? undefined,
    companyName: contact.company_name,
    companySummary: toStr(data.company_summary),
    painPoints: painPointsStructured.length > 0 ? painPointsStructured : fallbackPainPoints,
    // Only when the structured (claim_type-carrying) path actually produced
    // pain points — the fallback flat-string path has no claim_type to
    // carry, so prompts.ts's renderInputBlock() falls back to the plain
    // `painPoints` list above when this is absent.
    painPointsDetailed: painPointsStructured.length > 0 ? painPointsDetailed : undefined,
    opportunities,
    recentActivity,
    // Sales Intelligence is more curated than the raw narrative fields when
    // both exist — prefer its positioning/problem over conversation_angle/
    // what_to_sell, but the company's own narrative wins over the generic
    // DRAFT sector playbook (see playbookFallback above).
    openingAngle: salesIntelligence?.positioning ?? outreachIntelligence?.conversation_angle ?? playbookFallback?.positioning,
    whatToSell: salesIntelligence?.problemLabel ?? executiveBrief?.what_to_sell ?? playbookFallback?.problemLabel,
    whyNow: outreachIntelligence?.why_now ?? executiveBrief?.why_now,
    salesIntelligence: resolvedSalesIntelligence ?? undefined,
  }
}

function buildPlaybookSalesIntelligence(data: Record<string, unknown>): EmailGenerationSalesIntelligence | undefined {
  const qualification = qualifyCompany(data)
  if (!qualification.playbook || qualification.classification.confidence === 'none') return undefined

  const topMatch = qualification.matchedOpportunities[0]
  const playbook = qualification.playbook

  return {
    problemLabel: topMatch?.possibleProblem ?? playbook.outreachAngle,
    evidenceSentence: topMatch ? `${topMatch.tier === 'confirmed' ? 'Confirmed' : 'Inferred'}: ${topMatch.evidence}` : undefined,
    // DRAFT — see lib/sector-playbook/types.ts. The email-generation rules
    // in lib/outbound/generation/prompts.ts already instruct the model to
    // use this as the core angle/CTA rather than inventing its own.
    positioning: `[DRAFT ${playbook.label} playbook] ${playbook.valueProposition}`,
    recommendedCta: playbook.cta,
  }
}
