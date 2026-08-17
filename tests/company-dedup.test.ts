import { describe, it, expect } from 'vitest'
import { dedupeCompanies } from '../lib/batch/company-dedup'
import type { LeadRow } from '../lib/batch/file-parser'

function row(overrides: Partial<LeadRow>): LeadRow {
  return { companyName: 'Acme Corp', personName: 'Jane Doe', ...overrides } as LeadRow
}

describe('dedupeCompanies — name normalization', () => {
  it('does not falsely flag two unrelated accented-name companies as possible duplicates (the \\w-ASCII bug)', () => {
    // \w is ASCII-only in JS — without the \p{L}/\p{N} fix, "Möller"
    // (one word) fragments into ["m", "ller"] instead of staying one word,
    // inflating wordOverlapRatio's denominator/numerator enough to cross
    // the 0.5 'partial' threshold for two otherwise-unrelated companies
    // that only share a generic word ("group") plus the accented fragment
    // — verified this exact case: buggy ratio 0.5 (flagged), fixed 0.33 (not).
    const result = dedupeCompanies([
      row({ companyName: 'Möller', personName: 'A' }),
      row({ companyName: 'Möller International Group', personName: 'B' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0].possibleDuplicateOf).toHaveLength(0)
    expect(result[1].possibleDuplicateOf).toHaveLength(0)
  })

  it('still merges on exact normalized match for a plain ASCII name (non-regression)', () => {
    const result = dedupeCompanies([
      row({ companyName: 'Acme Corp', personName: 'A' }),
      row({ companyName: 'Acme Corporation', personName: 'B' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].contacts).toHaveLength(2)
  })

  it('merges on matching domain even if the name differs', () => {
    const result = dedupeCompanies([
      row({ companyName: 'Acme Corp', companyWebsite: 'https://acme.com', personName: 'A' }),
      row({ companyName: 'Acme Co.', companyWebsite: 'https://www.acme.com/about', personName: 'B' }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].contacts).toHaveLength(2)
  })

  it('flags a weak partial-word match as a possible duplicate instead of merging', () => {
    const result = dedupeCompanies([
      row({ companyName: 'Acme Global Industries', personName: 'A' }),
      row({ companyName: 'Acme Industries', personName: 'B' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0].possibleDuplicateOf).toContain(result[1].companyName)
  })

  it('keeps two genuinely unrelated companies separate', () => {
    const result = dedupeCompanies([
      row({ companyName: 'Acme Corp', personName: 'A' }),
      row({ companyName: 'Zenith Industries', personName: 'B' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0].possibleDuplicateOf).toHaveLength(0)
  })
})
