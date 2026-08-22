// ============================================================
// Demaze Intelligence Layer — company signals research
// ============================================================
// Explee is the company-data source (name/domain/industry/size/revenue/
// HQ/founded — see lib/enrichment/sources/explee-client.ts); this module
// answers the DIFFERENT question: "what's happening with this company
// right now that could help us decide whether/why/how to approach them?"
//
// Deliberately ONE grounded LLM call per company (Gemini + googleSearch,
// see getGroundedCompletion in provider-factory.ts) — no crawler, no
// per-source integrations, no agent swarm. If Gemini/grounding is
// unavailable or the call fails, this returns a safe empty result rather
// than throwing, same "never crash the caller" discipline as
// business-profile.ts/competitor-discovery.ts's *FromKnowledge() functions.
//
// Live-verified (2026-08-22, 8 real companies across Manufacturing/
// Automotive/E-commerce): real web search genuinely fires every time
// (confirmed via groundingMetadata.webSearchQueries), and specific,
// checkable facts came back (real MoUs, board approvals, executive
// appointments, dated within days of the actual research date). One real
// limitation found, not fixed further: Gemini's per-response
// groundingChunks (a mechanically-verified citation) are inconsistently
// populated when the model must also produce structured JSON — often
// absent even though real search happened. Each signal's sourceUrl is
// therefore the model's own best-effort citation from what it actually
// read, not a mechanically-verified link — informed by real search, not
// guaranteed accurate down to the exact URL. groundingSources (when
// present) is a genuine bonus, not something to rely on.
// ============================================================

import { getGroundedCompletion } from '@/lib/ai/provider-factory'
import { extractJsonFromResponse } from '@/lib/outbound/generation/extract-json'
import { CONFIRMED_SERVICE_NAMES } from '@/lib/pipeline/opportunity-engine'

export type SignalRecency = 'very_recent' | 'recent' | 'older'
export type SignalConfidence = 'high' | 'medium' | 'low'

export interface CompanySignal {
  title: string
  description: string
  date?: string
  sourceName?: string
  sourceUrl?: string
  recency: SignalRecency
  confidence: SignalConfidence
}

export interface CompanyOpportunity {
  service: string
  evidence: string
  interpretation: string
  opportunity: string
}

export interface CompanyResearchInput {
  name: string
  domain?: string | null
  industry?: string | null
  hqLocation?: string | null
  employeeCount?: number | null
  founded?: number | null
  revenueAnnual?: number | null
}

export interface CompanyResearchResult {
  signals: CompanySignal[]
  whatThisSuggests: string | null
  potentialPainPoints: string[]
  opportunities: CompanyOpportunity[]
  whyContactNow: string | null
  groundingSources: { uri?: string; title?: string }[]
  error?: string
}

const RECENCY_VALUES: SignalRecency[] = ['very_recent', 'recent', 'older']
const CONFIDENCE_VALUES: SignalConfidence[] = ['high', 'medium', 'low']

function emptyResult(error?: string): CompanyResearchResult {
  return { signals: [], whatThisSuggests: null, potentialPainPoints: [], opportunities: [], whyContactNow: null, groundingSources: [], error }
}

function formatCompanyRecord(input: CompanyResearchInput): string {
  const lines = [`Company: ${input.name}`]
  if (input.domain) lines.push(`Domain: ${input.domain}`)
  if (input.industry) lines.push(`Industry: ${input.industry}`)
  if (input.hqLocation) lines.push(`HQ: ${input.hqLocation}`)
  if (input.employeeCount != null) lines.push(`Employees: ${input.employeeCount}`)
  if (input.founded != null) lines.push(`Founded: ${input.founded}`)
  if (input.revenueAnnual != null) lines.push(`Revenue: ~$${Math.round(input.revenueAnnual).toLocaleString()}`)
  return lines.join('\n')
}

function buildPrompt(input: CompanyResearchInput): string {
  return `You are researching a company for B2B sales intelligence. Search the public web for RECENT, publicly available information about this specific company that could help decide whether, why, and how to approach them for outreach.

${formatCompanyRecord(input)}

We already know what this company does — do NOT describe its industry or business model. Only look for:
- Recent announcements, expansion, new facilities/products, partnerships, investments, acquisitions
- Leadership changes, hiring activity (esp. technology/automation roles), major contracts, new customers
- Technology/automation/digital-transformation initiatives, operational changes
- Publicly reported problems or customer complaints
- Industry developments directly affecting this company
- Public statements from company leadership, recent news, public LinkedIn info if accessible

Rules:
- Prefer information from the last 90 days. If nothing useful in 90 days, expand to 180 days.
- Do not fabricate information. If nothing useful was found, say so honestly — that is a valid result.
- Distinguish facts (what a source actually says) from inference (what it might mean) — never state an inference as a fact.
- Every signal must cite a real source URL and, if available, a publication date.
- Prefer company sites/official announcements/reputable news/public records over blogs, SEO content, or unverified claims.
- Do not treat LinkedIn as a hard dependency — use it only if genuinely accessible.

The only Demaze services you may map an opportunity to (do not invent others):
${CONFIRMED_SERVICE_NAMES.map(s => `- ${s}`).join('\n')}

Return ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{
  "signals": [
    { "title": string, "description": string, "date": string | null, "sourceName": string | null, "sourceUrl": string | null, "recency": "very_recent" | "recent" | "older", "confidence": "high" | "medium" | "low" }
  ],
  "what_this_suggests": string | null,
  "potential_pain_points": string[],
  "opportunities": [
    { "service": string, "evidence": string, "interpretation": string, "opportunity": string }
  ],
  "why_contact_now": string | null
}

Return at most 5 signals, ranked by recency and relevance. If no useful recent signal exists, return an empty "signals" array and set "why_contact_now" to null rather than inventing something.`
}

function sanitizeSignal(raw: unknown): CompanySignal | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.title !== 'string' || !r.title.trim()) return null
  if (typeof r.description !== 'string' || !r.description.trim()) return null
  const recency = RECENCY_VALUES.includes(r.recency as SignalRecency) ? (r.recency as SignalRecency) : 'older'
  const confidence = CONFIDENCE_VALUES.includes(r.confidence as SignalConfidence) ? (r.confidence as SignalConfidence) : 'low'
  return {
    title: r.title.trim(),
    description: r.description.trim(),
    date: typeof r.date === 'string' && r.date.trim() ? r.date.trim() : undefined,
    sourceName: typeof r.sourceName === 'string' && r.sourceName.trim() ? r.sourceName.trim() : undefined,
    sourceUrl: typeof r.sourceUrl === 'string' && r.sourceUrl.trim() ? r.sourceUrl.trim() : undefined,
    recency,
    confidence,
  }
}

function sanitizeOpportunity(raw: unknown): CompanyOpportunity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.service !== 'string') return null
  // Only accept a service that copies one of the 8 confirmed Demaze
  // service names exactly — same "no invented services" discipline as
  // service-evidence.ts's own catalog.
  if (!CONFIRMED_SERVICE_NAMES.includes(r.service)) return null
  if (typeof r.evidence !== 'string' || typeof r.interpretation !== 'string' || typeof r.opportunity !== 'string') return null
  return { service: r.service, evidence: r.evidence.trim(), interpretation: r.interpretation.trim(), opportunity: r.opportunity.trim() }
}

// 4096 covers the typical case (live-tested: 1500-2400 tokens for a
// content-rich company); live testing also found a real, non-deterministic
// truncation on a company with 5 signals + 3 opportunities at 3000 tokens
// (a retry at the same budget succeeded cleanly — same "transient LLM
// truncation, not a real bug" class this codebase already documents
// elsewhere), so one retry at a larger budget on parse failure is cheap
// insurance rather than invented complexity.
async function callAndParse(input: CompanyResearchInput, maxTokens: number) {
  const response = await getGroundedCompletion({
    systemPrompt: 'You are a precise B2B sales research assistant. You only report what you can find via web search — you never fabricate facts, dates, or URLs.',
    userPrompt: buildPrompt(input),
    maxTokens,
    temperature: 0.2,
    jsonMode: false,
    enableSearchGrounding: true,
    timeoutMs: 60_000,
  })
  return { response, parsed: JSON.parse(extractJsonFromResponse(response.content)) as Record<string, unknown> }
}

export async function researchCompanySignals(input: CompanyResearchInput): Promise<CompanyResearchResult> {
  if (!input.name?.trim()) return emptyResult('Company name is required')

  let response, p: Record<string, unknown>
  try {
    ;({ response, parsed: p } = await callAndParse(input, 4096))
  } catch (e) {
    try {
      ;({ response, parsed: p } = await callAndParse(input, 6144))
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2)
      return emptyResult(msg.includes('JSON') ? 'Could not parse research response' : (e instanceof Error ? e.message : 'Research call failed'))
    }
  }

  const signals = (Array.isArray(p.signals) ? p.signals : []).map(sanitizeSignal).filter((s): s is CompanySignal => s !== null).slice(0, 5)
  const opportunities = (Array.isArray(p.opportunities) ? p.opportunities : []).map(sanitizeOpportunity).filter((o): o is CompanyOpportunity => o !== null)
  const potentialPainPoints = Array.isArray(p.potential_pain_points) ? p.potential_pain_points.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []

  return {
    signals,
    whatThisSuggests: typeof p.what_this_suggests === 'string' && p.what_this_suggests.trim() ? p.what_this_suggests.trim() : null,
    potentialPainPoints,
    opportunities,
    whyContactNow: typeof p.why_contact_now === 'string' && p.why_contact_now.trim() ? p.why_contact_now.trim() : null,
    groundingSources: response.groundingSources ?? [],
  }
}
