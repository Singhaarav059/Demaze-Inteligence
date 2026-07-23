// ============================================================
// Evidence Discovery Engine — Item 4 (2026-07-23) query templates +
// source-type classification
// ============================================================
// Covers the pure, network-free pieces added for Phase 1 Item 4:
// executive-change-announcement + earnings-call-transcript/investor-call
// query templates (buildDiscoveryQueries) and their corresponding
// classifySourceType() detection. The search calls themselves
// (searchTavily/searchSerper) are not unit-tested here — same reasoning as
// competitor-discovery.test.ts/company-discovery.test.ts: real HTTP belongs
// in a live verification run, not a unit test.

import { describe, it, expect } from 'vitest'
import {
  classifySourceType,
  buildDiscoveryQueries,
} from '../lib/enrichment/discovery-engine'
import { sourceTypeLabel, prioritizeSources } from '../lib/enrichment/source-prioritizer'
import type { DiscoveredSource } from '../lib/enrichment/discovery-engine'

describe('classifySourceType — earnings_call_transcript (Item 4)', () => {
  it('classifies a URL containing "earnings-call-transcript"', () => {
    expect(
      classifySourceType(
        'https://example.com/investor/q3-fy26-earnings-call-transcript',
        'Q3 FY26 Earnings Call Transcript',
      ),
    ).toBe('earnings_call_transcript')
  })

  it('classifies an Indian-market "concall transcript" URL', () => {
    expect(
      classifySourceType(
        'https://screener.in/company/EXAMPLE/concall-transcript-q2-2026/',
        'Concall Transcript Q2 2026',
      ),
    ).toBe('earnings_call_transcript')
  })

  it('classifies "investor call transcript" phrasing', () => {
    expect(
      classifySourceType(
        'https://example.com/ir/investor-call-transcript-2026.pdf',
        'Investor Call Transcript',
      ),
    ).toBe('earnings_call_transcript')
  })

  it('classifies a plain "transcript" title co-occurring with "conference call" in the URL', () => {
    expect(
      classifySourceType(
        'https://example.com/ir/documents/conference-call-q1-2026',
        'Conference Call Transcript Q1 2026',
      ),
    ).toBe('earnings_call_transcript')
  })

  it('handles the plural "transcripts" form (word-boundary regex must not require exact singular)', () => {
    expect(
      classifySourceType(
        'https://example.com/ir/earnings-call-transcripts',
        'Earnings Call Transcripts Archive',
      ),
    ).toBe('earnings_call_transcript')
  })

  it('does NOT classify a bare "transcript" mention with no earnings/investor-call context as a transcript', () => {
    // Word-boundary discipline (CLAUDE.md's 'ir'/'sec' bug-class guard):
    // "transcript" alone, with no earnings-call/investor-call/concall/
    // conference-call/quarterly cue, must not false-positive.
    const result = classifySourceType(
      'https://example.com/blog/podcast-transcript-company-culture',
      'Podcast Transcript: Company Culture',
    )
    expect(result).not.toBe('earnings_call_transcript')
    expect(result).toBe('official_blog')
  })

  it('does NOT false-positive on "recall" (substring containing "call")', () => {
    const result = classifySourceType(
      'https://example.com/news/product-recall-2026',
      'Company Issues Massive Product Recall',
    )
    expect(result).not.toBe('earnings_call_transcript')
  })
})

describe('classifySourceType — executive_change_announcement (Item 4)', () => {
  it('classifies "appoints new CEO"', () => {
    expect(
      classifySourceType(
        'https://example.com/news/company-appoints-new-ceo',
        'Company Appoints New CEO to Lead Next Phase of Growth',
      ),
    ).toBe('executive_change_announcement')
  })

  it('classifies "steps down as CEO"', () => {
    expect(
      classifySourceType(
        'https://example.com/news/leadership-update',
        'John Doe Steps Down as CEO After 10 Years',
      ),
    ).toBe('executive_change_announcement')
  })

  it('classifies "leadership transition"', () => {
    expect(
      classifySourceType(
        'https://example.com/press/announcement',
        'Company Announces Leadership Transition',
      ),
    ).toBe('executive_change_announcement')
  })

  it('classifies "management change"', () => {
    expect(
      classifySourceType(
        'https://example.com/news/update',
        'Board Approves Management Change Effective Immediately',
      ),
    ).toBe('executive_change_announcement')
  })

  it('classifies "appointed as CFO"', () => {
    expect(
      classifySourceType(
        'https://example.com/news/finance-update',
        'Jane Smith Appointed as CFO',
      ),
    ).toBe('executive_change_announcement')
  })

  it('classifies "X succeeds Y as CEO"', () => {
    expect(
      classifySourceType(
        'https://example.com/news/succession',
        'Jane Smith Succeeds John Doe as CEO',
      ),
    ).toBe('executive_change_announcement')
  })

  it('takes priority over the generic press_release URL pattern when both match', () => {
    // A real press release announcing a new CEO — the more specific
    // executive_change_announcement classification must win, per the
    // check-order comment in classifySourceType.
    expect(
      classifySourceType(
        'https://example.com/press-release/company-appoints-new-ceo',
        'Press Release: Company Appoints New CEO',
      ),
    ).toBe('executive_change_announcement')
  })

  it('an unrelated press release still classifies as press_release (no regression)', () => {
    expect(
      classifySourceType(
        'https://example.com/press-release/company-launches-new-product',
        'Company Launches New Product Line',
      ),
    ).toBe('press_release')
  })
})

describe('buildDiscoveryQueries — new Item 4 templates present, existing ones unaffected', () => {
  const queries = buildDiscoveryQueries('Ador Welding')
  const queryStrings = queries.map(q => q.query)

  it('includes an earnings-call-transcript query under the investor category', () => {
    const match = queries.find(q => q.query.toLowerCase().includes('earnings call transcript'))
    expect(match).toBeDefined()
    expect(match?.category).toBe('investor')
  })

  it('includes an investor-call-transcript query under the investor category', () => {
    const match = queries.find(q => q.query.toLowerCase().includes('investor call transcript'))
    expect(match).toBeDefined()
    expect(match?.category).toBe('investor')
  })

  it('includes an executive-change "appoints new CEO" query under the leadership category', () => {
    const match = queries.find(q => q.query.toLowerCase().includes('appoints new ceo'))
    expect(match).toBeDefined()
    expect(match?.category).toBe('leadership')
  })

  it('includes a "steps down / leadership transition" query under the leadership category', () => {
    const match = queries.find(q => q.query.toLowerCase().includes('steps down'))
    expect(match).toBeDefined()
    expect(match?.category).toBe('leadership')
  })

  it('includes a "management change" query under the leadership category', () => {
    const match = queries.find(q => q.query.toLowerCase().includes('management change'))
    expect(match).toBeDefined()
    expect(match?.category).toBe('leadership')
  })

  it('every query is scoped to the given company name (quoted)', () => {
    for (const q of queryStrings) {
      expect(q).toContain('"Ador Welding"')
    }
  })

  it('did not remove any pre-existing query templates (non-regression count floor)', () => {
    // Pre-Item-4 baseline had 14 templates. This must only grow.
    expect(queries.length).toBeGreaterThanOrEqual(14 + 5)
  })
})

describe('sourceTypeLabel — new Item 4 source types', () => {
  it('labels earnings_call_transcript', () => {
    expect(sourceTypeLabel('earnings_call_transcript')).toBe('Earnings Call Transcript')
  })

  it('labels executive_change_announcement', () => {
    expect(sourceTypeLabel('executive_change_announcement')).toBe('Executive Change Announcement')
  })
})

describe('prioritizeSources — earnings_call_transcript competes for a guaranteed slot', () => {
  function source(partial: Partial<DiscoveredSource>): DiscoveredSource {
    return {
      url: 'https://example.com/a',
      title: 'title',
      snippet: '',
      source_type: 'other',
      evidence_strength: 'low',
      priority_score: 10,
      query_category: 'investor',
      ...partial,
    }
  }

  it('selects an earnings_call_transcript even with no annual_report/investor_presentation/earnings_release present', () => {
    const discovered: DiscoveredSource[] = [
      source({ url: 'https://a.com/transcript', source_type: 'earnings_call_transcript', evidence_strength: 'very_high', priority_score: 88 }),
      source({ url: 'https://b.com/blog', source_type: 'official_blog', evidence_strength: 'medium', priority_score: 50 }),
      source({ url: 'https://c.com/news', source_type: 'news_article', evidence_strength: 'medium', priority_score: 45 }),
    ]
    const result = prioritizeSources(discovered, 5)
    const selected = result.filter(r => r.should_fetch)
    expect(selected.some(s => s.source_type === 'earnings_call_transcript')).toBe(true)
    expect(selected[0].source_type).toBe('earnings_call_transcript')
  })
})
