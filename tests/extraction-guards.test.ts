import { describe, it, expect } from 'vitest'
import { mentionsCompany, looksLikeSentenceFragment, filterRelevantResults, toQueryPhrase } from '../lib/enrichment/extraction-guards'

describe('mentionsCompany — source-relevance gate', () => {
  it('rejects a page that never mentions the researched company (the live Codemech bug)', () => {
    const text = 'Industries We Serve at Codemech Solutions. At Codemech Solutions, we design and develop future-ready digital solutions.'
    expect(mentionsCompany(text, 'Demaze')).toBe(false)
  })

  it('rejects an unrelated social post that happens to contain "customers include" (the live AWS-outage bug)', () => {
    const text = "AWS customers include some of the world's biggest businesses and organizations."
    expect(mentionsCompany(text, 'Demaze')).toBe(false)
  })

  it('rejects a generic directory/RSS feed page (the live how2shout bug)', () => {
    const text = 'Archives | Alternatives H2S'
    expect(mentionsCompany(text, 'Demaze')).toBe(false)
  })

  it('accepts a page that actually names the company (single-word name)', () => {
    const text = 'Demaze is a strategic partner in building scalable AI products.'
    expect(mentionsCompany(text, 'Demaze')).toBe(true)
  })

  it('accepts a page that names a two-word company in full', () => {
    const text = 'Ador Welding reported strong quarterly results driven by shipbuilding and oil and gas demand.'
    expect(mentionsCompany(text, 'Ador Welding')).toBe(true)
  })

  it('rejects a page naming only one word of a two-word company (both words required for short names)', () => {
    const text = 'Welding equipment demand rose across the industrial sector this year.'
    expect(mentionsCompany(text, 'Ador Welding')).toBe(false)
  })

  it('accepts a majority match for a longer, multi-word company name', () => {
    const text = 'Bharat Forge Automotive announced record exports this quarter.'
    expect(mentionsCompany(text, 'Bharat Forge Automotive Components')).toBe(true)
  })

  it('rejects a minority match for a longer, multi-word company name', () => {
    const text = 'Bharat Forge Limited announced record exports this quarter.'
    expect(mentionsCompany(text, 'Bharat Forge Automotive Components')).toBe(false)
  })

  it('does not block when the company name has no significant words to check', () => {
    expect(mentionsCompany('anything at all', '')).toBe(true)
  })
})

describe('looksLikeSentenceFragment', () => {
  it('flags a run-on fragment starting with a preposition (the live Codemech bug)', () => {
    expect(looksLikeSentenceFragment('at Codemech Solutions')).toBe(true)
  })

  it('flags a fragment starting with "some of the" (the live AWS-outage bug)', () => {
    expect(looksLikeSentenceFragment('some of the world’s biggest businesses')).toBe(true)
    expect(looksLikeSentenceFragment('some of the')).toBe(true)
  })

  it('flags a fragment starting with "as" (the live homepage-marketing-copy bug)', () => {
    expect(looksLikeSentenceFragment('as a powerful backend system for the sales team')).toBe(true)
  })

  it('flags an image-filename/asset shape (the live how2shout bug)', () => {
    expect(looksLikeSentenceFragment('Alternative-H2s-48x48')).toBe(true)
  })

  it('does not flag a real company name', () => {
    expect(looksLikeSentenceFragment('Ace Pipeline')).toBe(false)
    expect(looksLikeSentenceFragment('ATE Group')).toBe(false)
  })

  it('does not flag a real ICP segment name', () => {
    expect(looksLikeSentenceFragment('oil and gas')).toBe(false)
    expect(looksLikeSentenceFragment('automotive manufacturers')).toBe(false)
  })

  it('flags empty input', () => {
    expect(looksLikeSentenceFragment('')).toBe(true)
    expect(looksLikeSentenceFragment('   ')).toBe(true)
  })
})

describe('filterRelevantResults', () => {
  it('drops results that never mention the company, keeps the ones that do', () => {
    const results = [
      { title: 'Industries We Serve at Codemech Solutions', content: 'At Codemech Solutions, we design digital solutions.' },
      { title: 'Demaze - AI Products', content: 'Demaze builds scalable AI products for enterprise clients.' },
    ]
    const survivors = filterRelevantResults(results, 'Demaze')
    expect(survivors).toHaveLength(1)
    expect(survivors[0].title).toBe('Demaze - AI Products')
  })
})

describe('toQueryPhrase — shortening an offering for use inside a quoted search query', () => {
  it('clips at the first clause-break connector (the live demazetech.com bug)', () => {
    // Found live 2026-07-16: quoting this full sentence in a search query
    // returned zero results for both competitor and ICP discovery.
    expect(toQueryPhrase('Cloud architectures that ensure scalability, security, and resilience for modern businesses'))
      .toBe('Cloud architectures')
  })

  it('leaves a short offering with no clause-break unchanged', () => {
    expect(toQueryPhrase('robotic welding automation')).toBe('robotic welding automation')
  })

  it('caps at maxWords even with no clause-break', () => {
    expect(toQueryPhrase('one two three four five six seven eight')).toBe('one two three four five six')
  })

  it('does not clip on a connector appearing too early to be a real clause boundary', () => {
    expect(toQueryPhrase('to build custom AI products')).toBe('to build custom AI products')
  })
})
