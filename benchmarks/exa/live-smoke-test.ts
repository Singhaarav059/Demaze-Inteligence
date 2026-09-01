// ============================================================
// Exa live smoke test — Phase 13 controlled sample
// ============================================================
// Deliberately separate from benchmarks/benchmark-runner.ts (the core
// pipeline benchmark) — this is a small, explicitly-run, real-money check
// that the Exa provider layer built this session actually works against
// the live API, not a benchmark/comparison run. Requires EXA_API_KEY.
//
// Run: npx tsx benchmarks/exa/live-smoke-test.ts
//
// Deliberately kept small (a handful of calls per capability, not the
// full suggested benchmark volumes) — this is "does it actually work"
// validation, not the Explee/Prospeo comparison benchmark. Expand only
// once this passes clean, per CRITICAL RULE 10 (minimize paid API usage).
// ============================================================

import { config as loadDotenv } from 'dotenv'
import path from 'path'

const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

// The three outbound Exa providers (decision-maker discovery, email finder,
// enrichment) resolve their credential via getActiveCredential(capability),
// which returns whichever provider is CURRENTLY ACTIVE in this project's
// live outbound_integrations table — correct when the factory calls them
// (they're only invoked when they ARE the active provider), but wrong for
// this standalone smoke test, which calls them directly regardless of
// what's active. Confirmed live: without this, decision-maker discovery
// picked up a real, unrelated vendor's stored credential and got a 401.
// Clearing the Supabase env vars makes createServerClient() throw, which
// getActiveCredential/getActiveProviderName already catch and fall back to
// the plain EXA_API_KEY env var for — no DB row is read or written by this
// script either way.
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import { ExaCompanyDiscoveryProvider } from '../../lib/enrichment/sources/exa-company-discovery'
import { ExaDecisionMakerDiscoveryProvider } from '../../lib/outbound/decision-maker-discovery/providers/exa'
import { ExaEmailFinderProvider } from '../../lib/outbound/email-finder/providers/exa'
import { ExaEnrichmentProvider } from '../../lib/outbound/enrichment/providers/exa'
import { exaSearch } from '../../lib/enrichment/sources/exa-client'

interface LogEntry {
  capability: string
  input: string
  latencyMs: number
  ok: boolean
  summary: string
  raw: unknown
}

const log: LogEntry[] = []

async function timed<T>(capability: string, input: string, fn: () => Promise<T>, summarize: (r: T) => string) {
  const start = Date.now()
  try {
    const result = await fn()
    const latencyMs = Date.now() - start
    const summary = summarize(result)
    log.push({ capability, input, latencyMs, ok: true, summary, raw: result })
    console.log(`[${capability}] ${input} — ${latencyMs}ms — ${summary}`)
  } catch (e) {
    const latencyMs = Date.now() - start
    const summary = e instanceof Error ? e.message : String(e)
    log.push({ capability, input, latencyMs, ok: false, summary, raw: null })
    console.log(`[${capability}] ${input} — ${latencyMs}ms — ERROR: ${summary}`)
  }
}

async function main() {
  if (!process.env.EXA_API_KEY) {
    console.error('EXA_API_KEY not set. Aborting — no live calls made.')
    process.exit(1)
  }

  console.log('=== Company Discovery (Exa) — 3 real Demaze ICP queries ===')
  const discoveryQueries = [
    { definition: 'Indian manufacturing companies with significant manufacturing operations', geo_include: ['IN'] },
    { definition: 'Automotive component manufacturers', geo_include: ['IN'] },
    { definition: 'E-commerce companies', geo_include: ['US'] },
  ]
  for (const q of discoveryQueries) {
    await timed(
      'company_discovery',
      q.definition,
      () => ExaCompanyDiscoveryProvider.discoverCompanies({ ...q, size: undefined }),
      (r) => `${r.companies.length} companies, enforced=[${r.enforcedFilters.join(',')}], hinted=[${r.hintedFilters.join(',')}]`
    )
  }

  console.log('\n=== Decision-Maker Discovery (Exa) — 3 known companies ===')
  const dmCompanies = [
    { companyName: 'Bharat Forge', domain: 'bharatforge.com' },
    { companyName: 'Chargebee', domain: 'chargebee.com' },
    { companyName: 'Ador Welding', domain: 'adorwelding.com' },
  ]
  for (const c of dmCompanies) {
    await timed(
      'decision_maker_discovery',
      c.companyName,
      () => ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers(c),
      (r) => `status=${r.status}, ${r.candidates.length} candidate(s)${r.candidates[0] ? ` e.g. ${r.candidates[0].personName} (${r.candidates[0].title})` : ''}`
    )
  }

  console.log('\n=== Email Finder via Websets (Exa) — 2 people (slow: async, up to 45s each) ===')
  const people = [
    { personName: 'Krishnan Iyer', companyName: 'Chargebee', domain: 'chargebee.com' },
    { personName: 'B N Kalyani', companyName: 'Bharat Forge', domain: 'bharatforge.com' },
  ]
  for (const p of people) {
    await timed(
      'email_finder',
      `${p.personName} @ ${p.companyName}`,
      () => ExaEmailFinderProvider.findEmail(p),
      (r) => `status=${r.status}, email=${r.email ?? 'null'}, confidence=${r.confidence}${r.reason ? `, reason="${r.reason}"` : ''}`
    )
  }

  console.log('\n=== Enrichment via Answer (Exa) — 2 people ===')
  for (const p of people) {
    await timed(
      'enrichment',
      `${p.personName} @ ${p.companyName}`,
      () => ExaEnrichmentProvider.enrichContact(p),
      (r) => `status=${r.status}, confidence=${r.confidence}, dept=${r.department ?? 'null'}, seniority=${r.seniority ?? 'null'}`
    )
  }

  console.log('\n=== Raw cost sample (1 direct exaSearch call, to observe actual costDollars) ===')
  await timed(
    'raw_cost_sample',
    'raw exaSearch, category=company, numResults=10',
    () => exaSearch({ query: 'Indian manufacturing companies', category: 'company', numResults: 10 }),
    (r) => `${r.results.length} results, costDollars=${JSON.stringify(r.costDollars ?? 'not present in response')}`
  )

  const outPath = path.resolve(cwd, `benchmarks/exa/smoke-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const fs = await import('fs')
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2))
  console.log(`\nFull results (including raw responses) written to ${outPath}`)

  const failures = log.filter((l) => !l.ok)
  console.log(`\n${log.length} calls, ${failures.length} error(s).`)
}

main()
