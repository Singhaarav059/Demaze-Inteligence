// ============================================================
// Company Universe — structured+search vs. search-only comparison
// ============================================================
// Demaze_Multi_Source_Company_Universe_Claude_Prompt.md, Section 27:
// "Benchmark the new system against current Google discovery. Mandatory."
// Compares the OLD path (POST /api/admin/company-discovery — search-
// grounded discoverCompanies(), unmodified by this session's work) against
// the NEW path (POST /api/admin/company-universe/discover — structured
// sources first, per lib/company-universe/discovery.ts) across a 9-cell
// grid: {Manufacturing, Automotive, E-commerce} x {South Asia, Europe+UK,
// North America} — the same 3 active target sectors CLAUDE.md's
// DEMAZE_CONFIRMED_SECTORS already documents, crossed with 3 regions.
//
// NOT RUN in this session. Two independent reasons, stated plainly rather
// than glossed over:
//   1. This session's network egress policy blocks every one of the 4
//      structured providers (GLEIF, SEC EDGAR, Companies House, India MCA)
//      AND the search providers (Tavily/Serper) the old
//      path depends on — confirmed via direct curl/WebFetch returning
//      EGRESS_BLOCKED/403 for every one of them before this file was
//      written. A run here would produce all-zero/all-error results that
//      would misrepresent both paths as equally broken.
//   2. Even without the network block, running this spends real Tavily/
//      Serper/LLM quota on the old-path calls — this repo's own standing
//      discipline requires explicit user confirmation before any run that
//      spends real API quota, same as every benchmark run CLAUDE.md
//      documents elsewhere.
//
// Usage (once network access + real provider credentials + explicit
// confirmation are all in place):
//   BASE_URL=http://localhost:3000 ADMIN_SECRET=... npx tsx benchmarks/company-universe-comparison.ts
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: '.env.local' })

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const ADMIN_SECRET = process.env.ADMIN_SECRET

const SECTORS = ['Manufacturing', 'Automotive', 'E-commerce'] as const
// One representative country code per region for the structured path's
// current single-countryCode query model (Section 16 — "if a provider
// cannot support a filter, don't pretend it can" applies to this
// benchmark's own query construction too: it does not pretend to cover a
// whole region with one country code, it documents the simplification).
const REGIONS: Array<{ name: string; countryCode: string; searchPhrase: string }> = [
  { name: 'South Asia', countryCode: 'IN', searchPhrase: 'South Asia' },
  { name: 'Europe + UK', countryCode: 'GB', searchPhrase: 'Europe' },
  { name: 'North America', countryCode: 'US', searchPhrase: 'North America' },
]

// Section 19's known mega-cap failure fixtures — used here as a leakage
// check, not as production rejection logic (that hard rule is about
// company-discovery.ts's own runtime code, not this offline benchmark
// script).
const KNOWN_MEGA_CAPS = new Set([
  'bmw', 'audi', 'porsche', 'mini', 'volvo', 'jaguar', 'land rover', 'maruti suzuki', 'jcb',
  'tencent', 'jacobs solutions', 'fluor', 'murata manufacturing', 'murata vietnam',
  'robert bosch gmbh', "o'reilly automotive", 'lear', 'bilfinger tebodin',
])

const NON_COMPANY_ENTITY_WORDS = ['industrial park', 'industrial estate', 'economic zone', 'chamber of commerce', 'ministry', 'association']

interface CellResult {
  sector: string
  region: string
  oldPath: { totalCandidates: number; names: string[]; error?: string }
  newPath: { totalCandidates: number; qualified: number; unknownSize: number; providersQueriedLive: string[]; providersSkipped: Array<{ provider: string; reason: string }>; names: string[]; error?: string }
  foundOnlyByStructured: string[]
  foundOnlyBySearch: string[]
  foundByBoth: string[]
  duplicateRateOld: number
  megaCapLeakageOld: string[]
  entityTypeErrorsOld: string[]
}

function normalizeForCompare(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

async function callOldPath(sector: string, region: { searchPhrase: string }): Promise<CellResult['oldPath']> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/company-discovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-token': ADMIN_SECRET } : {}) },
      body: JSON.stringify({ icpSegment: `${sector} companies in ${region.searchPhrase}` }),
    })
    const data = await res.json()
    const names: string[] = (data.companies ?? []).map((c: { name: string }) => c.name)
    return { totalCandidates: names.length, names }
  } catch (e) {
    return { totalCandidates: 0, names: [], error: e instanceof Error ? e.message : String(e) }
  }
}

async function callNewPath(sector: string, region: { countryCode: string }): Promise<CellResult['newPath']> {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/company-universe/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ADMIN_SECRET ? { 'x-admin-token': ADMIN_SECRET } : {}) },
      body: JSON.stringify({ industry: sector, countryCode: region.countryCode, employeeCountMax: 5000, limit: 50 }),
    })
    const data = await res.json()
    const candidates = data.candidates ?? []
    const names: string[] = candidates.map((c: { fields: { canonicalName: string } }) => c.fields.canonicalName)
    const qualified = candidates.filter((c: { sizeQualification: { verdict: string } }) => c.sizeQualification.verdict !== 'reject').length
    const unknownSize = candidates.filter((c: { fields: { employeeCount?: number; revenue?: number } }) => c.fields.employeeCount === undefined && c.fields.revenue === undefined).length
    return {
      totalCandidates: names.length, qualified, unknownSize, names,
      providersQueriedLive: data.providersQueriedLive ?? [],
      providersSkipped: data.providersSkipped ?? [],
    }
  } catch (e) {
    return { totalCandidates: 0, qualified: 0, unknownSize: 0, providersQueriedLive: [], providersSkipped: [], names: [], error: e instanceof Error ? e.message : String(e) }
  }
}

async function runCell(sector: string, region: typeof REGIONS[number]): Promise<CellResult> {
  const [oldPath, newPath] = await Promise.all([callOldPath(sector, region), callNewPath(sector, region)])

  const oldNorm = new Set(oldPath.names.map(normalizeForCompare))
  const newNorm = new Set(newPath.names.map(normalizeForCompare))
  const foundOnlyByStructured = [...newNorm].filter(n => !oldNorm.has(n))
  const foundOnlyBySearch = [...oldNorm].filter(n => !newNorm.has(n))
  const foundByBoth = [...oldNorm].filter(n => newNorm.has(n))

  const duplicateRateOld = oldPath.names.length > 0 ? 1 - oldNorm.size / oldPath.names.length : 0
  const megaCapLeakageOld = oldPath.names.filter(n => KNOWN_MEGA_CAPS.has(normalizeForCompare(n)))
  const entityTypeErrorsOld = oldPath.names.filter(n => NON_COMPANY_ENTITY_WORDS.some(w => normalizeForCompare(n).includes(w)))

  return { sector, region: region.name, oldPath, newPath, foundOnlyByStructured, foundOnlyBySearch, foundByBoth, duplicateRateOld, megaCapLeakageOld, entityTypeErrorsOld }
}

async function main() {
  console.log(`Company Universe comparison — ${BASE_URL}`)
  console.log('9 cells: 3 sectors x 3 regions\n')

  const results: CellResult[] = []
  for (const sector of SECTORS) {
    for (const region of REGIONS) {
      console.log(`Running: ${sector} x ${region.name}...`)
      results.push(await runCell(sector, region))
    }
  }

  const summary = {
    totalOldCandidates: results.reduce((s, r) => s + r.oldPath.totalCandidates, 0),
    totalNewCandidates: results.reduce((s, r) => s + r.newPath.totalCandidates, 0),
    totalNewQualified: results.reduce((s, r) => s + r.newPath.qualified, 0),
    totalFoundOnlyByStructured: results.reduce((s, r) => s + r.foundOnlyByStructured.length, 0),
    totalFoundOnlyBySearch: results.reduce((s, r) => s + r.foundOnlyBySearch.length, 0),
    totalFoundByBoth: results.reduce((s, r) => s + r.foundByBoth.length, 0),
    totalMegaCapLeakageOld: results.reduce((s, r) => s + r.megaCapLeakageOld.length, 0),
    totalEntityTypeErrorsOld: results.reduce((s, r) => s + r.entityTypeErrorsOld.length, 0),
  }

  const outDir = path.join(__dirname, 'results-history')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `company-universe-comparison-${new Date().toISOString().slice(0, 10)}.json`)
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2))

  console.log('\n=== Summary ===')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nFull results written to ${outPath}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
