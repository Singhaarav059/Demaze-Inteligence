// ============================================================
// Company size qualification — revenue ≠ valuation ≠ market cap ≠ headcount
// ============================================================
// Target band: approximately ₹50 crore – ₹500 crore. Deliberately does NOT
// collapse revenue/valuation/market cap/employee count into one number —
// each is a distinct, separately-tracked metric, since a private company
// may have a stated revenue but no market cap at all, and an employee
// count must never be silently converted into a valuation guess.
//
// Verdict priority when multiple metrics are found: revenue > valuation >
// market_cap > employee_count — revenue is the most direct evidence of an
// OPERATING company's scale (what Demaze actually cares about); valuation/
// market cap are relevant but can diverge sharply from operating size
// (a richly-valued pre-revenue startup, or a depressed-market-cap mature
// firm); employee count is the weakest, a supporting proxy only.
//
// Absence of evidence is never itself disqualifying — verdict 'unknown'
// passes through to qualification untouched, per explicit instruction not
// to reject on missing data. Only confident evidence placing a company
// OUTSIDE the band (or an unambiguous mega-scale/micro-scale phrase)
// produces a reject verdict.
//
// Extends (does not replace) detectSizeMismatch() in company-discovery.ts
// — that stays as `discoverCompanies()`'s existing coarse, fast, upper-
// bound-only pre-filter (unchanged); this module is the fuller,
// multi-metric check used by company-qualification.ts before a company is
// persisted as 'qualified'.
// ============================================================

import { fetchAndExtract } from '../pipeline/html-extractor'
import { getCompletion } from '../ai/provider-factory'

export type SizeMetric = 'revenue' | 'valuation' | 'market_cap' | 'employee_count'
export type SizeVerdict = 'within_range' | 'too_large' | 'too_small' | 'unknown'

export interface SizeEvidence {
  metric: SizeMetric
  raw: string              // the literal matched phrase, e.g. "$45M in annual revenue"
  valueUsdApprox?: number  // only for revenue/valuation/market_cap
  employeeCount?: number   // only for employee_count
  sourceSnippet: string
}

export type SizeEvidenceSource = 'snippets' | 'homepage' | 'knowledge' | 'none'

export interface SizeQualification {
  verdict: SizeVerdict
  evidence: SizeEvidence[]
  reason: string
  /** Which tier actually resolved this verdict — see company_registry.size_evidence_source.
   * Set by assessCompanySize()'s tier logic; assessCompanySizeFromText()
   * defaults to 'snippets' since that's its typical caller (tier 1), but
   * gets overridden to 'homepage' when the same function is reused for
   * tier 2's homepage markdown. */
  source: SizeEvidenceSource
}

// ponytail: one flat approximate rate, not a live FX lookup — same
// documented tradeoff CLAUDE.md's earlier (never-shipped) Apollo-revenue-
// filter design used. A few percent of drift only shifts the band
// boundary slightly; re-check if this ever needs to be precise.
const INR_PER_USD_APPROX = 83
const CRORE_INR = 10_000_000

export const TARGET_REVENUE_RANGE_CR_INR = { min: 50, max: 500 } as const
export const TARGET_REVENUE_RANGE_USD_APPROX = {
  min: (TARGET_REVENUE_RANGE_CR_INR.min * CRORE_INR) / INR_PER_USD_APPROX,
  max: (TARGET_REVENUE_RANGE_CR_INR.max * CRORE_INR) / INR_PER_USD_APPROX,
} as const

const MEGA_EMPLOYEE_THRESHOLD = 50_000

// ── Money parsing (shared across revenue/valuation/market_cap) ─────

const MONEY_RE_SRC = String.raw`(US\$|USD|\$|₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)\s*(billion|bn|million|mn|crore|cr|lakh|lacs?|thousand|k)?`

function parseMoney(currency: string, amountStr: string, unitRaw: string | undefined): number | null {
  const amount = parseFloat(amountStr.replace(/,/g, ''))
  if (!isFinite(amount)) return null
  const unit = (unitRaw || '').toLowerCase()
  let n = amount
  if (unit.startsWith('b')) n *= 1_000_000_000
  else if (unit === 'million' || unit === 'mn') n *= 1_000_000
  else if (unit === 'crore' || unit === 'cr') n *= CRORE_INR
  else if (unit.startsWith('lac') || unit === 'lakh') n *= 100_000
  else if (unit === 'thousand' || unit === 'k') n *= 1_000
  const isInr = /₹|rs\.?|inr/i.test(currency)
  return isInr ? n / INR_PER_USD_APPROX : n
}

// One-directional regexes ("revenue of $X"), matching this codebase's own
// established simple-regex-over-grammar-engine precedent (e.g.
// company-discovery.ts's detectSizeMismatch). Real snippets overwhelmingly
// phrase these trigger-word-then-figure, not the reverse.
const REVENUE_RE = new RegExp(String.raw`\b(?:annual\s+)?(?:revenue|turnover)\s+(?:of|is|was|reported\s+at|around|approximately)?\s*${MONEY_RE_SRC}`, 'i')
const VALUATION_RE = new RegExp(String.raw`\bvalu(?:ed|ation)\s+(?:at|of)?\s*${MONEY_RE_SRC}`, 'i')
const MARKET_CAP_RE = new RegExp(String.raw`\bmarket\s*cap(?:italization)?\s+(?:of|is|was)?\s*${MONEY_RE_SRC}`, 'i')
const EMPLOYEES_COUNT_RE = /([\d,]{2,})\+?\s*employees\b/i
const EMPLOYEES_MILLION_RE = /(\d+(?:\.\d+)?)\s*million\s+employees\b/i
const MEGA_SCALE_PHRASE_RE = /\bFortune\s?(?:50|100|500|1000)\b|\bGlobal\s?(?:500|2000)\b|\bone of the world'?s largest\b|\bmultinational conglomerate\b/i

function extractMetric(text: string, snippet: string, metric: SizeMetric, re: RegExp): SizeEvidence | null {
  const m = re.exec(text)
  if (!m) return null
  const valueUsdApprox = parseMoney(m[1], m[2], m[3])
  if (valueUsdApprox === null) return null
  return { metric, raw: m[0].trim(), valueUsdApprox, sourceSnippet: snippet.slice(0, 200) }
}

function extractEmployeeCount(text: string, snippet: string): SizeEvidence | null {
  const millionMatch = EMPLOYEES_MILLION_RE.exec(text)
  if (millionMatch) {
    const count = Math.round(parseFloat(millionMatch[1]) * 1_000_000)
    return { metric: 'employee_count', raw: millionMatch[0].trim(), employeeCount: count, sourceSnippet: snippet.slice(0, 200) }
  }
  const countMatch = EMPLOYEES_COUNT_RE.exec(text)
  if (countMatch) {
    const count = parseInt(countMatch[1].replace(/,/g, ''), 10)
    if (isFinite(count)) return { metric: 'employee_count', raw: countMatch[0].trim(), employeeCount: count, sourceSnippet: snippet.slice(0, 200) }
  }
  return null
}

function extractAllEvidence(snippets: string[]): SizeEvidence[] {
  const evidence: SizeEvidence[] = []
  for (const snippet of snippets) {
    const revenue = extractMetric(snippet, snippet, 'revenue', REVENUE_RE)
    if (revenue) evidence.push(revenue)
    const valuation = extractMetric(snippet, snippet, 'valuation', VALUATION_RE)
    if (valuation) evidence.push(valuation)
    const marketCap = extractMetric(snippet, snippet, 'market_cap', MARKET_CAP_RE)
    if (marketCap) evidence.push(marketCap)
    const employees = extractEmployeeCount(snippet, snippet)
    if (employees) evidence.push(employees)
  }
  return evidence
}

function verdictFromEvidence(evidence: SizeEvidence[], megaPhraseHit: string | null): { verdict: SizeVerdict; reason: string } {
  if (megaPhraseHit) {
    return { verdict: 'too_large', reason: `too large for the target size band ("${megaPhraseHit}" mentioned)` }
  }

  // Priority: revenue > valuation > market_cap > employee_count
  for (const metric of ['revenue', 'valuation', 'market_cap'] as const) {
    const hit = evidence.find(e => e.metric === metric && typeof e.valueUsdApprox === 'number')
    if (!hit || typeof hit.valueUsdApprox !== 'number') continue
    if (hit.valueUsdApprox < TARGET_REVENUE_RANGE_USD_APPROX.min) {
      return { verdict: 'too_small', reason: `${metric} evidence ("${hit.raw}") is below the ~₹${TARGET_REVENUE_RANGE_CR_INR.min}cr target floor` }
    }
    if (hit.valueUsdApprox > TARGET_REVENUE_RANGE_USD_APPROX.max) {
      return { verdict: 'too_large', reason: `${metric} evidence ("${hit.raw}") is above the ~₹${TARGET_REVENUE_RANGE_CR_INR.max}cr target ceiling` }
    }
    return { verdict: 'within_range', reason: `${metric} evidence ("${hit.raw}") falls within the ~₹${TARGET_REVENUE_RANGE_CR_INR.min}cr-₹${TARGET_REVENUE_RANGE_CR_INR.max}cr target band` }
  }

  // Employee count is a supporting proxy only — never confirms
  // within_range on its own, only flags an unambiguous mega-scale reject.
  const employeeHit = evidence.find(e => e.metric === 'employee_count' && typeof e.employeeCount === 'number')
  if (employeeHit && typeof employeeHit.employeeCount === 'number' && employeeHit.employeeCount >= MEGA_EMPLOYEE_THRESHOLD) {
    return { verdict: 'too_large', reason: `employee count evidence ("${employeeHit.raw}") suggests a scale well beyond the target band` }
  }

  return { verdict: 'unknown', reason: evidence.length > 0
    ? 'evidence found (employee count only) is not sufficient to confirm or reject the target size band'
    : 'no revenue/valuation/market-cap/employee-count evidence found in available content' }
}

// Pure, no I/O — assesses whatever snippet text is already available
// (search-result snippets, or already-fetched homepage text).
export function assessCompanySizeFromText(snippets: string[]): SizeQualification {
  const text = snippets.join(' ')
  const evidence = extractAllEvidence(snippets)
  const megaPhraseHit = MEGA_SCALE_PHRASE_RE.exec(text)?.[0] ?? null
  const { verdict, reason } = verdictFromEvidence(evidence, megaPhraseHit)
  return { verdict, evidence, reason, source: 'snippets' }
}

// Re-derives a verdict from already-persisted SizeEvidence[] (e.g.
// company_registry.size_evidence) with zero network/text-parsing — the
// exact same threshold logic assessCompanySizeFromText() uses, just
// skipping straight to the evidence-interpretation step. This is what lets
// a re-audit re-validate a stored decision against CURRENT thresholds
// (e.g. if TARGET_REVENUE_RANGE_CR_INR ever changes) without needing the
// original snippet text, which company_registry never persisted. Exported
// for lib/enrichment/company-reaudit.ts.
export function verdictFromStoredEvidence(evidence: SizeEvidence[]): SizeQualification {
  const { verdict, reason } = verdictFromEvidence(evidence, null)
  return { verdict, evidence, reason, source: evidence.length > 0 ? 'snippets' : 'none' }
}

// Full assessment: snippet text first (free — no network); if that alone
// is 'unknown' and a resolved domain is available, one cheap in-house
// homepage fetch (G3/G4's fetchAndExtract — plain HTTP + cheerio/turndown,
// never Firecrawl) is scanned with the same regexes before settling on
// 'unknown'. This is the one place this module spends any I/O at all.
// ── Tier 3: AI direct-knowledge check for well-known global companies ──
// Real gap found live 2026-08-20 (fresh discovery benchmark, existing-
// sources-only run): BMW, Audi, Mini, Porsche, Volvo, Jaguar, Land Rover,
// Maruti Suzuki, JCB, Tencent, Jacobs Solutions, and Fluor all reached
// 'qualified' in one 9-cell run — none had an explicit revenue/employee
// figure in their search snippets (tiers 1-2 above both correctly stayed
// 'unknown', by design — absence of evidence isn't itself disqualifying),
// and none were in company-discovery.ts's KNOWN_MEGA_CAP_NAMES list.
// Extending that list to cover these 12 names would only fix these exact
// 12 — the same gap will recur for the next unlisted global brand, which is
// exactly the "reactive blacklist" pattern this session's entity-
// classification work was built to move away from.
//
// Same proven "has_knowledge, decline if unsure" discipline as
// competitor-discovery.ts's discoverCompetitorsFromKnowledge() (2026-08-13)
// — deliberately ASYMMETRIC: this tier can only ever push a verdict toward
// 'too_large', never confirm 'within_range' or 'too_small'. A confident "I
// recognize this as a global giant" claim from an LLM's parametric
// knowledge is a much safer basis for a reject than a confident "this is
// definitely a legitimate ₹50-500cr mid-market company" claim would be for
// an accept — the false-positive cost of the former is a missed lead (same
// as today's status quo for an unlisted mega-cap); the false-positive cost
// of the latter would be inventing evidence for a company qualifying that
// shouldn't. Only reached when tiers 1-2 both stay 'unknown' — the vast
// majority of real SME candidates (which this tier correctly has no
// confident opinion on) never trigger an extra LLM call at all.
const KNOWLEDGE_TIMEOUT_MS = 10_000

// ── Instrumentation (measure, don't assume — same "no hardcoded
// conversion-rate assumption" discipline as discovery-funnel.ts, and the
// same counter-object pattern as brightdata-client.ts's brightDataUsage/
// resetBrightDataUsage()). A benchmark script calls resetSizeKnowledgeTierMetrics()
// before a run, reads sizeKnowledgeTierMetrics after — see
// benchmarks/measure-size-knowledge-tier.ts.
export interface SizeKnowledgeTierMetrics {
  calls: number
  rejections: number   // scale === 'large'
  unknowns: number     // scale === 'unknown' / decline / error
  totalLatencyMs: number
}

export const sizeKnowledgeTierMetrics: SizeKnowledgeTierMetrics = { calls: 0, rejections: 0, unknowns: 0, totalLatencyMs: 0 }

export function resetSizeKnowledgeTierMetrics(): void {
  sizeKnowledgeTierMetrics.calls = 0
  sizeKnowledgeTierMetrics.rejections = 0
  sizeKnowledgeTierMetrics.unknowns = 0
  sizeKnowledgeTierMetrics.totalLatencyMs = 0
}

interface KnowledgeSizeResponse {
  scale?: unknown
  reasoning?: unknown
}

function extractJson(raw: string): string {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  return start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned
}

export async function assessCompanySizeViaKnowledge(companyName: string): Promise<SizeQualification> {
  const systemPrompt = 'You are a precise company-scale classifier, not a knowledge base to guess with. You only answer when you have specific, confident knowledge.'
  const userPrompt = `
Company name: "${companyName}"

Is this a large, globally well-known company — a multinational conglomerate, a household-name brand, or a company you are confident operates at a scale well beyond a small-to-mid-market business (annual revenue well above roughly $100M, or thousands of employees)?

Only answer "large" if you have specific, confident knowledge that this exact company operates at that scale. If you do not recognize this company, or are not confident about its actual scale, answer "unknown" — do not guess based on the name alone.

Return ONLY this JSON object, no other text:
{"scale": "large" or "unknown", "reasoning": "1 short sentence"}
`.trim()

  sizeKnowledgeTierMetrics.calls++
  const startedAt = Date.now()
  try {
    const response = await Promise.race([
      getCompletion({ systemPrompt, userPrompt, maxTokens: 200, temperature: 0, jsonMode: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI direct-knowledge size check timeout')), KNOWLEDGE_TIMEOUT_MS)),
    ])
    sizeKnowledgeTierMetrics.totalLatencyMs += Date.now() - startedAt
    const parsed = JSON.parse(extractJson(response.content)) as KnowledgeSizeResponse
    if (parsed.scale === 'large') {
      sizeKnowledgeTierMetrics.rejections++
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'recognized as a large/multinational company'
      return { verdict: 'too_large', evidence: [], reason: `AI direct-knowledge: ${reasoning} (no explicit size figure found in available content)`, source: 'knowledge' }
    }
    sizeKnowledgeTierMetrics.unknowns++
    return { verdict: 'unknown', evidence: [], reason: 'no revenue/valuation/market-cap/employee-count evidence found, and AI direct-knowledge check found no confident large-scale signal', source: 'knowledge' }
  } catch (e) {
    sizeKnowledgeTierMetrics.totalLatencyMs += Date.now() - startedAt
    sizeKnowledgeTierMetrics.unknowns++
    return { verdict: 'unknown', evidence: [], reason: `AI direct-knowledge size check unavailable: ${e instanceof Error ? e.message : String(e)}`, source: 'knowledge' }
  }
}

export async function assessCompanySize(snippets: string[], domain?: string | null, companyName?: string): Promise<SizeQualification> {
  const fromSnippets = assessCompanySizeFromText(snippets)
  if (fromSnippets.verdict !== 'unknown') return fromSnippets

  if (domain) {
    try {
      const homepage = await fetchAndExtract(`https://${domain}`, 10_000)
      if (homepage.success && homepage.markdown) {
        const fromHomepage = assessCompanySizeFromText([homepage.markdown])
        if (fromHomepage.verdict !== 'unknown') return { ...fromHomepage, source: 'homepage' }
      }
    } catch {
      // fall through to the knowledge tier / snippets-only result below
    }
  }

  if (companyName) {
    const fromKnowledge = await assessCompanySizeViaKnowledge(companyName)
    if (fromKnowledge.verdict !== 'unknown') return fromKnowledge
  }

  return fromSnippets.evidence.length > 0 ? fromSnippets : { ...fromSnippets, source: 'none' }
}
