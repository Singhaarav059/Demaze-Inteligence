// ============================================================
// Benchmark fixture set — filename/content integrity (2026-07-23)
// ============================================================
// Regression guard for the filename/content mismatch documented in
// CLAUDE.md's "Benchmark set" section: benchmarks/companies/*.json files
// used to hold content that didn't match their own filenames (e.g.
// bharat-forge.json actually held the AITG spec). benchmarks/run-benchmark.ts's
// loadSpecs() reads every *.json file in that directory regardless of its
// filename (only spec.name/url/expectations matter to the runner), so this
// test does not exercise the runner itself — it verifies the on-disk fixture
// set directly: every file is valid JSON matching the BenchmarkSpec shape,
// no duplicate names/URLs, the 3 originally-mismatched files now carry a
// filename that matches their own content, and the original 3-company
// reference set (Bharat Forge, Muthoot Finance, Chargebee) is present and
// wired into the same directory the automated `npm run benchmark` run reads.
// Pure fs + JSON.parse — no network, no server required.

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { BenchmarkSpec } from '../benchmarks/benchmark-types'

const companiesDir = path.resolve(process.cwd(), 'benchmarks', 'companies')

function loadSpecs(): Array<{ file: string; spec: BenchmarkSpec }> {
  const files = fs.readdirSync(companiesDir).filter(f => f.endsWith('.json'))
  return files.map(file => ({
    file,
    spec: JSON.parse(fs.readFileSync(path.join(companiesDir, file), 'utf-8')) as BenchmarkSpec,
  }))
}

describe('benchmark fixture set (benchmarks/companies/*.json)', () => {
  it('every file is valid JSON matching the BenchmarkSpec shape', () => {
    const entries = loadSpecs()
    expect(entries.length).toBeGreaterThan(0)
    for (const { file, spec } of entries) {
      expect(typeof spec.name, `${file}: name`).toBe('string')
      expect(spec.name.length, `${file}: name non-empty`).toBeGreaterThan(0)
      expect(typeof spec.url, `${file}: url`).toBe('string')
      expect(spec.url.startsWith('http'), `${file}: url looks like a URL`).toBe(true)
      expect(spec.expectations, `${file}: expectations present`).toBeTruthy()
      expect(typeof spec.expectations.minSignals, `${file}: minSignals`).toBe('number')
      expect(typeof spec.expectations.minOpportunities, `${file}: minOpportunities`).toBe('number')
      expect(typeof spec.expectations.minChallenges, `${file}: minChallenges`).toBe('number')
      expect(Array.isArray(spec.expectations.requiredProfileFlags), `${file}: requiredProfileFlags`).toBe(true)
      expect(Array.isArray(spec.expectations.forbiddenTerms), `${file}: forbiddenTerms`).toBe(true)
    }
  })

  it('has no duplicate company names or URLs across the fixture set', () => {
    const entries = loadSpecs()
    const names = entries.map(e => e.spec.name)
    const urls = entries.map(e => e.spec.url)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('the 3 previously-mismatched files now carry a filename matching their own content', () => {
    // Historical mismatch (see CLAUDE.md "Benchmark set" section):
    // bharat-forge.json held the AITG spec, hdfc-bank.json held A-1 Fence
    // Products, zoho.json held ATE Group. Fixed by renaming the files to
    // match their content (loadSpecs() never depended on filename, so this
    // is a pure organizational fix, not a behavior change).
    const byName = new Map(loadSpecs().map(({ file, spec }) => [spec.name, file]))
    expect(byName.get('AITG')).toBe('aitg.json')
    expect(byName.get('A-1 Fence Products')).toBe('a1-fence-products.json')
    expect(byName.get('ATE Group')).toBe('ate-group.json')
    // And the filenames that used to hold the wrong content no longer exist
    // at all — confirms this was a rename, not an add-alongside.
    const files = new Set(loadSpecs().map(e => e.file))
    expect(files.has('hdfc-bank.json')).toBe(false)
    expect(files.has('zoho.json')).toBe(false)
  })

  it('includes the original 3-company reference set (Bharat Forge, Muthoot Finance, Chargebee)', () => {
    // CLAUDE.md: "the original 3-company reference set... is NOT in the
    // active `npm run benchmark` run at all — 'do not regress these' above
    // is currently unenforced by automation." This test is the enforcement:
    // loadSpecs() reads every file in this directory, so once these 3 files
    // exist here they are automatically included in every `npm run benchmark`
    // run without any other wiring required.
    const byName = new Map(loadSpecs().map(({ spec }) => [spec.name, spec]))

    const bharatForge = byName.get('Bharat Forge')
    expect(bharatForge).toBeTruthy()
    expect(bharatForge?.url).toContain('bharatforge.com')
    expect(bharatForge?.expectations.requiredProfileFlags).toContain('manufacturer')
    expect(bharatForge?.expectations.expectedPrimaryType).toBe('manufacturer')

    const muthoot = byName.get('Muthoot Finance')
    expect(muthoot).toBeTruthy()
    expect(muthoot?.url).toContain('muthootfinance.com')

    const chargebee = byName.get('Chargebee')
    expect(chargebee).toBeTruthy()
    expect(chargebee?.url).toContain('chargebee.com')
    expect(chargebee?.expectations.requiredProfileFlags).toContain('software_saas')
    expect(chargebee?.expectations.expectedPrimaryType).toBe('software_saas')
  })

  it('includes the full current 6-company benchmark set plus the 3-company reference set (9 total)', () => {
    const names = new Set(loadSpecs().map(({ spec }) => spec.name))
    const expected = [
      'Ace Pipeline', 'Ador Welding', 'AS Agri and Aqua', 'AITG',
      'A-1 Fence Products', 'ATE Group',
      'Bharat Forge', 'Muthoot Finance', 'Chargebee',
    ]
    for (const name of expected) {
      expect(names.has(name), `expected fixture for "${name}"`).toBe(true)
    }
    expect(names.size).toBe(expected.length)
  })
})
