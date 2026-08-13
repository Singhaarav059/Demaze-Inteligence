import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCompletionMock = vi.fn()

vi.mock('@/lib/ai/provider-factory', () => ({
  getCompletion: (...args: unknown[]) => getCompletionMock(...args),
}))

import { buildReasoningText } from '@/lib/sales-knowledge/reasoning'
import type { SalesIntelligenceMatch, SalesKnowledgeProblem, SalesKnowledgeIndustry } from '@/lib/sales-knowledge/types'

function mockResponse(content: string) {
  return { content, model: 'test-model', providerName: 'test-provider', tokensUsed: 10, latencyMs: 5 }
}

function problem(overrides: Partial<SalesKnowledgeProblem> = {}): SalesKnowledgeProblem {
  return {
    id: 'p1', slug: 'no-hq-visibility', label: 'HQ lacks visibility', description: null,
    industry_tags: [], evidence_keywords: [], capability_tags: [], is_active: true,
    created_at: '', updated_at: '', ...overrides,
  }
}

function industry(overrides: Partial<SalesKnowledgeIndustry> = {}): SalesKnowledgeIndustry {
  return { id: 'i1', slug: 'manufacturing', label: 'Manufacturing', description: null, keywords: [], is_active: true, created_at: '', updated_at: '', ...overrides }
}

function match(overrides: Partial<SalesIntelligenceMatch> = {}): SalesIntelligenceMatch {
  return {
    industry: null, problem: problem(), capability: null, caseStudies: [], roles: [], cta: null,
    confidenceTier: 'confirmed_fact', reasoning: { problem: 'evidence text' },
    ...overrides,
  }
}

describe('buildReasoningText', () => {
  beforeEach(() => {
    getCompletionMock.mockReset()
  })

  it('returns the template sentence with no problem match, never calling the LLM', async () => {
    const result = await buildReasoningText(match({ problem: null }), 'Acme Corp')
    expect(result.source).toBe('template')
    expect(result.text).toBe('')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('never calls the LLM for industry_pattern tier', async () => {
    const result = await buildReasoningText(match({ confidenceTier: 'industry_pattern', industry: industry() }), 'Acme Corp')
    expect(result.source).toBe('template')
    expect(result.text).toContain('Manufacturing')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('never calls the LLM for hypothesis tier', async () => {
    const result = await buildReasoningText(match({ confidenceTier: 'hypothesis' }), 'Acme Corp')
    expect(result.source).toBe('template')
    expect(result.text).toContain('Acme Corp')
    expect(getCompletionMock).not.toHaveBeenCalled()
  })

  it('attempts an LLM call for confirmed_fact tier and uses its output on success', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('Acme Corp shows clear signs of this problem in its own reporting.'))
    const result = await buildReasoningText(match({ confidenceTier: 'confirmed_fact' }), 'Acme Corp')
    expect(getCompletionMock).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('llm')
    expect(result.text).toBe('Acme Corp shows clear signs of this problem in its own reporting.')
  })

  it('attempts an LLM call for research_supported_signal tier', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('A plausible sentence.'))
    const result = await buildReasoningText(match({ confidenceTier: 'research_supported_signal' }), 'Acme Corp')
    expect(getCompletionMock).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('llm')
  })

  it('falls back to the template when the LLM call throws', async () => {
    getCompletionMock.mockRejectedValue(new Error('timeout'))
    const result = await buildReasoningText(match({ confidenceTier: 'confirmed_fact' }), 'Acme Corp')
    expect(result.source).toBe('template')
    expect(result.text).toContain('Acme Corp')
  })

  it('falls back to the template when the LLM returns empty content', async () => {
    getCompletionMock.mockResolvedValue(mockResponse('   '))
    const result = await buildReasoningText(match({ confidenceTier: 'confirmed_fact' }), 'Acme Corp')
    expect(result.source).toBe('template')
  })
})
