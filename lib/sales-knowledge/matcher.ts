// ============================================================
// Sales Intelligence Matcher — deterministic, no LLM call
// ============================================================
// Turns a completed research run into a Sales Intelligence recommendation
// by matching against the Sales Knowledge bundle (industries/problems/
// capabilities/case studies). Reuses already-computed pipeline output
// exclusively — no new content extraction, no raw-scrape re-parsing —
// per CLAUDE.md's "minimize new LLM calls, reuse existing data" rule.
//
// Evidence hierarchy (spec's 4 tiers), assigned per problem in order of
// strength, first match wins:
//   1. confirmed_fact — either (a) the matched capability's service-
//      evidence debug trail (lib/pipeline/service-evidence.ts, already
//      regex-matched against real scraped content) surfaced at
//      medium/strong for one of the problem's tagged capabilities, or
//      (b) an 'observed' structured pain point (already quote-verified
//      upstream in normalize.ts — see StructuredPainPoint.claim_type)
//      contains one of the problem's evidence_keywords. Both sources are
//      already independently verified against real content by earlier
//      pipeline stages — this function trusts that verification rather
//      than re-deriving it.
//   2. research_supported_signal — an 'inferred' pain point, a strategic
//      challenge, or a 'weak' service-evidence match containing an
//      evidence_keyword. Grounded but not independently confirmed.
//   3. industry_pattern — the problem's tagged industry overlaps with the
//      company's own business_profile.industries_served/market_positioning,
//      with no company-specific evidence found.
//   4. hypothesis — only the LLM's own outreach_intelligence narrative
//      (likely_problem/recommended_service/why_contact) loosely mentions
//      this problem, with no independent corroboration.
// A problem that matches nothing at all is simply not a candidate — this
// function never invents an evidence tier weaker than what was found.
// ============================================================

import {
  getBusinessProfile,
  getPainPointsStructured,
  getStrategicChallenges,
  getOutreachIntelligence,
  getServiceEvidenceDebug,
} from '@/lib/pipeline/analysis-sections'
import type {
  SalesKnowledgeBundle,
  SalesKnowledgeIndustry,
  SalesKnowledgeProblem,
  ConfidenceTier,
  SalesIntelligenceMatch,
  SalesIntelligenceReasoning,
} from './types'

const MAX_CASE_STUDIES = 2

// Maps this module's 8 seeded capability slugs to service-evidence.ts's
// plain-English service labels, so a Sales Knowledge problem's
// capability_tags can be cross-referenced against the already-computed
// _service_evidence_debug trail without re-deriving evidence detection.
// A user-added capability with a slug outside this map simply never gets
// a confirmed_fact match via this path — it can still match via evidence_
// keywords against pain points/challenges (tier 2), an honest degradation,
// not a silent failure.
const CAPABILITY_SLUG_TO_SERVICE_LABEL: Record<string, string> = {
  'ai-business-applications': 'AI-powered business applications',
  'custom-saas-platforms': 'Custom SaaS platforms',
  'ecommerce-ecosystems': 'Ecommerce ecosystems',
  'marketplace-platforms': 'Marketplace platforms',
  'workflow-automation-systems': 'Workflow automation systems',
  'internal-operational-software': 'Internal operational software',
  'analytics-reporting-systems': 'Analytics and reporting systems',
  'ai-integrations-automation': 'AI integrations and intelligent automation',
}

function norm(s: string): string {
  return s.toLowerCase().trim()
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase()
  return p.length > 0 && haystack.toLowerCase().includes(p)
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'this', 'that', 'not', 'yet'])

function significantWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter(w => w.length > 3 && !STOPWORDS.has(w))
}

interface EvidenceItem {
  text: string
  claimType?: 'observed' | 'inferred'
}

function collectPainPointItems(data: Record<string, unknown>): EvidenceItem[] {
  return getPainPointsStructured(data)
    .map(p => {
      const title = typeof p.title === 'string' ? p.title : ''
      const evidence = typeof p.evidence === 'string' ? p.evidence : ''
      const reasoning = typeof p.reasoning === 'string' ? p.reasoning : ''
      const claimType: 'observed' | 'inferred' | undefined =
        p.claim_type === 'observed' || p.claim_type === 'inferred' ? p.claim_type : undefined
      return { text: [title, evidence, reasoning].filter(Boolean).join('. '), claimType }
    })
    .filter(i => i.text.trim().length > 0)
}

function collectChallengeItems(data: Record<string, unknown>): EvidenceItem[] {
  return getStrategicChallenges(data)
    .map(c => ({ text: [c.title, c.description].filter((x): x is string => typeof x === 'string').join('. ') }))
    .filter(i => i.text.trim().length > 0)
}

function outreachHintText(data: Record<string, unknown>): string {
  const oi = getOutreachIntelligence(data)
  return [oi?.likely_problem, oi?.recommended_service, oi?.why_contact]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .join('. ')
}

function industryMatchesResearch(data: Record<string, unknown>, industry: SalesKnowledgeIndustry): boolean {
  const profile = getBusinessProfile(data)
  const served = (profile?.industries_served ?? []).map(norm)
  const positioning = norm(profile?.market_positioning ?? '')
  const slug = norm(industry.slug)
  if (served.some(s => s.includes(slug) || slug.includes(s))) return true
  return industry.keywords.some(k => {
    const nk = norm(k)
    return nk.length > 0 && (served.some(s => s.includes(nk)) || positioning.includes(nk))
  })
}

function emptyMatch(): SalesIntelligenceMatch {
  return { industry: null, problem: null, capability: null, caseStudies: [], roles: [], cta: null, confidenceTier: 'hypothesis', reasoning: {} }
}

interface ProblemMatch {
  problem: SalesKnowledgeProblem
  tier: ConfidenceTier
  reasonText: string
}

export function matchSalesIntelligence(
  analysisResult: Record<string, unknown> | null | undefined,
  knowledge: SalesKnowledgeBundle,
): SalesIntelligenceMatch {
  const data = analysisResult ?? {}
  if (knowledge.problems.length === 0 || knowledge.capabilities.length === 0) return emptyMatch()

  const painPoints = collectPainPointItems(data)
  const challenges = collectChallengeItems(data)
  const hint = outreachHintText(data)
  const serviceDebug = getServiceEvidenceDebug(data)

  const matches: ProblemMatch[] = []

  for (const problem of knowledge.problems) {
    let match: ProblemMatch | null = null

    // Tier 1a: service-evidence debug trail at medium/strong for a tagged capability
    for (const capSlug of problem.capability_tags) {
      const label = CAPABILITY_SLUG_TO_SERVICE_LABEL[capSlug]
      const entry = label ? serviceDebug?.services?.find(s => s.service === label) : undefined
      if (entry && !entry.disqualified && entry.surfaced && (entry.threshold === 'medium' || entry.threshold === 'strong')) {
        const snippet = entry.evidence?.[0]?.snippet
        match = {
          problem,
          tier: 'confirmed_fact',
          reasonText: snippet
            ? `Directly shown in the company's own research: "${snippet}"`
            : `Strong, code-verified evidence detected for ${problem.label.toLowerCase()}.`,
        }
        break
      }
    }

    // Tier 1b: an 'observed' (already quote-verified) pain point mentions an evidence keyword
    if (!match) {
      for (const item of painPoints) {
        if (item.claimType === 'observed' && problem.evidence_keywords.some(k => includesPhrase(item.text, k))) {
          match = { problem, tier: 'confirmed_fact', reasonText: `Confirmed in the company's own research: "${item.text.slice(0, 200)}"` }
          break
        }
      }
    }

    // Tier 2a: an 'inferred' pain point or strategic challenge mentions a keyword
    if (!match) {
      for (const item of [...painPoints, ...challenges]) {
        if (problem.evidence_keywords.some(k => includesPhrase(item.text, k))) {
          match = { problem, tier: 'research_supported_signal', reasonText: `Suggested by research findings: "${item.text.slice(0, 200)}"` }
          break
        }
      }
    }

    // Tier 2b: a 'weak' service-evidence match for a tagged capability
    if (!match) {
      for (const capSlug of problem.capability_tags) {
        const label = CAPABILITY_SLUG_TO_SERVICE_LABEL[capSlug]
        const entry = label ? serviceDebug?.services?.find(s => s.service === label) : undefined
        if (entry && !entry.disqualified && entry.threshold === 'weak') {
          match = { problem, tier: 'research_supported_signal', reasonText: `A weaker, real signal was detected for ${problem.label.toLowerCase()}.` }
          break
        }
      }
    }

    // Tier 3: industry overlap only, no company-specific evidence
    if (!match) {
      const industry = knowledge.industries.find(i => problem.industry_tags.includes(i.slug))
      if (industry && industryMatchesResearch(data, industry)) {
        match = {
          problem,
          tier: 'industry_pattern',
          reasonText: `${industry.label} companies commonly face this — not yet directly confirmed for this specific company.`,
        }
      }
    }

    // Tier 4: only the LLM's own narrative hint loosely mentions this problem
    if (!match && hint) {
      const labelWords = significantWords(problem.label)
      if (labelWords.length > 0 && labelWords.some(w => hint.toLowerCase().includes(w))) {
        match = {
          problem,
          tier: 'hypothesis',
          reasonText: `Suggested by the research summary, not independently confirmed: "${hint.slice(0, 200)}"`,
        }
      }
    }

    if (match) matches.push(match)
  }

  if (matches.length === 0) return emptyMatch()

  const tierRank: Record<ConfidenceTier, number> = {
    confirmed_fact: 0,
    research_supported_signal: 1,
    industry_pattern: 2,
    hypothesis: 3,
  }
  matches.sort((a, b) => tierRank[a.tier] - tierRank[b.tier])
  const top = matches[0]
  const { problem, tier, reasonText } = top

  const capability = knowledge.capabilities.find(c => problem.capability_tags.includes(c.slug)) ?? null
  const industry = knowledge.industries.find(i => problem.industry_tags.includes(i.slug)) ?? null
  const caseStudies = capability
    ? knowledge.caseStudies.filter(cs => cs.capability_tags.includes(capability.slug)).slice(0, MAX_CASE_STUDIES)
    : []

  const reasoning: SalesIntelligenceReasoning = {
    problem: reasonText,
    industry: industry ? `Tagged as a relevant industry for "${problem.label}".` : undefined,
    capability: capability ? `"${problem.label}" is mapped to the "${capability.label}" capability in Sales Knowledge.` : undefined,
    case_study:
      caseStudies.length > 0
        ? `Same capability (${capability?.label}) as a real Demaze case study.`
        : capability
          ? 'No matching case study found for this capability.'
          : undefined,
    roles: capability ? `Sales Knowledge lists these as the typical buyers for "${capability.label}".` : undefined,
    cta: capability ? `Sales Knowledge's recommended CTA for "${capability.label}".` : undefined,
  }

  return {
    industry,
    problem,
    capability,
    caseStudies,
    roles: capability?.recommended_roles ?? [],
    cta: capability?.recommended_cta ?? null,
    confidenceTier: tier,
    reasoning,
  }
}
