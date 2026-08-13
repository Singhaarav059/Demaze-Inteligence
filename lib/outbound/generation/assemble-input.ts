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

  const painPointsStructured = getPainPointsStructured(data)
    .map(painPointText)
    .filter((p): p is string => p !== null)
  const fallbackPainPoints = Array.isArray(data.pain_points)
    ? (data.pain_points as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []

  const opportunities: Array<{ title: string; description?: string }> = getOpportunities(data).flatMap(o => {
    const title = toStr(o.title)
    return title ? [{ title, description: toStr(o.description) }] : []
  })

  const recentActivity = Array.isArray(data.recent_activity)
    ? (data.recent_activity as unknown[]).filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : []

  const executiveBrief = getExecutiveBrief(data)
  const outreachIntelligence = getOutreachIntelligence(data)

  return {
    personName: contact.person_name,
    titleHint: contact.title_hint ?? undefined,
    companyName: contact.company_name,
    companySummary: toStr(data.company_summary),
    painPoints: painPointsStructured.length > 0 ? painPointsStructured : fallbackPainPoints,
    opportunities,
    recentActivity,
    // Sales Intelligence is more curated than the raw narrative fields when
    // both exist — prefer its positioning/problem over conversation_angle/
    // what_to_sell, but fall back to the pre-existing behavior when it
    // doesn't (a run with no generated Sales Strategy, or one where neither
    // field was matched).
    openingAngle: salesIntelligence?.positioning ?? outreachIntelligence?.conversation_angle,
    whatToSell: salesIntelligence?.problemLabel ?? executiveBrief?.what_to_sell,
    whyNow: outreachIntelligence?.why_now ?? executiveBrief?.why_now,
    salesIntelligence: salesIntelligence ?? undefined,
  }
}
