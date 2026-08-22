// ============================================================
// CLI: re-audit already-qualified company_registry rows against the
// current qualification ruleset
// ============================================================
// SAFETY: dry run by default (REAUDIT_DRY_RUN unset or anything other
// than 'false') — prints a summary with zero writes. Set
// REAUDIT_DRY_RUN=false to actually mutate company_registry.
//
// Usage:
//   npx tsx benchmarks/reaudit-companies.ts                              (dry run, all qualified rows)
//   REAUDIT_SECTOR=automotive npx tsx benchmarks/reaudit-companies.ts    (dry run, one sector)
//   REAUDIT_VERSION=stale npx tsx benchmarks/reaudit-companies.ts        (dry run, only stale rows)
//   REAUDIT_LIMIT=50 npx tsx benchmarks/reaudit-companies.ts
//   REAUDIT_DRY_RUN=false npx tsx benchmarks/reaudit-companies.ts        (LIVE — mutates production data)
// ============================================================

import { config as loadDotenv } from 'dotenv'
import * as path from 'path'
loadDotenv({ path: path.resolve(process.cwd(), '.env.local') })
loadDotenv({ path: path.resolve(process.cwd(), '.env') })

import { createServerClient } from '../lib/supabase/server'
import { reAuditCompanies, type ReAuditFilters } from '../lib/enrichment/company-reaudit'
import type { TargetSector } from '../lib/sector-playbook/types'
import { sizeKnowledgeTierMetrics, resetSizeKnowledgeTierMetrics } from '../lib/enrichment/company-size'

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' }

const dryRun = process.env.REAUDIT_DRY_RUN !== 'false'
const filters: ReAuditFilters = {
  sector: process.env.REAUDIT_SECTOR as TargetSector | undefined,
  qualificationVersion: process.env.REAUDIT_VERSION,
  since: process.env.REAUDIT_SINCE,
  until: process.env.REAUDIT_UNTIL,
  limit: process.env.REAUDIT_LIMIT ? Number(process.env.REAUDIT_LIMIT) : undefined,
}

async function main() {
  console.log(`${C.bold}=== Company re-audit ===${C.reset}`)
  console.log(`  Filters: ${JSON.stringify(filters)}`)
  console.log(`  Mode: ${dryRun ? `${C.yellow}DRY RUN — no writes${C.reset}` : `${C.red}LIVE — will mutate company_registry${C.reset}`}`)
  console.log()

  resetSizeKnowledgeTierMetrics()
  const supabase = createServerClient()
  const summary = await reAuditCompanies(supabase, filters, { dryRun })

  console.log(`${C.bold}Evaluated: ${summary.evaluated}${C.reset}`)
  console.log(`  ${C.green}Still qualified (re-confirmed under the current ruleset): ${summary.stillQualified}${C.reset}`)
  console.log(`  ${C.yellow}Now review (insufficient evidence to confidently confirm): ${summary.nowReview}${C.reset}`)
  console.log(`  ${C.red}Now disqualified: ${summary.nowDisqualified}${C.reset}`)
  if (summary.errors > 0) console.log(`  ${C.red}Errors: ${summary.errors}${C.reset}`)
  console.log()

  // Priority 7 breakdown: which gate produced each disqualification, and —
  // for SIZE specifically — which evidence tier resolved it.
  const disqualified = summary.results.filter(r => r.outcome === 'now_disqualified')
  if (disqualified.length > 0) {
    const byCategory: Record<string, number> = {}
    for (const r of disqualified) byCategory[r.reasonCategory] = (byCategory[r.reasonCategory] ?? 0) + 1
    console.log(`${C.bold}Disqualification reasons:${C.reset} ${Object.entries(byCategory).map(([k, v]) => `${k}=${v}`).join(' ')}`)

    const sizeDisqualified = disqualified.filter(r => r.reasonCategory === 'SIZE')
    if (sizeDisqualified.length > 0) {
      const bySource: Record<string, number> = {}
      for (const r of sizeDisqualified) bySource[r.sizeEvidenceSource ?? 'unknown'] = (bySource[r.sizeEvidenceSource ?? 'unknown'] ?? 0) + 1
      console.log(`  ${C.dim}Size disqualifications by evidence source: ${Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(' ')} (snippets/homepage = deterministic, knowledge = AI-knowledge tier)${C.reset}`)
    }
    console.log()
  }

  if (summary.nowDisqualified > 0) {
    console.log(`${C.bold}Would become disqualified:${C.reset}`)
    for (const r of summary.results.filter(r => r.outcome === 'now_disqualified')) {
      console.log(`  - [${r.reasonCategory}] ${r.displayName}: ${r.reason}`)
    }
  }
  if (summary.nowReview > 0) {
    console.log(`\n${C.bold}Flagged for review:${C.reset}`)
    for (const r of summary.results.filter(r => r.outcome === 'now_review')) {
      console.log(`  - ${r.displayName}: ${r.reason}`)
    }
  }
  if (summary.errors > 0) {
    console.log(`\n${C.bold}Errors:${C.reset}`)
    for (const r of summary.results.filter(r => r.outcome === 'error')) {
      console.log(`  - ${r.displayName}: ${r.reason}`)
    }
  }

  // Priority 8 instrumentation — every SIZE-category call above that
  // needed the AI-knowledge tier (stored evidence stayed 'unknown') routed
  // through this same counter object; nothing new to wire, just reported.
  const m = sizeKnowledgeTierMetrics
  if (m.calls > 0) {
    const avgLatencyMs = Math.round(m.totalLatencyMs / m.calls)
    const ESTIMATED_TOKENS_PER_CALL = 350
    const GEMINI_PER_MILLION_TOKENS_USD = 0.3
    const estimatedCostUsd = (m.calls * ESTIMATED_TOKENS_PER_CALL / 1_000_000) * GEMINI_PER_MILLION_TOKENS_USD
    console.log(`\n${C.bold}Knowledge-tier usage:${C.reset} ${m.calls} call(s)/${summary.evaluated} evaluated, avg latency ${avgLatencyMs}ms, ~$${estimatedCostUsd.toFixed(4)} estimated, ${((m.rejections / m.calls) * 100).toFixed(1)}% rejected large, ${((m.unknowns / m.calls) * 100).toFixed(1)}% unknown`)
  }

  if (dryRun) {
    console.log(`\n${C.yellow}This was a DRY RUN — no records were changed. Set REAUDIT_DRY_RUN=false to apply.${C.reset}`)
  } else {
    console.log(`\n${C.green}Live re-audit complete — ${summary.nowDisqualified} row(s) disqualified, provenance refreshed on ${summary.stillQualified + summary.nowReview} row(s).${C.reset}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
