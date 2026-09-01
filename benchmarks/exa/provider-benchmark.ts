// ============================================================
// Exa vs Explee/Prospeo — controlled provider benchmark
// ============================================================
// Data-collection ONLY. This script makes real, credit-spending API calls
// and dumps a single raw snapshot JSON — it does not classify relevance,
// compute cost-per-useful-result, or write the report. Those require
// judgment (is this company actually relevant? is this the right person?)
// and are done by hand against the snapshot, not automated here — a rigid
// auto-scorer can't make that call reliably and would just hide bad
// judgment behind a number.
//
// Run: npm run benchmark:exa
// Requires EXA_API_KEY, EXPLEE_API_KEY, PROSPEO_API_KEY. Does NOT touch
// outbound_integrations (Supabase env vars are cleared for this process so
// every provider falls back cleanly to its flat env var — see
// benchmarks/exa/live-smoke-test.ts for why: calling a provider directly
// picks up whatever vendor is CURRENTLY ACTIVE in the live DB otherwise).
// Never run as part of `npm test`/`vitest` — this is explicitly opt-in.
// ============================================================

import { config as loadDotenv } from 'dotenv'
import path from 'path'
import fs from 'fs'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import { ExpleeCompanyDiscoveryProvider, type CompanyDiscoveryRequest } from '../../lib/enrichment/company-discovery-provider-factory'
import { ExaCompanyDiscoveryProvider } from '../../lib/enrichment/sources/exa-company-discovery'
import { ProspeoDecisionMakerDiscoveryProvider } from '../../lib/outbound/decision-maker-discovery/providers/prospeo'
import { ExaDecisionMakerDiscoveryProvider } from '../../lib/outbound/decision-maker-discovery/providers/exa'
import { ProspeoEmailFinderProvider } from '../../lib/outbound/email-finder/providers/prospeo'
import { ExaEmailFinderProvider } from '../../lib/outbound/email-finder/providers/exa'
import { ProspeoEnrichmentProvider } from '../../lib/outbound/enrichment/providers/prospeo'
import { ExaEnrichmentProvider } from '../../lib/outbound/enrichment/providers/exa'
import type { DecisionMakerDiscoveryRequest, DecisionMakerCandidate } from '../../lib/outbound/decision-maker-discovery/types'

interface CallRecord {
  section: string
  provider: string
  input: unknown
  latencyMs: number
  ok: boolean
  error: string | null
  result: unknown
}

const records: CallRecord[] = []

async function call<T>(section: string, provider: string, input: unknown, fn: () => Promise<T>): Promise<T | null> {
  const start = Date.now()
  try {
    const result = await fn()
    records.push({ section, provider, input, latencyMs: Date.now() - start, ok: true, error: null, result })
    console.log(`[${section}/${provider}] ${JSON.stringify(input).slice(0, 80)} — ${Date.now() - start}ms — ok`)
    return result
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    records.push({ section, provider, input, latencyMs: Date.now() - start, ok: false, error, result: null })
    console.log(`[${section}/${provider}] ${JSON.stringify(input).slice(0, 80)} — ${Date.now() - start}ms — ERROR: ${error}`)
    return null
  }
}

// ── Section 1: Company discovery — 5 real Demaze ICP queries ──────────────
const DISCOVERY_QUERIES: (CompanyDiscoveryRequest & { label: string })[] = [
  { label: 'Manufacturing + India', definition: 'manufacturing companies with significant manufacturing operations', geo_include: ['IN'], pageSize: 40 },
  { label: 'Automotive + India', definition: 'automotive companies', geo_include: ['IN'], pageSize: 20 },
  { label: 'Manufacturing + Europe', definition: 'manufacturing companies', geo_include: ['DE', 'FR', 'IT', 'ES', 'PL', 'GB'], pageSize: 20 },
  { label: 'E-commerce', definition: 'e-commerce companies', pageSize: 20 },
  { label: 'Financial institutions + India', definition: 'financial institutions and NBFCs', geo_include: ['IN'], pageSize: 20 },
]

// ── Section 3: Known regression cases from the Explee investigation ───────
// Not derivable from this repo's own history — supplied directly as ground
// truth for this benchmark. Tested via a direct-name lookup (definition =
// exact company name, same technique lib/enrichment/explee-lookup.ts's
// lookupCompanyInExplee() already uses for Explee) against both providers.
const KNOWN_FALSE_POSITIVES = ['Ferreiro', 'AGMP_IIMA-OFFICIAL', 'Transpek', 'Oilgear']
const KNOWN_FALSE_NEGATIVES = [
  'Honda Motor India', 'Mazak India', 'Kirloskar Electric', 'Action Construction Equipment',
  'Hind Rectifiers', 'Camlin Fine Chemicals', 'GROZ Tools', 'Neogen Chemicals', 'Suryalakshmi Cotton Mills',
]

// ── Sections 4-6: 10 known companies, reused from benchmarks/companies/ ───
const KNOWN_COMPANIES = [
  { name: 'A-1 Fence Products', domain: 'a-1fenceproducts.com' },
  { name: 'Ace Pipeline', domain: 'acepipeline.co.in' },
  { name: 'Ador Welding', domain: 'adorwelding.com' },
  { name: 'AITG', domain: 'aitg.co' },
  { name: 'AS Agri and Aqua', domain: 'sites.google.com' },
  { name: 'ATE Group', domain: 'ategroup.com' },
  { name: 'Bharat Forge', domain: 'bharatforge.com' },
  { name: 'Chargebee', domain: 'chargebee.com' },
  { name: 'Lechler', domain: 'lechler.com' },
  { name: 'Muthoot Finance', domain: 'muthootfinance.com' },
]

const TARGET_TITLES = [
  'CEO', 'COO', 'Head of Operations', 'Head of Manufacturing',
  'Head of IT', 'Head of Digital Transformation', 'VP Engineering', 'Head of Automation',
]

async function main() {
  if (!process.env.EXA_API_KEY || !process.env.EXPLEE_API_KEY || !process.env.PROSPEO_API_KEY) {
    console.error('EXA_API_KEY, EXPLEE_API_KEY, and PROSPEO_API_KEY must all be set. Aborting — no live calls made.')
    process.exit(1)
  }

  console.log('\n=== SECTION 1: Company Discovery (5 queries x 2 providers) ===')
  for (const q of DISCOVERY_QUERIES) {
    const { label, ...request } = q
    await call('discovery', 'explee', label, () => ExpleeCompanyDiscoveryProvider.discoverCompanies(request))
    await call('discovery', 'exa', label, () => ExaCompanyDiscoveryProvider.discoverCompanies(request))
  }

  console.log('\n=== SECTION 3: Known regression cases (13 companies x 2 providers, direct name lookup) ===')
  for (const name of [...KNOWN_FALSE_POSITIVES, ...KNOWN_FALSE_NEGATIVES]) {
    await call('regression', 'explee', name, () => ExpleeCompanyDiscoveryProvider.discoverCompanies({ definition: name, pageSize: 5 }))
    await call('regression', 'exa', name, () => ExaCompanyDiscoveryProvider.discoverCompanies({ definition: name, pageSize: 5 }))
  }

  console.log('\n=== SECTION 4: Decision-Maker Discovery (10 companies x 2 providers) ===')
  const dmResults: { company: string; provider: string; candidates: DecisionMakerCandidate[] }[] = []
  for (const c of KNOWN_COMPANIES) {
    const req: DecisionMakerDiscoveryRequest = { companyName: c.name, domain: c.domain, targetTitles: TARGET_TITLES }
    const prospeo = await call('decision_maker', 'prospeo', c.name, () => ProspeoDecisionMakerDiscoveryProvider.discoverDecisionMakers(req))
    const exa = await call('decision_maker', 'exa', c.name, () => ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers(req))
    if (prospeo) dmResults.push({ company: c.name, provider: 'prospeo', candidates: prospeo.candidates })
    if (exa) dmResults.push({ company: c.name, provider: 'exa', candidates: exa.candidates })
  }

  console.log('\n=== SECTION 5: Email Finder (~20 people, top 1-2 candidates per company x 2 providers) ===')
  // Pull the person list from whichever provider(s) found candidates for
  // each company (section 4's own output) — a realistic "who would we
  // actually try to find an email for" set, not an arbitrary invented list.
  const peopleByCompany = new Map<string, { personName: string; companyName: string; domain: string }[]>()
  for (const c of KNOWN_COMPANIES) {
    const people: { personName: string; companyName: string; domain: string }[] = []
    const seen = new Set<string>()
    for (const r of dmResults.filter(d => d.company === c.name)) {
      for (const cand of r.candidates.slice(0, 2)) {
        const key = cand.personName.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        people.push({ personName: cand.personName, companyName: c.name, domain: c.domain })
      }
    }
    peopleByCompany.set(c.name, people.slice(0, 2))
  }
  const allPeople = [...peopleByCompany.values()].flat()
  console.log(`(${allPeople.length} distinct people selected)`)
  for (const p of allPeople) {
    await call('email_finder', 'prospeo', p, () => ProspeoEmailFinderProvider.findEmail(p))
    await call('email_finder', 'exa', p, () => ExaEmailFinderProvider.findEmail(p))
  }

  console.log('\n=== SECTION 6: Company/Contact Enrichment (10 companies x 2 providers) ===')
  // Enrichment providers work on a PERSON, not a bare company — use each
  // company's own top decision-maker candidate (from section 4) as the
  // enrichment subject, same real-world shape this capability is actually
  // used for in Demaze (enriching a contact, not a company record).
  for (const c of KNOWN_COMPANIES) {
    const anyCandidate = dmResults.find(d => d.company === c.name && d.candidates.length > 0)?.candidates[0]
    if (!anyCandidate) {
      records.push({ section: 'enrichment', provider: 'both', input: c.name, latencyMs: 0, ok: false, error: 'skipped — no decision-maker candidate found for this company to enrich', result: null })
      console.log(`[enrichment/both] ${c.name} — skipped (no candidate to enrich)`)
      continue
    }
    const subject = { personName: anyCandidate.personName, companyName: c.name, linkedinUrl: anyCandidate.linkedinUrl }
    await call('enrichment', 'prospeo', subject, () => ProspeoEnrichmentProvider.enrichContact(subject))
    await call('enrichment', 'exa', subject, () => ExaEnrichmentProvider.enrichContact(subject))
  }

  const outDir = path.resolve(cwd, 'benchmarks/exa')
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2))

  const errors = records.filter(r => !r.ok)
  console.log(`\n${records.length} calls total, ${errors.length} error(s).`)
  console.log(`Snapshot written to ${outPath}`)
}

main()
