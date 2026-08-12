import { describe, it, expect } from 'vitest'
import { recommendTitlesFromResearch } from '@/lib/outbound/decision-maker-discovery/role-recommendation'
import { DEFAULT_TARGET_TITLES } from '@/lib/outbound/decision-maker-discovery/types'

describe('recommendTitlesFromResearch', () => {
  it('falls back to DEFAULT_TARGET_TITLES with fromResearch=false when no analysisResult is given', () => {
    const result = recommendTitlesFromResearch(null)
    expect(result).toHaveLength(1)
    expect(result[0].fromResearch).toBe(false)
    expect(result[0].titles).toEqual(DEFAULT_TARGET_TITLES)
  })

  it('recommends operations titles from a manufacturing/plant pain point', () => {
    const analysisResult = {
      pain_points_structured: [{ title: 'No unified reporting across 6 manufacturing facilities' }],
    }
    const result = recommendTitlesFromResearch(analysisResult)
    expect(result.some(g => g.fromResearch && g.titles.includes('VP Operations'))).toBe(true)
  })

  it('recommends technology titles from an opportunity mentioning automation/software', () => {
    const analysisResult = {
      opportunities: [{ title: 'AI integrations and intelligent automation', description: 'Legacy software platform with no automation layer' }],
    }
    const result = recommendTitlesFromResearch(analysisResult)
    expect(result.some(g => g.fromResearch && g.titles.includes('CTO'))).toBe(true)
  })

  it('recommends sales/marketing titles from outreach intelligence', () => {
    const analysisResult = {
      outreach_intelligence: { likely_problem: 'Sales pipeline growth has stalled, demand generation is inconsistent' },
    }
    const result = recommendTitlesFromResearch(analysisResult)
    expect(result.some(g => g.fromResearch && g.titles.includes('CRO'))).toBe(true)
  })

  it('can match more than one group when a company shows multiple signals', () => {
    const analysisResult = {
      pain_points_structured: [{ title: 'Plant Head lacks unified manufacturing reporting' }],
      opportunities: [{ title: 'AI integrations and intelligent automation', description: 'legacy software' }],
    }
    const result = recommendTitlesFromResearch(analysisResult)
    const matchedGroups = result.filter(g => g.fromResearch)
    expect(matchedGroups.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back honestly when analysisResult has no matching signal text', () => {
    const result = recommendTitlesFromResearch({ company_summary: 'A generic company description with no matched keywords.' })
    expect(result).toHaveLength(1)
    expect(result[0].fromResearch).toBe(false)
  })
})
