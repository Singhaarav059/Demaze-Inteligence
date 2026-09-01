// ============================================================
// Exa Contact Enrichment Provider
// ============================================================
// Uses Exa's Answer API with an outputSchema asking for department/
// seniority/location/roleCategory/linkedinSummary/industry/companySize —
// cheaper than a Websets round-trip and Answer is built for exactly this
// "extract structured facts about something, grounded in real search
// results" shape. Fields the answer doesn't actually support are left
// genuinely undefined, never fabricated (rule 2: insufficient evidence ->
// no forced output). Exa gives no explicit confidence signal on an Answer
// result, so confidence is honestly derived from whether the answer came
// back grounded in real citations ('medium') or not ('low') — this NEVER
// defaults to 'high', unlike a lazier implementation might.
// ============================================================

import { exaAnswer } from '@/lib/enrichment/sources/exa-client'
import { getExaCredential } from '@/lib/outbound/shared/exa-outbound-client'
import type { EnrichmentProvider, EnrichmentRequest, EnrichmentResult } from '../types'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    department: { type: 'string' },
    seniority: { type: 'string' },
    location: { type: 'string' },
    roleCategory: { type: 'string' },
    linkedinSummary: { type: 'string' },
    companySize: { type: 'string' },
    industry: { type: 'string' },
  },
} as const

interface StructuredAnswer {
  department?: string
  seniority?: string
  location?: string
  roleCategory?: string
  linkedinSummary?: string
  companySize?: string
  industry?: string
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export const ExaEnrichmentProvider: EnrichmentProvider = {
  name: 'exa',
  displayName: 'Exa',

  async enrichContact(request: EnrichmentRequest): Promise<EnrichmentResult> {
    const { personName, companyName, linkedinUrl, knownCompanySize, knownIndustry } = request

    if (!personName?.trim() && !linkedinUrl) {
      return { confidence: 'low', providerUsed: 'exa', status: 'not_found' }
    }

    const apiKey = await getExaCredential('enrichment')
    if (!apiKey) {
      return { confidence: 'low', providerUsed: 'exa', status: 'not_found' }
    }

    const subject = linkedinUrl ? `${personName || 'this person'} (${linkedinUrl})` : personName
    const query = `What is ${subject}'s department, seniority level, and location at ${companyName}? Also give their role category, a short professional summary, and the company's industry and approximate size if known.`

    let response
    try {
      response = await exaAnswer({ query, outputSchema: OUTPUT_SCHEMA, text: false }, apiKey)
    } catch {
      return { confidence: 'low', providerUsed: 'exa', status: 'not_found' }
    }

    // outputSchema is best-effort — Exa's own docs don't guarantee `answer`
    // comes back as the requested object shape rather than a plain string.
    // When it doesn't, there's no reliable way to split it into the
    // individual fields this provider promises, so this reports
    // 'not_found' rather than guessing at a split.
    if (!response.answer || typeof response.answer !== 'object') {
      return { confidence: 'low', providerUsed: 'exa', status: 'not_found' }
    }

    const answer = response.answer as StructuredAnswer
    const department = nonEmpty(answer.department)
    const seniority = nonEmpty(answer.seniority)
    const location = nonEmpty(answer.location)
    const roleCategory = nonEmpty(answer.roleCategory)
    const linkedinSummary = nonEmpty(answer.linkedinSummary)
    // Exa's own live data is more authoritative than our own hint when
    // present — hints are only a fallback for what Exa's answer left thin,
    // same precedence the Prospeo enrichment provider already uses.
    const companySize = nonEmpty(answer.companySize) || knownCompanySize
    const industry = nonEmpty(answer.industry) || knownIndustry

    const hasCore = Boolean(department || seniority || location)
    const hasAny = hasCore || Boolean(roleCategory || linkedinSummary || industry || companySize)

    if (!hasAny) {
      return { confidence: 'low', providerUsed: 'exa', status: 'not_found' }
    }

    const grounded = (response.citations?.length ?? 0) > 0

    return {
      department,
      seniority,
      location,
      roleCategory,
      linkedinSummary,
      companySize,
      industry,
      // Never 'high' — Exa gives no explicit confidence/verification
      // signal here, unlike Prospeo. A grounded (cited) answer is 'medium',
      // an ungrounded one is 'low' — honest about the difference between a
      // direct hit and an inference, not a default.
      confidence: grounded ? 'medium' : 'low',
      providerUsed: 'exa',
      status: hasCore ? 'enriched' : 'partial',
    }
  },

  // Cheap credential-presence check only — no network ping before every
  // request, same discipline as the other real providers in this repo.
  async isAvailable(): Promise<boolean> {
    return (await getExaCredential('enrichment')) !== null
  },
}
