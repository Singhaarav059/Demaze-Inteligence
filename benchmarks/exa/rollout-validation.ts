// ============================================================
// Post-rollout small live validation (NOT a benchmark)
// ============================================================
// Per instruction: 3 company searches, 3 decision-maker searches, 3
// Exa->Prospeo email flows, 3 enrichment flows, manually inspected — not
// another 100+ call run. Exercises the NEW production defaults (Exa for
// company discovery + decision-maker discovery, Prospeo for email/
// enrichment) exactly as the app will call them, and traces identity
// (company name/domain, person name, role, LinkedIn, email, verification,
// enrichment) through the whole company -> person -> email -> enrichment
// chain to confirm nothing silently changes identity between providers.
//
// Run: npx tsx benchmarks/exa/rollout-validation.ts
// ============================================================

import { config as loadDotenv } from 'dotenv'
import path from 'path'
const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })
delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import { discoverCompanies } from '../../lib/enrichment/company-discovery-provider-factory'
import { ExaDecisionMakerDiscoveryProvider } from '../../lib/outbound/decision-maker-discovery/providers/exa'
import { rankCandidates } from '../../lib/outbound/decision-maker-discovery/ranking'
import { ProspeoEmailFinderProvider } from '../../lib/outbound/email-finder/providers/prospeo'
import { ProspeoEnrichmentProvider } from '../../lib/outbound/enrichment/providers/prospeo'

async function main() {
  console.log('=== 1. Company discovery (default provider, no env override — should be Exa) ===')
  const queries = ['manufacturing companies', 'automotive companies', 'financial institutions and NBFCs']
  for (const q of queries) {
    const r = await discoverCompanies({ definition: q, geo_include: ['IN'], pageSize: 5 })
    console.log(`\n"${q}" -> providerUsed=${r.providerUsed}, ${r.companies.length} companies`)
    r.companies.forEach(c => console.log(`  - ${c.name} | ${c.domain} | flags=${JSON.stringify(c.dataQualityFlags ?? [])}`))
  }

  console.log('\n=== 2-4. End-to-end chain: company -> decision-maker (Exa) -> email (Prospeo) -> enrichment (Prospeo) ===')
  const testCompanies = [
    { name: 'Bharat Forge', domain: 'bharatforge.com' },
    { name: 'Chargebee', domain: 'chargebee.com' },
    { name: 'Ador Welding', domain: 'adorwelding.com' },
  ]

  for (const c of testCompanies) {
    console.log(`\n--- ${c.name} (${c.domain}) ---`)
    const dm = await ExaDecisionMakerDiscoveryProvider.discoverDecisionMakers({
      companyName: c.name,
      domain: c.domain,
      targetTitles: ['CEO', 'COO', 'Head of Operations', 'Head of Manufacturing', 'Head of IT', 'VP Engineering'],
    })
    const ranked = rankCandidates(dm.candidates)
    console.log(`  Decision-maker discovery: status=${dm.status}, ${ranked.length} candidates (ranked)`)
    ranked.forEach(cand => console.log(`    - ${cand.personName} | ${cand.title} | conf=${cand.confidence} | linkedin=${!!cand.linkedinUrl}`))

    const top = ranked[0]
    if (!top) {
      console.log('  (no candidate found — skipping email/enrichment for this company)')
      continue
    }

    console.log(`  Identity check: person="${top.personName}" -> company="${c.name}" (${c.domain}) — same identity carried forward`)

    const email = await ProspeoEmailFinderProvider.findEmail({ personName: top.personName, companyName: c.name, domain: c.domain })
    console.log(`  Email finder (Prospeo): status=${email.status}, email=${email.email ?? 'null'}, confidence=${email.confidence}`)
    if (email.email && !email.email.toLowerCase().includes(c.domain.replace('www.', '').split('.')[0])) {
      console.log(`  *** IDENTITY WARNING: email domain doesn't obviously match ${c.domain} — verify manually`)
    }

    const enrichment = await ProspeoEnrichmentProvider.enrichContact({ personName: top.personName, companyName: c.name, linkedinUrl: top.linkedinUrl })
    console.log(`  Enrichment (Prospeo): status=${enrichment.status}, dept=${enrichment.department ?? 'null'}, seniority=${enrichment.seniority ?? 'null'}, confidence=${enrichment.confidence}`)
  }

  console.log('\n=== Done. Inspect output above for identity consistency (name/company/role/domain) at every hop. ===')
}

main()
