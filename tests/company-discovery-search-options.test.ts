import { describe, it, expect } from 'vitest'
import { REVENUE_RANGES, EMPLOYEE_RANGES, REGION_OPTIONS, allCountryOptions, countryLabel, formatRevenue } from '@/app/admin/company-discovery/search-options'

describe('company-discovery search-options', () => {
  it('revenue ranges are non-overlapping and cover from 0 to unbounded', () => {
    expect(REVENUE_RANGES[0].min).toBeUndefined()
    expect(REVENUE_RANGES.at(-1)!.max).toBeUndefined()
    for (let i = 0; i < REVENUE_RANGES.length - 1; i++) {
      expect(REVENUE_RANGES[i].max! < REVENUE_RANGES[i + 1].min!).toBe(true)
    }
  })

  it('employee ranges are non-overlapping', () => {
    for (let i = 0; i < EMPLOYEE_RANGES.length - 1; i++) {
      expect(EMPLOYEE_RANGES[i].max! < EMPLOYEE_RANGES[i + 1].min!).toBe(true)
    }
  })

  it('region options map to real 2-letter ISO country codes only', () => {
    for (const region of REGION_OPTIONS) {
      for (const code of region.countries) {
        expect(code).toMatch(/^[A-Z]{2}$/)
      }
    }
  })

  it('allCountryOptions() returns real ISO region codes with labels, no 3-digit UN grouping codes', () => {
    const countries = allCountryOptions()
    expect(countries.length).toBeGreaterThan(100)
    expect(countries.every(c => /^[A-Z]{2}$/.test(c.code))).toBe(true)
    expect(countries.find(c => c.code === 'IN')?.label).toBe('India')
  })

  it('countryLabel() resolves a code to its display name, falling back to the code itself', () => {
    expect(countryLabel('DE')).toBe('Germany')
    expect(countryLabel('ZZ')).toBe('ZZ')
  })

  it('formatRevenue() renders a compact USD string', () => {
    expect(formatRevenue(50_000_000)).toMatch(/\$50M/)
  })
})
