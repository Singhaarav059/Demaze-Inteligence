// ============================================================
// Sector classification — is this company in one of the 3 target sectors?
// ============================================================
// Pure, sync, no new LLM call, no new network call — reuses already-computed
// research fields (top-level industry/sub_industry/company_summary, the
// business-profile getter) and matches them against each DRAFT playbook's
// own `signals` word list. Same word-boundary discipline as this codebase's
// other keyword matchers (scraper.ts's matchesKeyword, website-discovery.ts)
// — a short signal like "d2c" must not match as a bare substring inside an
// unrelated word.
// ============================================================

import { getBusinessProfile } from '@/lib/pipeline/analysis-sections'
import { getAllSectorPlaybooks } from './playbooks'
import type { TargetSector } from './types'

export type SectorMatchConfidence = 'none' | 'low' | 'medium' | 'high'

export interface SectorClassification {
  sector: TargetSector | null
  confidence: SectorMatchConfidence
  matchedSignals: string[]
  reason: string
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordBoundaryRegex(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'i')
}

function researchText(analysisResult: Record<string, unknown> | null | undefined): string {
  if (!analysisResult) return ''
  const data = analysisResult
  const profile = getBusinessProfile(data)
  const parts = [
    typeof data.industry === 'string' ? data.industry : '',
    typeof data.sub_industry === 'string' ? data.sub_industry : '',
    typeof data.company_summary === 'string' ? data.company_summary : '',
    profile?.market_positioning ?? '',
    ...(profile?.industries_served ?? []),
    ...(profile?.services ?? []),
  ]
  return parts.filter(Boolean).join(' ')
}

// A signal found in the top-level industry/sub_industry field counts double
// (the pipeline's own classifier already labeled this company that way) —
// everything else is a body-text mention, weaker on its own.
function countMatches(text: string, industryField: string, signals: string[]): { matched: string[]; strongCount: number } {
  const matched: string[] = []
  let strongCount = 0
  for (const signal of signals) {
    const re = wordBoundaryRegex(signal)
    if (re.test(text)) {
      matched.push(signal)
      if (re.test(industryField)) strongCount++
    }
  }
  return { matched, strongCount }
}

export function classifySector(analysisResult: Record<string, unknown> | null | undefined): SectorClassification {
  const text = researchText(analysisResult)
  const industryField = [
    typeof analysisResult?.industry === 'string' ? analysisResult.industry : '',
    typeof analysisResult?.sub_industry === 'string' ? analysisResult.sub_industry : '',
  ].join(' ')

  if (!text.trim()) {
    return { sector: null, confidence: 'none', matchedSignals: [], reason: 'No research content available yet.' }
  }

  let best: { sector: TargetSector; label: string; matched: string[]; strongCount: number } | null = null

  for (const playbook of getAllSectorPlaybooks()) {
    const { matched, strongCount } = countMatches(text, industryField, playbook.signals)
    if (matched.length === 0) continue
    if (!best || matched.length > best.matched.length || (matched.length === best.matched.length && strongCount > best.strongCount)) {
      best = { sector: playbook.sector, label: playbook.label, matched, strongCount }
    }
  }

  if (!best) {
    return {
      sector: null,
      confidence: 'none',
      matchedSignals: [],
      reason: 'No signal for Manufacturing, Automotive, or E-commerce found in this company\'s research — outside the current target sectors.',
    }
  }

  const confidence: SectorMatchConfidence =
    best.strongCount > 0 && best.matched.length >= 2 ? 'high' :
    best.strongCount > 0 || best.matched.length >= 2 ? 'medium' :
    'low'

  return {
    sector: best.sector,
    confidence,
    matchedSignals: best.matched,
    reason:
      confidence === 'high'
        ? `Classified as ${best.label} — the company's own stated industry and multiple research signals (${best.matched.slice(0, 3).join(', ')}) agree.`
        : confidence === 'medium'
        ? `Likely ${best.label} — ${best.matched.slice(0, 3).join(', ')} appear in the research.`
        : `Possibly ${best.label} — only a weak signal (${best.matched[0]}) found so far, not confirmed.`,
  }
}
