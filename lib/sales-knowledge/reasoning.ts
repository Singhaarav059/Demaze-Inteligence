// ============================================================
// Sales Intelligence Reasoning — "why this may matter" sentence
// ============================================================
// Template-first, always. A deterministic sentence is computed first and
// is the guaranteed return value on any failure/timeout. An LLM call is
// only attempted for the two stronger evidence tiers (confirmed_fact /
// research_supported_signal) — for industry_pattern/hypothesis there is no
// grounded fact worth narrating, so a call there would just be an LLM
// dressing up a guess; skipping it is the actual enforcement of "minimize
// new LLM calls" (CLAUDE.md perf rule), not just a nice-to-have.
//
// This is the only new LLM call this whole feature introduces, and it's a
// short, bounded, single-attempt, non-JSON call — one plain sentence, no
// schema to parse, so no fence-stripping/JSON-extraction machinery needed.
// ============================================================

import { getCompletion } from '@/lib/ai/provider-factory'
import type { SalesIntelligenceMatch } from './types'

function templateSentence(match: SalesIntelligenceMatch, companyName: string): string {
  if (!match.problem) return ''
  const problemLabel = match.problem.label.toLowerCase()
  const industryLabel = match.industry?.label

  switch (match.confidenceTier) {
    case 'confirmed_fact':
      return `${companyName}'s own research directly shows evidence of ${problemLabel}.`
    case 'research_supported_signal':
      return `Research findings suggest ${companyName} may be facing ${problemLabel}.`
    case 'industry_pattern':
      return industryLabel
        ? `${industryLabel} companies commonly face ${problemLabel}. This hasn't been directly confirmed for ${companyName} yet.`
        : `Companies like ${companyName} commonly face ${problemLabel}. This hasn't been directly confirmed yet.`
    case 'hypothesis':
    default:
      return `${companyName} may be facing ${problemLabel}, based on a general reading of the research. Not independently confirmed.`
  }
}

export async function buildReasoningText(
  match: SalesIntelligenceMatch,
  companyName: string,
): Promise<{ text: string; source: 'llm' | 'template' }> {
  const template = templateSentence(match, companyName)

  if (!match.problem) return { text: template, source: 'template' }
  if (match.confidenceTier !== 'confirmed_fact' && match.confidenceTier !== 'research_supported_signal') {
    return { text: template, source: 'template' }
  }

  try {
    const systemPrompt =
      'You write one short, honest sentence explaining why a business problem may matter for a specific company, based only on the facts given. Never invent a fact, metric, or claim not present in the evidence given. Respond with plain text only, no quotes, no markdown, exactly one sentence.'
    const userPrompt = `Company: ${companyName}\nProblem: ${match.problem.label}\nEvidence: ${match.reasoning.problem ?? template}\n\nWrite one plain sentence explaining why this may matter for ${companyName}, grounded only in the evidence above.`

    const response = await getCompletion({
      systemPrompt,
      userPrompt,
      maxTokens: 200,
      temperature: 0.4,
      timeoutMs: 15_000,
      jsonMode: false,
    })

    const text = response.content.trim().replace(/^["']|["']$/g, '')
    if (!text) return { text: template, source: 'template' }
    return { text, source: 'llm' }
  } catch {
    return { text: template, source: 'template' }
  }
}
