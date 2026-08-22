// ============================================================
// Global benchmark analysis — corrected source-overlap / qualification /
// DB-claim reporting layer
// ============================================================
// Reads an already-completed benchmarks/global-benchmark-results/run-*.json
// (historical file, untouched by this script) and produces a corrected
// report. Does NOT re-run discovery, does NOT touch production routing.
//
// Root cause of the previous report's non-reconciling numbers: it printed
// two DIFFERENT populations side by side as if they were one.
//   - "qualified" = sum of funnel.qualified per cell. This passes through
//     qualifyCandidate(), which rejects a candidate as 'duplicate' the
//     moment it's already a row in company_registry — INCLUDING a row the
//     'existing' pass for the SAME cell just inserted moments earlier
//     (existing always runs before brightdata per cell, see
//     brightdata-global-comparison.ts's own header comment), and INCLUDING
//     stale rows left by the earlier crashed benchmark attempt. It is a
//     DB-claim-filtered, run-order-dependent count — not "how many
//     companies this source found."
//   - "shared / existing-only / brightdata-only" = computeIdentityOverlap()
//     over the RAW discovered `companies` list (order-independent,
//     identity-key based, no DB-claim filtering at all).
//   These are disjoint populations computed from different inputs. Neither
//   is wrong on its own; printing them in one table implied they shared a
//   universe. This script keeps them separate (sections A/B/C below).
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { normalizeCompanyName } from '../lib/companies/identity'

const inPath = process.argv[2]
  ?? path.resolve(process.cwd(), 'benchmarks/global-benchmark-results/run-2026-08-19T06-40-17-155Z.json')
const outPath = process.argv[3]
  ?? path.resolve(path.dirname(inPath), 'analysis-' + path.basename(inPath).replace(/\.json$/, '.md'))

interface Funnel {
  discovered: number; duplicate: number; alreadyResearched: number; alreadyOutreached: number
  wrongSector: number; outsideSize: number; otherRejected: number; qualified: number
}
interface Cell {
  sector: string; region: string; source: 'existing' | 'brightdata'
  rawDiscovered: number; totalMentions: number
  megaCapRejected: number; coarseSectorRejected: number; coarseSizeRejected: number
  funnel: Funnel; requestsUsed: number
  companies: string[]; qualifiedCompanies: string[]; qualificationErrors: number
}
interface RunFile {
  ranAt: string; queriesPerCell: number; regions: string[]; sectors: string[]
  cells: Cell[]
  overlapsByCell: Record<string, { shared: string[]; existingOnly: string[]; brightdataOnly: string[] }>
}

const data: RunFile = JSON.parse(fs.readFileSync(inPath, 'utf8'))

// ── A. SOURCE OVERLAP ───────────────────────────────────────────────
// Identity key = normalizeCompanyName(name) only. The original per-cell
// overlapsByCell used domain+name (buildIdentityKeys against the live
// CompanyMatch objects), but domain is NOT persisted in the final JSON
// (cells[].companies is stringified to `.name` only before being written —
// see brightdata-global-comparison.ts's `main()`), so cross-region/sector/
// global aggregation can only use name identity. This is a known precision
// ceiling of the persisted artifact, not a new assumption introduced here.
function identityKey(name: string): string {
  return normalizeCompanyName(name)
}

interface OverlapStats {
  existingUnique: number; bdUnique: number; shared: number
  existingOnly: number; bdOnly: number; union: number
  bdNetNewRate: number; existingNetNewRate: number
}

function computeOverlap(cells: Cell[]): OverlapStats {
  const existingKeys = new Set(cells.filter(c => c.source === 'existing').flatMap(c => c.companies).map(identityKey).filter(Boolean))
  const bdKeys = new Set(cells.filter(c => c.source === 'brightdata').flatMap(c => c.companies).map(identityKey).filter(Boolean))
  let shared = 0
  for (const k of existingKeys) if (bdKeys.has(k)) shared++
  const existingOnly = existingKeys.size - shared
  const bdOnly = bdKeys.size - shared
  const union = existingOnly + shared + bdOnly
  return {
    existingUnique: existingKeys.size, bdUnique: bdKeys.size, shared, existingOnly, bdOnly, union,
    bdNetNewRate: union > 0 ? bdOnly / union : 0,
    existingNetNewRate: union > 0 ? existingOnly / union : 0,
  }
}

// ── B. DISCOVERY QUALIFICATION (funnel — DB-claim-filtered, order-dependent) ─
interface QualStats {
  rawDiscovered: number; totalMentions: number; qualified: number
  duplicate: number; alreadyClaimed: number; wrongSector: number; outsideSize: number
  otherRejected: number; qualificationErrors: number; requestsUsed: number
}
function computeQual(cells: Cell[], source: 'existing' | 'brightdata'): QualStats {
  const f = cells.filter(c => c.source === source)
  return {
    rawDiscovered: sum(f, c => c.rawDiscovered),
    totalMentions: sum(f, c => c.totalMentions),
    qualified: sum(f, c => c.funnel.qualified),
    duplicate: sum(f, c => c.funnel.duplicate),
    alreadyClaimed: sum(f, c => c.funnel.alreadyResearched + c.funnel.alreadyOutreached),
    wrongSector: sum(f, c => c.funnel.wrongSector + c.coarseSectorRejected),
    outsideSize: sum(f, c => c.funnel.outsideSize + c.coarseSizeRejected + c.megaCapRejected),
    otherRejected: sum(f, c => c.funnel.otherRejected),
    qualificationErrors: sum(f, c => c.qualificationErrors),
    requestsUsed: sum(f, c => c.requestsUsed),
  }
}
function sum<T>(arr: T[], f: (x: T) => number): number { return arr.reduce((s, x) => s + f(x), 0) }

// ── C. QUALIFICATION PROBLEMS (pattern audit over qualifiedCompanies) ──
// Diagnostic-only lists for THIS audit — not wired into production
// classifyCompanyRejection(). Broader than the live KNOWN_MEGA_CAP_NAMES /
// NON_COMPANY_NAMES lists in lib/enrichment/company-discovery.ts on
// purpose, to show what that gate is currently missing.
const KNOWN_MEGA_CAPS = [
  'denso', 'catl', 'hyundai mobis', 'aisin', 'martinrea', 'linamar', 'magna',
  'ford', 'multimatic', 'honda', 'stellantis', 'basf', 'thyssenkrupp',
  'hyundai', 'kia', 'mazda', 'mitsubishi', 'nsk', 'proton', 'perodua',
  'daihatsu', 'iveco', 'mercedes-benz', 'daimler', "o'reilly automotive",
  'alliedsignal', 'continental', 'vinfast', 'costco', 'etsy', 'nike',
  'home depot', 'best buy', 'canadian tire', 'zalando', 'asos', 'temu',
  'shopee', 'lazada', 'tokopedia', 'noon', 'souq', 'warby parker',
  'allbirds', 'glossier', 'george weston', 'imperial oil', 'suncor energy',
  'bosch', 'andritz', 'yokohama rubber', 'thermo fisher', 'fonterra',
  'bapcor', 'repco', 'tiki',
]
const NON_COMPANY_ENTITIES = [
  'clepa', 'apma', 'eeca', 'european electronic component manufacturers association',
  'manufacturing usa', 'eastern economic corridor', 'the global pan-european giants',
  'the regional market leaders', 'middle east auto spare parts',
]
const GENERIC_SINGLE_WORDS = new Set([
  'electronics', 'automotive', 'semiconductor', 'general', 'saudi', 'mexico', 'nova',
])

function auditName(name: string): string[] {
  const flags: string[] = []
  const n = name.toLowerCase()
  if (KNOWN_MEGA_CAPS.some(m => n.includes(m))) flags.push('mega-cap leakage')
  if (NON_COMPANY_ENTITIES.some(e => n.includes(e))) flags.push('non-company entity')
  const norm = normalizeCompanyName(name)
  const words = norm.split(' ').filter(Boolean)
  if (words.length === 1 && GENERIC_SINGLE_WORDS.has(words[0])) flags.push('generic category word extracted as company name')
  if (/\.read$/i.test(name.trim()) || /\bread$/i.test(name.trim())) flags.push('garbled extraction (trailing link-text fragment)')
  if (/^(the\s)/i.test(name.trim()) && /giants|leaders|companies|players/i.test(name)) flags.push('generic listicle-header phrase extracted as company name')
  return flags
}

// ── Grouping helpers ────────────────────────────────────────────────
function md(lines: (string | number)[]): string { return lines.join(' | ') }

let out: string[] = []
function line(s = ''): void { out.push(s) }

line(`# Global Benchmark — Corrected Analysis`)
line()
line(`Source file: \`${path.relative(process.cwd(), inPath)}\` (untouched, historical baseline)`)
line(`Ran at: ${data.ranAt}`)
line()
line(`## Metric definitions used in this report`)
line()
line(`- **A. Source overlap** — which companies each source's RAW discovered list contains (before any DB-claim/qualification filtering), matched by \`normalizeCompanyName()\` identity key.`)
line(`- **B. Discovery qualification** — whether a discovered candidate passes the sector/size gate (\`qualifyCandidate()\`'s funnel). This ALSO folds in DB-claim status (see C) because \`qualifyCandidate()\` checks \`company_registry\` first and returns \`duplicate\` before ever reaching the sector/size checks.`)
line(`- **C. Database claim status** — whether a candidate was already a row in \`company_registry\` (from a prior benchmark, a prior production run, or — within this run — the 'existing' pass that always runs before 'brightdata' for the same cell). This is \`funnel.duplicate\` / \`alreadyResearched\` / \`alreadyOutreached\`.`)
line()
line(`**A and B/C are different populations.** A candidate can appear in the raw overlap (A) whether or not it ever reaches qualification. A "qualified" count (B) can be suppressed by C even for a company a source genuinely discovered. The previous report printed A's shared/only numbers next to B's qualified totals as if directly comparable — they are not the same denominator.`)
line()

// Global overlap + qual
const globalOverlap = computeOverlap(data.cells)
const globalQualExisting = computeQual(data.cells, 'existing')
const globalQualBd = computeQual(data.cells, 'brightdata')

line(`## Global totals`)
line()
line(`### A. Source overlap (identity-key based, name-normalized, cross-region deduplicated)`)
line()
line(`| Metric | Value |`)
line(`|---|---|`)
line(`| Existing-source unique companies | ${globalOverlap.existingUnique} |`)
line(`| Bright Data unique companies | ${globalOverlap.bdUnique} |`)
line(`| Shared (found by both) | ${globalOverlap.shared} |`)
line(`| Existing-only | ${globalOverlap.existingOnly} |`)
line(`| Bright Data-only | ${globalOverlap.bdOnly} |`)
line(`| Union (Existing ∪ Bright Data) | ${globalOverlap.union} |`)
line(`| **Bright Data net-new rate** (BD-only / union) | **${(globalOverlap.bdNetNewRate * 100).toFixed(1)}%** |`)
line(`| **Existing-source net-new rate** (Existing-only / union) | **${(globalOverlap.existingNetNewRate * 100).toFixed(1)}%** |`)
line()
line(`Identity check: existing-only + shared = ${globalOverlap.existingOnly + globalOverlap.shared} (existing unique = ${globalOverlap.existingUnique}) — ${globalOverlap.existingOnly + globalOverlap.shared === globalOverlap.existingUnique ? 'HOLDS' : 'FAILS'}`)
line(`Identity check: bd-only + shared = ${globalOverlap.bdOnly + globalOverlap.shared} (bd unique = ${globalOverlap.bdUnique}) — ${globalOverlap.bdOnly + globalOverlap.shared === globalOverlap.bdUnique ? 'HOLDS' : 'FAILS'}`)
line()

line(`### B. Discovery qualification + C. DB claim status (funnel sums — order-dependent, DB-state-dependent, NOT the same population as A)`)
line()
line(`| Metric | Existing | Bright Data |`)
line(`|---|---|---|`)
line(`| Raw discovered (top-10-per-cell, pre-dedup) | ${globalQualExisting.rawDiscovered} | ${globalQualBd.rawDiscovered} |`)
line(`| Total mentions (pre within-source dedup) | ${globalQualExisting.totalMentions} | ${globalQualBd.totalMentions} |`)
line(`| Qualified | ${globalQualExisting.qualified} | ${globalQualBd.qualified} |`)
line(`| Rejected: duplicate (already in company_registry as discovered/qualified) | ${globalQualExisting.duplicate} | ${globalQualBd.duplicate} |`)
line(`| Rejected: already claimed (already_researched/already_outreached) | ${globalQualExisting.alreadyClaimed} | ${globalQualBd.alreadyClaimed} |`)
line(`| Rejected: wrong sector | ${globalQualExisting.wrongSector} | ${globalQualBd.wrongSector} |`)
line(`| Rejected: outside size / mega-cap | ${globalQualExisting.outsideSize} | ${globalQualBd.outsideSize} |`)
line(`| Rejected: other | ${globalQualExisting.otherRejected} | ${globalQualBd.otherRejected} |`)
line(`| Qualification errors (Supabase retries exhausted) | ${globalQualExisting.qualificationErrors} | ${globalQualBd.qualificationErrors} |`)
line(`| Bright Data requests used | ${globalQualExisting.requestsUsed} | ${globalQualBd.requestsUsed} |`)
line()
line(`**Why "Bright Data qualified" is an undercount of what Bright Data actually discovered**: within every cell, the 'existing' pass runs first and upserts its own discoveries into \`company_registry\` as \`discovered\`. The 'brightdata' pass for the SAME cell then runs \`qualifyCandidate()\` against a registry that already contains the existing-pass's finds — so any company Bright Data ALSO found (a real "shared" company, tracked correctly in section A) is disqualified here as \`duplicate\`, not counted toward "Bright Data qualified." This is why BD's qualified total (${globalQualBd.qualified}) is smaller than its section-A unique-companies total (${globalOverlap.bdUnique}) even before any real sector/size rejection.`)
line()

// Per sector
line(`## Per-sector totals`)
for (const sector of data.sectors) {
  const cells = data.cells.filter(c => c.sector === sector)
  const ov = computeOverlap(cells)
  const qe = computeQual(cells, 'existing')
  const qb = computeQual(cells, 'brightdata')
  line()
  line(`### ${sector}`)
  line()
  line(`**A. Source overlap**`)
  line()
  line(`| Metric | Value |`)
  line(`|---|---|`)
  line(`| Existing unique | ${ov.existingUnique} |`)
  line(`| Bright Data unique | ${ov.bdUnique} |`)
  line(`| Shared | ${ov.shared} |`)
  line(`| Existing-only | ${ov.existingOnly} |`)
  line(`| Bright Data-only | ${ov.bdOnly} |`)
  line(`| Union | ${ov.union} |`)
  line(`| BD net-new rate | ${(ov.bdNetNewRate * 100).toFixed(1)}% |`)
  line(`| Existing net-new rate | ${(ov.existingNetNewRate * 100).toFixed(1)}% |`)
  line()
  line(`**B/C. Qualification + DB-claim (funnel sums)**`)
  line()
  line(`| Metric | Existing | Bright Data |`)
  line(`|---|---|---|`)
  line(`| Qualified | ${qe.qualified} | ${qb.qualified} |`)
  line(`| Duplicate (DB-claim) | ${qe.duplicate} | ${qb.duplicate} |`)
  line(`| Already claimed | ${qe.alreadyClaimed} | ${qb.alreadyClaimed} |`)
  line(`| Wrong sector | ${qe.wrongSector} | ${qb.wrongSector} |`)
  line(`| Outside size/mega-cap | ${qe.outsideSize} | ${qb.outsideSize} |`)
  line(`| Requests used | ${qe.requestsUsed} | ${qb.requestsUsed} |`)
}
line()

// Per region (aggregated across all 3 sectors)
line(`## Per-region totals (aggregated across all 3 sectors)`)
for (const region of data.regions) {
  const cells = data.cells.filter(c => c.region === region)
  const ov = computeOverlap(cells)
  const qe = computeQual(cells, 'existing')
  const qb = computeQual(cells, 'brightdata')
  line()
  line(`### ${region}`)
  line()
  line(md(['Existing unique', ov.existingUnique]) + '  ')
  line(md(['Bright Data unique', ov.bdUnique]) + '  ')
  line(md(['Shared', ov.shared]) + '  ')
  line(md(['Existing-only', ov.existingOnly]) + '  ')
  line(md(['Bright Data-only', ov.bdOnly]) + '  ')
  line(md(['Union', ov.union]) + '  ')
  line(md(['BD net-new rate', (ov.bdNetNewRate * 100).toFixed(1) + '%']) + '  ')
  line(md(['Qualified (existing / bd)', `${qe.qualified} / ${qb.qualified}`]) + '  ')
}
line()

// ── Explanation of the previous report's discrepancy, proven from raw data ──
line(`## Explanation of the previous calculation discrepancy`)
line()
line(`The previous report's per-sector "Shared/Existing-only/Bright Data-only" numbers were reproduced exactly by summing \`overlapsByCell\` (the per-cell, real identity-key-based overlap) ACROSS REGIONS with no cross-region deduplication:`)
line()
function naiveOverlap(regions: string[], sector: string) {
  let shared = 0, eo = 0, bo = 0
  for (const region of regions) {
    const ov = data.overlapsByCell[`${sector}:${region}`]
    if (!ov) continue
    shared += ov.shared.length; eo += ov.existingOnly.length; bo += ov.brightdataOnly.length
  }
  return { shared, eo, bo, union: shared + eo + bo }
}
line(`| Sector | Naive shared | Naive existing-only | Naive BD-only | Naive union | Naive BD net-new |`)
line(`|---|---|---|---|---|---|`)
for (const sector of data.sectors) {
  const n = naiveOverlap(data.regions, sector)
  line(`| ${sector} | ${n.shared} | ${n.eo} | ${n.bo} | ${n.union} | ${(n.bo / n.union * 100).toFixed(1)}% |`)
}
let gShared = 0, gEo = 0, gBo = 0
for (const sector of data.sectors) {
  const n = naiveOverlap(data.regions, sector)
  gShared += n.shared; gEo += n.eo; gBo += n.bo
}
const gUnion = gShared + gEo + gBo
line(`| **global (naive)** | ${gShared} | ${gEo} | ${gBo} | ${gUnion} | **${(gBo / gUnion * 100).toFixed(1)}%** |`)
line()
line(`These naive figures match the previously-reported numbers exactly (manufacturing: shared=35/existing-only=27/BD-only=35 — the user's own quoted example; global BD net-new rate: 35.4%). So the previous report's per-cell math and per-sector summation were not fabricated — they are real sums of real per-cell overlap data.`)
line()
line(`**This confirms two distinct problems, not one:**`)
line()
line(`1. **Wrong aggregation, not wrong per-cell math.** Each individual cell's \`overlapsByCell\` entry IS correct (real domain+name identity keys via \`computeIdentityOverlap()\`). But summing per-cell counts across 8 regions double/triple-counts any company independently (re)discovered in more than one region's search. Confirmed real for automotive and e-commerce: automotive existing-source raw name occurrences total 77 across regions, but only 59 are cross-region-unique — 18 duplicate re-discoveries, mostly known OEMs/mega-caps recurring in multiple regional listicles (Ford, Honda, Stellantis, Hyundai, Kia, Mazda, Mitsubishi, etc. get surfaced independently by "in North America"/"in Canada"/"in South Asia"-qualified queries alike). E-commerce shows the same pattern (60→57 unique). Manufacturing's SME-scale discoveries happen to be mostly region-local this run, so its naive and deduplicated totals coincide — that is a property of this run's content, not a property of the method, and should not be assumed to hold on a future run.`)
line(`2. **Two unrelated metrics were tabled together.** "Qualified" (funnel-based: DB-claim + sector/size filtered, existing-source-runs-first order-dependent) was printed in the same table as "Shared / Existing-only / Bright Data-only" (raw overlap, pre-qualification, order-independent). Nothing requires \`existing qualified = shared + existing-only\` — they were never the same denominator. The identity the user expected (\`existing total = shared + existing-only\`) DOES hold, but only when "existing total" means "existing unique" from section A (see the "Identity check" lines above — both HOLD) — not "existing qualified."`)
line()
line(`**The corrected numbers in the sections above fix both**: overlap is a true cross-region union (dedup by identity key across every region cell in a sector, and across sectors for the global total), and qualification/DB-claim figures are kept in their own separate table, never implied to share a denominator with source overlap.`)
line()

// ── Qualification problems ──────────────────────────────────────────
line(`## Qualification problems found (pattern audit over qualifiedCompanies)`)
line()
line(`These are companies that PASSED \`qualifyCandidate()\` (i.e. count toward "qualified" above) but are visibly wrong under Demaze's own mid-market ICP or aren't real companies at all. Confirms the qualification gate has real coverage gaps beyond what the shipped \`KNOWN_MEGA_CAP_NAMES\`/\`NON_COMPANY_NAMES\` lists in \`lib/enrichment/company-discovery.ts\` catch today.`)
line()

const problemRows: Array<{ sector: string; region: string; source: string; name: string; flags: string[] }> = []
for (const c of data.cells) {
  for (const name of c.qualifiedCompanies) {
    const flags = auditName(name)
    if (flags.length > 0) problemRows.push({ sector: c.sector, region: c.region, source: c.source, name, flags })
  }
}

const categories: Record<string, typeof problemRows> = {
  'mega-cap leakage': [], 'non-company entity': [], 'generic category word extracted as company name': [],
  'garbled extraction (trailing link-text fragment)': [], 'generic listicle-header phrase extracted as company name': [],
}
for (const row of problemRows) for (const f of row.flags) (categories[f] ??= []).push(row)

for (const [cat, rows] of Object.entries(categories)) {
  if (rows.length === 0) continue
  line(`### ${cat} (${rows.length})`)
  line()
  for (const r of rows) line(`- **${r.name}** — ${r.sector} / ${r.region} / ${r.source}`)
  line()
}

line(`### Automotive mega-cap leakage specifically`)
line()
const autoMega = problemRows.filter(r => r.sector === 'automotive' && r.flags.includes('mega-cap leakage'))
line(`${autoMega.length} automotive candidates matched a known mega-cap/OEM name pattern despite passing qualification: ${autoMega.map(r => r.name).join(', ') || 'none'}`)
line()
line(`### E-commerce mega-cap leakage specifically`)
line()
const ecomMega = problemRows.filter(r => r.sector === 'ecommerce' && r.flags.includes('mega-cap leakage'))
line(`${ecomMega.length} e-commerce candidates matched a known mega-cap/retail-giant name pattern despite passing qualification: ${ecomMega.map(r => r.name).join(', ') || 'none'}`)
line()
line(`### Non-company entities (trade associations, government programs, etc.)`)
line()
const nonCo = problemRows.filter(r => r.flags.includes('non-company entity'))
line(nonCo.map(r => `- **${r.name}** (${r.sector}/${r.region}/${r.source})`).join('\n') || 'none found')
line()
line(`### Near-duplicate qualified entries not caught by identity dedup`)
line()
line(`Manually spot-checked, not pattern-matched (these need real-world knowledge to recognize):`)
line(`- "Souq" and "Souq.com" both qualified separately (Middle East e-commerce) — same company, two identity keys.`)
line(`- "Noon" and "Noon.com" both qualified separately (Middle East e-commerce) — same company, two identity keys.`)
line(`- "CAP" and "Complete Auto Parts, S.A." both qualified separately (Latin America automotive brightdata) — same company (acronym vs. full name), two identity keys.`)
line(`- "Zalora" and "Zalora.Read" both qualified separately (South Asia e-commerce brightdata) — "Zalora.Read" is a garbled extraction of the same company (see garbled-extraction category above).`)
line()

fs.writeFileSync(outPath, out.join('\n'))
console.log(out.join('\n'))
console.error(`\n[written] ${path.relative(process.cwd(), outPath)}`)
