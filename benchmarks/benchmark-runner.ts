// ============================================================
// Demaze Benchmark Runner
// ============================================================
// Usage:
//   npm run benchmark
//   BASE_URL=http://localhost:3000 FORCE_FRESH=true npm run benchmark
//
// Exit codes:
//   0 = all companies PASS or WARN
//   1 = any company FAIL
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { createHmac } from 'crypto'
import { config as loadDotenv } from 'dotenv'
import type { BenchmarkSpec, BenchmarkResult, CheckResult, CheckStatus, ProfileFlagMatch } from './benchmark-types'

// ── Environment ───────────────────────────────────────────────
const cwd = process.cwd()
loadDotenv({ path: path.resolve(cwd, '.env.local') })
loadDotenv({ path: path.resolve(cwd, '.env') })

const BASE_URL    = process.env.BASE_URL    ?? 'http://localhost:3000'
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? ''
const FORCE_FRESH = process.env.FORCE_FRESH === 'true'
const TIMEOUT_MS  = 480_000  // 8 min — accounts for LLM 90s timeout × providers + scrape + enrichment

// ── Admin token (mirrors lib/admin/auth.ts) ───────────────────
function computeAdminToken(secret: string): string {
  return createHmac('sha256', secret).update(secret).digest('hex')
}

// ── ANSI helpers ──────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
}

function colorStatus(s: CheckStatus | string): string {
  if (s === 'PASS') return `${C.green}PASS${C.reset}`
  if (s === 'WARN') return `${C.yellow}WARN${C.reset}`
  return `${C.red}FAIL${C.reset}`
}

function icon(s: CheckStatus): string {
  if (s === 'PASS') return `${C.green}✓${C.reset}`
  if (s === 'WARN') return `${C.yellow}⚠${C.reset}`
  return `${C.red}✗${C.reset}`
}

function pad(s: string | number, len: number): string {
  return String(s).padEnd(len)
}

// ── Minimal API response type ─────────────────────────────────
interface ApiResponse {
  success: boolean
  reason?: string
  error?: string
  validation?: {
    overall: string
    gates: Array<{ stage: string; status: string; reason?: string }>
  }
  extractorResult?: {
    signals: unknown[]
    companyProfile: {
      company_type: Record<string, boolean>
      primary_type: string
    }
    companyProfileEvidence?: Record<string, Array<{ pattern: string; matched: string; snippet: string }>>
  }
  analysisResult?: {
    company_name?: string
    company_summary?: string
    pain_points?: string[]
    opportunities?: Array<{
      title?: string
      description?: string
      source?: string
    }>
    outreach_intelligence?: {
      opening_angle?: string
      problem?: string
      service?: string
      trigger?: string
    }
    executive_brief?: {
      what_to_sell?: string
    }
    why_demaze?: {
      outreach_angle?: string
    }
  }
}

// ── API call ──────────────────────────────────────────────────
async function callAnalysis(url: string): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ADMIN_SECRET) headers['x-admin-token'] = computeAdminToken(ADMIN_SECRET)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE_URL}/api/admin/test-analysis`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, mode: 'full', force: FORCE_FRESH }),
      signal: controller.signal,
    })
    const json = await res.json() as ApiResponse
    return json
  } finally {
    clearTimeout(timer)
  }
}

// ── Build narrative text for forbidden-term checking ──────────
// Only checks LLM-generated narrative fields, not evidence quotes or signals,
// to avoid false positives from the raw website content.
function buildNarrativeText(result: ApiResponse['analysisResult']): string {
  if (!result) return ''
  return [
    result.company_summary ?? '',
    ...(result.pain_points ?? []),
    ...(result.opportunities ?? []).flatMap(o => [o.title ?? '', o.description ?? '']),
    result.outreach_intelligence?.opening_angle ?? '',
    result.outreach_intelligence?.problem ?? '',
    result.outreach_intelligence?.service ?? '',
    result.executive_brief?.what_to_sell ?? '',
    result.why_demaze?.outreach_angle ?? '',
  ].join(' ').toLowerCase()
}

// ── Run all checks for one company ───────────────────────────
function runChecks(spec: BenchmarkSpec, apiResponse: ApiResponse): CheckResult[] {
  const checks: CheckResult[] = []

  function check(
    name: string,
    pass: boolean,
    status: CheckStatus,
    actual?: string | number,
    expected?: string | number,
    note?: string,
  ): void {
    checks.push({ check: name, status: pass ? 'PASS' : status, actual, expected, note })
  }

  // Check 1: Pipeline success
  check(
    'pipeline_success',
    apiResponse.success === true,
    'FAIL',
    apiResponse.success ? 'true' : 'false',
    'true',
    apiResponse.success ? undefined : (apiResponse.reason ?? apiResponse.error),
  )

  if (!apiResponse.success) {
    // No point running further checks — pipeline didn't produce output
    return checks
  }

  const validationOverall = apiResponse.validation?.overall ?? 'UNKNOWN'

  // Check 2: Validation not FAIL
  check(
    'validation_not_failed',
    validationOverall !== 'FAIL',
    'FAIL',
    validationOverall,
    '!= FAIL',
  )

  const signals      = apiResponse.extractorResult?.signals?.length ?? 0
  const opportunities = (apiResponse.analysisResult?.opportunities ?? []).length
  const challenges   = (apiResponse.analysisResult?.pain_points ?? []).length
  const companyType  = apiResponse.extractorResult?.companyProfile?.company_type ?? {}
  const primaryType  = apiResponse.extractorResult?.companyProfile?.primary_type ?? 'unknown'

  // Check 3: Min signals (WARN — count can vary with website content quality)
  check(
    'min_signals',
    signals >= spec.expectations.minSignals,
    'WARN',
    signals,
    `>= ${spec.expectations.minSignals}`,
  )

  // Check 4: Min opportunities (WARN)
  check(
    'min_opportunities',
    opportunities >= spec.expectations.minOpportunities,
    'WARN',
    opportunities,
    `>= ${spec.expectations.minOpportunities}`,
  )

  // Check 5: Min challenges (WARN)
  check(
    'min_challenges',
    challenges >= spec.expectations.minChallenges,
    'WARN',
    challenges,
    `>= ${spec.expectations.minChallenges}`,
  )

  // Check 6: Required profile flags (FAIL — wrong classification is fundamental)
  for (const flag of spec.expectations.requiredProfileFlags) {
    const present = companyType[flag] === true || primaryType === flag
    check(
      `profile_flag:${flag}`,
      present,
      'FAIL',
      present ? 'true' : 'false',
      'true',
      present ? undefined : `company_type.${flag}=false, primary_type=${primaryType}`,
    )
  }

  // Check 7: Forbidden terms (FAIL — LLM generating wrong-industry content)
  const narrativeText = buildNarrativeText(apiResponse.analysisResult)
  for (const term of spec.expectations.forbiddenTerms) {
    const found = narrativeText.includes(term.toLowerCase())
    check(
      `no_forbidden:"${term}"`,
      !found,
      'FAIL',
      found ? 'found' : 'absent',
      'absent',
      found ? `"${term}" appeared in LLM narrative — possible cross-industry contamination` : undefined,
    )
  }

  return checks
}

// ── Derive overall status from checks ────────────────────────
function deriveOverall(checks: CheckResult[]): CheckStatus {
  if (checks.some(c => c.status === 'FAIL')) return 'FAIL'
  if (checks.some(c => c.status === 'WARN')) return 'WARN'
  return 'PASS'
}

// ── Print per-company detail ──────────────────────────────────
function printCompanyDetail(result: BenchmarkResult): void {
  console.log(`\n  ${C.bold}${result.name}${C.reset} ${C.dim}(${result.url})${C.reset}`)
  for (const c of result.checks) {
    const label = pad(c.check, 32)
    const statusIcon = icon(c.status)
    const actual = c.actual !== undefined ? `${C.dim}actual: ${c.actual}${C.reset}` : ''
    const note = c.note ? ` ${C.dim}— ${c.note}${C.reset}` : ''
    console.log(`    ${statusIcon} ${label} ${actual}${note}`)
  }
  if (result.error) {
    console.log(`    ${C.red}ERROR: ${result.error}${C.reset}`)
  }
  console.log(`    ${C.dim}────────────────────────────────────────────────────────${C.reset}`)
  console.log(`    Result: ${colorStatus(result.overall)}  ${C.dim}(${result.durationMs}ms)${C.reset}`)
}

// ── Print summary table ───────────────────────────────────────
function printSummary(results: BenchmarkResult[]): void {
  const W = { name: 22, sig: 9, opp: 7, chal: 12, gate: 10, result: 8 }
  const sep = `  ${'─'.repeat(74)}`

  console.log(`\n${C.bold}  SUMMARY${C.reset}`)
  console.log(sep)
  console.log(
    `  ${pad('Company', W.name)}${pad('Signals', W.sig)}${pad('Opps', W.opp)}${pad('Challenges', W.chal)}${pad('Gate', W.gate)}Result`
  )
  console.log(sep)

  for (const r of results) {
    const gateColored = r.validationOverall === 'PASS' ? `${C.green}${pad('PASS', W.gate)}${C.reset}`
      : r.validationOverall === 'WARN'                 ? `${C.yellow}${pad('WARN', W.gate)}${C.reset}`
      : r.validationOverall === 'PARTIAL'              ? `${C.yellow}${pad('PARTIAL', W.gate)}${C.reset}`
      : `${C.red}${pad(r.validationOverall, W.gate)}${C.reset}`

    const overallColored = r.overall === 'PASS' ? `${C.green}PASS${C.reset}`
      : r.overall === 'WARN'                    ? `${C.yellow}WARN${C.reset}`
      : `${C.red}FAIL${C.reset}`

    console.log(
      `  ${pad(r.name, W.name)}${pad(r.signals, W.sig)}${pad(r.opportunities, W.opp)}${pad(r.challenges, W.chal)}${gateColored}${overallColored}`
    )
  }

  console.log(sep)

  const passed  = results.filter(r => r.overall === 'PASS').length
  const warned  = results.filter(r => r.overall === 'WARN').length
  const failed  = results.filter(r => r.overall === 'FAIL').length
  const overallFail = failed > 0

  const overallLabel = overallFail
    ? `${C.red}${C.bold}FAIL${C.reset}`
    : warned > 0 ? `${C.yellow}${C.bold}WARN${C.reset}` : `${C.green}${C.bold}PASS${C.reset}`

  console.log(`\n  OVERALL: ${overallLabel}  ${C.green}${passed} passed${C.reset}, ${C.yellow}${warned} warned${C.reset}, ${C.red}${failed} failed${C.reset}`)
  console.log(`  ${'═'.repeat(74)}\n`)
}

// ── Print per-company profile evidence to stdout ─────────────
function printProfileEvidence(
  evidence: Record<string, ProfileFlagMatch[]> | undefined,
): void {
  if (!evidence || Object.keys(evidence).length === 0) return
  console.log(`    ${C.dim}Profile Evidence:${C.reset}`)
  for (const [flag, matches] of Object.entries(evidence)) {
    const isSuppressed = flag.includes('suppressed')
    const flagColor = isSuppressed ? C.yellow : C.cyan
    for (const m of matches) {
      console.log(
        `      ${flagColor}${flag}${C.reset}  ${C.dim}[${m.pattern}]${C.reset}  matched: ${C.bold}"${m.matched}"${C.reset}`,
      )
      console.log(`        ${C.dim}…${m.snippet}…${C.reset}`)
    }
  }
}

// ── Write debug dump JSON ─────────────────────────────────────
function writeDump(results: BenchmarkResult[]): void {
  const debugDir = path.resolve(cwd, 'benchmarks', 'debug')
  fs.mkdirSync(debugDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = path.join(debugDir, `run-${ts}.json`)
  const dump = {
    runAt: new Date().toISOString(),
    companies: results.map(r => ({
      name: r.name,
      url: r.url,
      durationMs: r.durationMs,
      overall: r.overall,
      validationOverall: r.validationOverall,
      signals: r.signals,
      opportunities: r.opportunities,
      challenges: r.challenges,
      checks: r.checks,
      profileEvidence: r.profileEvidence ?? {},
      error: r.error ?? null,
    })),
  }
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf-8')
  console.log(`  ${C.dim}Debug dump → ${outPath}${C.reset}\n`)
}

// ── Load all company specs ────────────────────────────────────
function loadSpecs(): BenchmarkSpec[] {
  const companiesDir = path.resolve(cwd, 'benchmarks', 'companies')
  const files = fs.readdirSync(companiesDir).filter(f => f.endsWith('.json'))
  if (files.length === 0) {
    console.error(`No company JSON files found in ${companiesDir}`)
    process.exit(1)
  }
  return files.map(f => {
    const raw = fs.readFileSync(path.join(companiesDir, f), 'utf-8')
    return JSON.parse(raw) as BenchmarkSpec
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const specs = loadSpecs()

  console.log(`\n${C.bold}  ${'═'.repeat(74)}${C.reset}`)
  console.log(`${C.bold}  DEMAZE BENCHMARK${C.reset}  ${C.dim}${specs.length} companies | ${BASE_URL}${FORCE_FRESH ? ' | FORCE_FRESH' : ''}${C.reset}`)
  console.log(`${C.bold}  ${'═'.repeat(74)}${C.reset}`)

  const results: BenchmarkResult[] = []

  for (const spec of specs) {
    const start = Date.now()
    let apiResponse: ApiResponse
    let apiError: string | undefined

    try {
      apiResponse = await callAnalysis(spec.url)
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e)
      apiResponse = { success: false, error: apiError }
    }

    const checks = runChecks(spec, apiResponse)
    const overall = deriveOverall(checks)
    const durationMs = Date.now() - start

    const signals       = apiResponse.extractorResult?.signals?.length ?? 0
    const opportunities = (apiResponse.analysisResult?.opportunities ?? []).length
    const challenges    = (apiResponse.analysisResult?.pain_points ?? []).length
    const validationOverall = apiResponse.validation?.overall ?? (apiResponse.success ? 'UNKNOWN' : 'FAIL')

    const result: BenchmarkResult = {
      name: spec.name,
      url: spec.url,
      overall,
      checks,
      signals,
      opportunities,
      challenges,
      validationOverall,
      durationMs,
      error: apiError,
      profileEvidence: apiResponse.extractorResult?.companyProfileEvidence,
    }

    results.push(result)
    printCompanyDetail(result)
    printProfileEvidence(result.profileEvidence)
  }

  printSummary(results)
  writeDump(results)

  const anyFail = results.some(r => r.overall === 'FAIL')
  process.exit(anyFail ? 1 : 0)
}

main().catch(err => {
  console.error(`\n${C.red}Benchmark runner crashed:${C.reset}`, err)
  process.exit(1)
})
