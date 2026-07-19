// ============================================================
// Evidence Extractor — Leadership Contact Extraction
// ============================================================
// Covers the 2026-07-18 decision-maker discovery fix: extractSignals()'s
// leadershipContacts now come from TWO strategies —
//   1. Narrative (pre-existing): markdown heading name + title + a nearby
//      "heads/leads/oversees" portfolio clause. Confidence 'high'.
//   2. Structural (new): tight name+title adjacency only — no heading, no
//      narrative clause required. Catches the common "photo card grid" team
//      page layout. Confidence 'medium'.
// Both strategies share one seenNames set so the narrative match always
// wins for a name mentioned both ways, and a name is never duplicated
// across confidence tiers.
// ============================================================

import { describe, it, expect } from 'vitest'
import { extractSignals } from '../lib/pipeline/evidence-extractor'

describe('extractSignals — leadership contact extraction', () => {
  it('extracts a narrative (heading + portfolio-clause) match at high confidence', () => {
    const content = `
--- PAGE: /leadership (https://example.com/leadership) ---

### Jane Doe

#### Chief Executive Officer

Jane Doe leads the global manufacturing strategy for the entire company.
`
    const result = extractSignals(content)
    const jane = result.leadershipContacts.find(c => c.name === 'Jane Doe')
    expect(jane).toBeDefined()
    expect(jane?.confidence).toBe('high')
    expect(jane?.title).toBe('Chief Executive Officer')
    expect(jane?.statedPortfolio.length).toBeGreaterThan(0)
  })

  it('extracts a structural name+title pair on adjacent lines, no heading, no narrative clause — medium confidence', () => {
    const content = `
--- PAGE: /team (https://example.com/team) ---

Amit Kumar
Chief Technology Officer

Priya Sharma
Chief Marketing Officer
`
    const result = extractSignals(content)

    const amit = result.leadershipContacts.find(c => c.name === 'Amit Kumar')
    expect(amit).toBeDefined()
    expect(amit?.confidence).toBe('medium')
    expect(amit?.title).toBe('Chief Technology Officer')
    expect(amit?.statedPortfolio).toBe('')

    const priya = result.leadershipContacts.find(c => c.name === 'Priya Sharma')
    expect(priya).toBeDefined()
    expect(priya?.confidence).toBe('medium')
    expect(priya?.title).toBe('Chief Marketing Officer')
  })

  it('extracts a same-line "Name, Title" structural pair', () => {
    const content = `
--- PAGE: /team (https://example.com/team) ---

Rahul Verma, Chief Operating Officer
`
    const result = extractSignals(content)
    const rahul = result.leadershipContacts.find(c => c.name === 'Rahul Verma')
    expect(rahul).toBeDefined()
    expect(rahul?.confidence).toBe('medium')
    expect(rahul?.title).toBe('Chief Operating Officer')
  })

  it('rejects a department/job-function phrase adjacent to a title as a false positive', () => {
    const content = `
--- PAGE: /careers (https://example.com/careers) ---

Quality Control
Director

Business Development
President
`
    const result = extractSignals(content)
    expect(result.leadershipContacts.some(c => c.name === 'Quality Control')).toBe(false)
    expect(result.leadershipContacts.some(c => c.name === 'Business Development')).toBe(false)
  })

  it('never surfaces the same person twice across strategies — narrative match wins', () => {
    const content = `
--- PAGE: /leadership (https://example.com/leadership) ---

### Jane Doe

#### Chief Executive Officer

Jane Doe leads the global manufacturing strategy for the entire company.

--- PAGE: /team (https://example.com/team) ---

Jane Doe
Chief Executive Officer
`
    const result = extractSignals(content)
    const janeMatches = result.leadershipContacts.filter(c => c.name === 'Jane Doe')
    expect(janeMatches).toHaveLength(1)
    expect(janeMatches[0].confidence).toBe('high')
  })

  it('returns an empty leadershipContacts array for content with no leadership evidence', () => {
    const content = `
--- PAGE: /products (https://example.com/products) ---

We manufacture industrial valves and pumps for the oil and gas sector.
`
    const result = extractSignals(content)
    expect(result.leadershipContacts).toEqual([])
  })

  it('a "Head of X" title does not greedily swallow text across a line break (2026-07-19 fix)', () => {
    const content = `
--- PAGE: /leadership (https://example.com/leadership) ---

### Sunil Rao

#### Head of Manufacturing

Sunil Rao leads the plant operations team across the entire company.

This next paragraph is unrelated body copy that must never end up inside the title match.
`
    const result = extractSignals(content)
    const sunil = result.leadershipContacts.find(c => c.name === 'Sunil Rao')
    expect(sunil).toBeDefined()
    expect(sunil?.title).toBe('Head of Manufacturing')
    expect(sunil?.title).not.toContain('\n')
    expect(sunil?.title).not.toContain('unrelated body copy')
  })
})
