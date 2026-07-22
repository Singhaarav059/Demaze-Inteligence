// ============================================================
// Brief export — build a self-contained HTML document of the
// SDR research brief. Pure (no DOM/window), so it's testable and
// shared by both the PDF (print) and Word (.doc) download paths.
// Mirrors the ResearchCard's 5-field schema:
//   Company Description · Recent News · Pain Points ·
//   AI Opportunities · Personalization Summary
// Optionally appends the full Analysis-tab detail (see BriefExtras).
// ============================================================

import { humanizeText } from '@/lib/text/humanize'
import {
  getCompanyFit,
  getAutomationOpportunity,
  getWhyNow,
  getSignals,
  getOpportunities,
  getPainPointsStructured,
  getReasoningChains,
  getWhyDemaze,
  getOutreachIntelligence,
  getBusinessModelAnalysis,
  getSignalClusters,
  getStrategicChallenges,
  getExecutiveBrief,
  getDeterministicOpportunities,
} from '@/lib/pipeline/analysis-sections'

export interface BriefOpportunity {
  title: string
  description?: string
  entryPoint?: string
}

// Verbatim extractor evidence — quotes are NOT humanized (they are
// literal text pulled from the company's own site).
export interface ExportEvidence {
  quote: string
  source_url?: string
  evidence_strength?: string
  source_tier?: string
  subject?: string
}

export interface ExportSignal {
  type: string
  strength: string
  validated?: boolean
  is_company_subject?: boolean
  evidence: ExportEvidence[]
}

// Extra detail to append after the brief (the Analysis tab content).
export interface BriefExtras {
  analysis?: Record<string, unknown>
  signals?: ExportSignal[]
}

export interface BriefInput {
  companyName: string
  industry?: string
  subIndustry?: string
  headquarters?: string
  sizeEstimate?: string
  confidence?: string
  signalCount?: number
  summary?: string
  businessModel?: string
  recentNews?: string[]
  painPoints?: string[]
  opportunities?: BriefOpportunity[]
  openingAngle?: string
  whatToSell?: string
  whyNow?: string
  /** Human-readable timestamp; passed in so the builder stays pure. */
  generatedAt?: string
}

/** Escape a string for safe embedding in HTML text/attributes. */
export function escapeHtml(input: unknown): string {
  if (input == null) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A filesystem-safe base filename derived from the company name. */
export function briefFileBase(companyName: string): string {
  const slug = (companyName || 'company')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'company'}-research-brief`
}

function section(label: string, accent: string, body: string): string {
  if (!body) return ''
  return `
    <section class="block">
      <h2 class="label" style="color:${accent}">${escapeHtml(label)}</h2>
      ${body}
    </section>`
}

function list(items: string[]): string {
  const clean = items.filter((x) => x && x.trim())
  if (clean.length === 0) return ''
  return `<ul>${clean.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
}

// ── Analysis-appendix helpers ──────────────────────────────────
// S: raw string. H: humanized + escaped (narrative). E: escaped only
// (verbatim quotes / short labels). A: safe array.
const S = (v: unknown): string => (v == null ? '' : String(v).trim())
// Branded so kv() can require "already escaped" at the type level instead of
// by caller convention — a raw scraped string won't type-check as a row value.
type Html = string & { readonly __html: unique symbol }
const asHtml = (s: string): Html => s as Html
const H = (v: unknown): Html => asHtml(escapeHtml(humanizeText(v)))
const E = (v: unknown): Html => asHtml(escapeHtml(v))
const A = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}

function detail(title: string, inner: string): string {
  if (!inner || !inner.trim()) return ''
  return `<section class="dblock"><h3 class="dlabel">${escapeHtml(title)}</h3>${inner}</section>`
}

function chips(items: string[]): string {
  const clean = items.filter(Boolean)
  if (!clean.length) return ''
  return `<div class="chips">${clean.map((c) => `<span class="chip">${E(c)}</span>`).join('')}</div>`
}

function kv(pairs: Array<[string, Html]>): string {
  const rows = pairs.filter(([, v]) => v && v.trim())
  if (!rows.length) return ''
  return `<table class="kvt">${rows
    .map(([k, v]) => `<tr><td class="kvk">${escapeHtml(k)}</td><td class="kvv">${v}</td></tr>`)
    .join('')}</table>`
}

/**
 * Build the "Analysis Detail" appendix from the raw analysisResult and the
 * extractor signals — mirrors the on-screen Analysis tab. Narrative fields are
 * humanized; verbatim source quotes are kept as-is (escaped only).
 *
 * Field extraction is shared with AnalysisViewer (app/admin/intelligence-lab/
 * page.tsx) via lib/pipeline/analysis-sections.ts, so the two renderers can't
 * drift on *which* field a section reads. Rendering itself (JSX vs. this
 * HTML-string builder) is still separate on purpose — one is interactive, one
 * is a static export — so a new section still needs a render-side addition in
 * both places, just not a second copy of the extraction/casting.
 */
export function buildAnalysisAppendix(extras: BriefExtras): string {
  const a = extras.analysis
  const extractorSignals = extras.signals ?? []
  if (!a && extractorSignals.length === 0) return ''
  const data = a ?? {}
  const parts: string[] = []

  // Executive Brief
  const eb = getExecutiveBrief(data) ?? {}
  const observed = A<string>(eb.what_we_observed)
  const means = A<string>(eb.what_it_means)
  if (observed.length || means.length || S(eb.what_to_sell) || S(eb.why_now)) {
    parts.push(
      detail(
        'Executive Brief',
        [
          observed.length ? `<p class="dsub">What we observed</p>${list(observed.map((x) => humanizeText(x)))}` : '',
          means.length ? `<p class="dsub">What it means</p>${list(means.map((x) => humanizeText(x)))}` : '',
          kv([
            ['What to sell', H(eb.what_to_sell)],
            ['Why now', H(eb.why_now)],
            ['Confidence', E(eb.overall_confidence)],
          ]),
        ].join(''),
      ),
    )
  }

  // Scores
  const fit = getCompanyFit(data) ?? {}
  const auto = getAutomationOpportunity(data) ?? {}
  const wn = getWhyNow(data) ?? {}
  const scoreRows: Array<[string, Html]> = []
  if (S(fit.value) || S(fit.label))
    scoreRows.push(['Company fit', asHtml(`${E(fit.value)}${fit.label ? ` (${E(fit.label)})` : ''}`)])
  if (S(auto.value) || S(auto.label))
    scoreRows.push(['Automation opportunity', asHtml(`${E(auto.value)}${auto.label ? ` (${E(auto.label)})` : ''}`)])
  if (S(wn.score))
    scoreRows.push(['Why now', asHtml(`${E(wn.score)}/10${wn.urgency_label ? ` (${E(wn.urgency_label)})` : ''}`)])
  if (S(data.outreach_priority_score))
    scoreRows.push([
      'Outreach priority',
      asHtml(
        `${E(Math.round(Number(data.outreach_priority_score)))}/100${data.outreach_priority_label ? ` (${E(data.outreach_priority_label)})` : ''}`,
      ),
    ])
  if (S(data.confidence_level)) scoreRows.push(['Overall confidence', E(data.confidence_level)])
  parts.push(detail('Scores', kv(scoreRows)))

  // Business Model Analysis
  const bma = getBusinessModelAnalysis(data) ?? {}
  if (S(bma.model_type)) {
    parts.push(
      detail(
        'Business Model Analysis',
        [
          kv([
            ['Model type', H(bma.model_type)],
            ['Value chain position', H(bma.value_chain_position)],
            ['Primary customers', H(bma.primary_customers)],
          ]),
          A<string>(bma.core_operational_activities).length
            ? `<p class="dsub">Core internal activities</p>${chips(A<string>(bma.core_operational_activities))}`
            : '',
          A<string>(bma.strategic_pressures).length
            ? `<p class="dsub">Strategic pressures</p>${list(A<string>(bma.strategic_pressures).map((x) => humanizeText(x)))}`
            : '',
        ].join(''),
      ),
    )
  }

  // Signal Clusters
  const clusters = getSignalClusters(data)
  if (clusters.length) {
    parts.push(
      detail(
        'Signal Clusters',
        clusters
          .map(
            (c) =>
              `<div class="drow"><p class="drow-t">${H(c.theme)} <span class="muted">${E(c.confidence)}${c.tier ? ` · T${E(c.tier)}` : ''}</span></p>${
                c.description ? `<p class="drow-d">${H(c.description)}</p>` : ''
              }${chips(A<string>(c.signals_present))}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Strategic Challenges
  const challenges = getStrategicChallenges(data)
  if (challenges.length) {
    parts.push(
      detail(
        'Strategic Challenges',
        challenges
          .slice(0, 8)
          .map(
            (c) =>
              `<div class="drow"><p class="drow-t">${H(c.title)} <span class="muted">${E(c.priority)}</span></p>${
                c.description ? `<p class="drow-d">${H(c.description)}</p>` : ''
              }${c.service ? `<p class="drow-s">${E(c.service)}</p>` : ''}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Opportunity Engine Output (deterministic)
  const detOpps = getDeterministicOpportunities(data)
  if (detOpps.length) {
    parts.push(
      detail(
        'Opportunity Engine Output',
        detOpps
          .map(
            (o) =>
              `<div class="drow"><p class="drow-t">${H(o.title)} <span class="muted">${E(o.relevance)}${o.priority ? ` · P${E(o.priority)}` : ''}</span></p>${
                o.strategic_challenge ? `<p class="drow-d">${H(o.strategic_challenge)}</p>` : ''
              }${o.entry_point ? `<p class="drow-s">Entry: ${H(o.entry_point)}</p>` : ''}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Why Demaze
  const wd = getWhyDemaze(data) ?? {}
  const wdReasons = A<unknown>(wd.reasons)
  if (wdReasons.length || S(wd.summary)) {
    const reasonHtml = wdReasons
      .map((r) => {
        if (typeof r === 'string') return `<li>${H(r)}</li>`
        const ro = obj(r)
        return `<li>${H(ro.signal || ro.business_implication)}${
          ro.recommended_service ? ` <span class="muted">→ ${E(ro.recommended_service)}</span>` : ''
        }</li>`
      })
      .join('')
    parts.push(
      detail(
        'Why Demaze',
        `${wd.summary ? `<p class="drow-d">${H(wd.summary)}</p>` : ''}${reasonHtml ? `<ul>${reasonHtml}</ul>` : ''}${chips(
          A<string>(wd.relevant_services),
        )}`,
      ),
    )
  }

  // Outreach Intelligence
  const oi = getOutreachIntelligence(data) ?? {}
  if (S(oi.opening_angle)) {
    parts.push(
      detail(
        'Outreach Intelligence',
        [
          `<blockquote>&ldquo;${H(oi.opening_angle)}&rdquo;</blockquote>`,
          kv([
            ['Trigger', H(oi.trigger)],
            ['Problem', H(oi.problem)],
            ['Lead with', H(oi.service)],
            ['Why now', H(oi.why_now)],
          ]),
        ].join(''),
      ),
    )
  }

  // Pain Points (structured)
  const painPts = getPainPointsStructured(data)
  if (painPts.length) {
    parts.push(
      detail(
        'Pain Points (detailed)',
        painPts
          .map(
            (p) =>
              `<div class="drow"><p class="drow-t">${H(p.title)}${p.confidence ? ` <span class="muted">${E(p.confidence)}</span>` : ''}</p>${
                p.reasoning ? `<p class="drow-d">${H(p.reasoning)}</p>` : ''
              }${p.evidence ? `<p class="quote">&ldquo;${E(p.evidence)}&rdquo;</p>` : ''}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Reasoning Chains
  const chains = getReasoningChains(data)
  if (chains.length) {
    parts.push(
      detail(
        'Reasoning Chains',
        chains
          .map(
            (c) =>
              `<div class="drow">${kv([
                ['Signal', H(c.signal)],
                ['Implication', H(c.business_implication)],
                ['Pain point', H(c.pain_point)],
                ['Opportunity', H(c.opportunity)],
              ])}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Signals (LLM)
  const sigs = getSignals(data)
  if (sigs.length) {
    parts.push(
      detail(
        'Signals',
        sigs
          .map(
            (s) =>
              `<div class="drow"><p class="drow-t">${E(s.type)} <span class="muted">${E(s.category)}${s.strength ? ` · ${E(s.strength)}` : ''}</span></p>${
                s.evidence ? `<p class="quote">&ldquo;${E(s.evidence)}&rdquo;</p>` : ''
              }</div>`,
          )
          .join(''),
      ),
    )
  }

  // AI Opportunities (detailed)
  const aiOpps = getOpportunities(data)
  if (aiOpps.length) {
    parts.push(
      detail(
        'AI Opportunities (detailed)',
        aiOpps
          .map(
            (o) =>
              `<div class="drow"><p class="drow-t">${H(o.title)}${
                o.claim_type ? ` <span class="muted">${E(o.claim_type)}</span>` : ''
              }</p>${o.description ? `<p class="drow-d">${H(o.description)}</p>` : ''}${
                o.evidence ? `<p class="quote">&ldquo;${E(o.evidence)}&rdquo;</p>` : ''
              }${kv([
                ['Expected impact', H(o.expected_impact)],
                ['Entry point', H(o.entry_point)],
              ])}</div>`,
          )
          .join(''),
      ),
    )
  }

  // Evidence Bank (extractor signals + verbatim quotes)
  if (extractorSignals.length) {
    const evHtml = extractorSignals
      .map((sig) => {
        const evItems = (sig.evidence ?? [])
          .map(
            (ev) =>
              `<div class="ev"><p class="quote">&ldquo;${E(ev.quote)}&rdquo;</p><p class="ev-meta">${[
                ev.evidence_strength,
                ev.source_tier,
                ev.subject,
              ]
                .filter(Boolean)
                .map((x) => E(String(x).replace(/_/g, ' ')))
                .join(' · ')}${ev.source_url ? ` · ${E(ev.source_url)}` : ''}</p></div>`,
          )
          .join('')
        return `<div class="drow"><p class="drow-t">${E(sig.type)} <span class="muted">${E(sig.strength)}${
          sig.validated ? ' · validated' : ''
        }</span></p>${evItems}</div>`
      })
      .join('')
    parts.push(detail('Evidence Bank', evHtml))
  }

  const body = parts.filter(Boolean).join('')
  if (!body) return ''
  return `<div class="appendix"><h2 class="appendix-title">Analysis Detail</h2>${body}</div>`
}

/**
 * Build a complete, standalone HTML document string for the brief.
 * Works for both browser print-to-PDF and Word (.doc) import — Word
 * reads the same HTML and the office xmlns hints improve fidelity.
 */
export function buildBriefHtml(b: BriefInput, extras?: BriefExtras): string {
  const metaLine = [b.industry, b.subIndustry && b.subIndustry !== b.industry ? b.subIndustry : null]
    .filter(Boolean)
    .map((x) => escapeHtml(x))
    .join(' &middot; ')
  const factLine = [b.headquarters, b.sizeEstimate].filter(Boolean).map((x) => escapeHtml(x)).join(' &middot; ')

  const badgeBits = [
    b.confidence ? `${escapeHtml(b.confidence)} confidence` : '',
    typeof b.signalCount === 'number' ? `${b.signalCount} signal${b.signalCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' &middot; ')

  const oppsHtml =
    b.opportunities && b.opportunities.length > 0
      ? `<ul class="opps">${b.opportunities
          .filter((o) => o && o.title)
          .map(
            (o) => `
            <li>
              <span class="opp-title">${escapeHtml(o.title)}</span>
              ${o.description ? `<p class="opp-desc">${escapeHtml(o.description)}</p>` : ''}
              ${o.entryPoint ? `<p class="opp-entry"><span>Entry point:</span> ${escapeHtml(o.entryPoint)}</p>` : ''}
            </li>`,
          )
          .join('')}</ul>`
      : ''

  const personalization =
    b.openingAngle || b.whatToSell || b.whyNow
      ? `
      <section class="block personalization">
        <h2 class="label" style="color:#6d5cf0">Personalization Summary</h2>
        ${b.openingAngle ? `<blockquote>&ldquo;${escapeHtml(b.openingAngle)}&rdquo;</blockquote>` : ''}
        ${b.whatToSell ? `<p class="kv"><span>Lead with:</span> ${escapeHtml(b.whatToSell)}</p>` : ''}
        ${b.whyNow ? `<p class="kv"><span>Why now:</span> ${escapeHtml(b.whyNow)}</p>` : ''}
      </section>`
      : ''

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(b.companyName)} — Research Brief</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a22; background: #ffffff; margin: 0; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { max-width: 720px; margin: 0 auto; padding: 40px 36px 56px; }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
  .brand .mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#6366f1,#7c3aed); color:#fff; font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; }
  .brand .name { font-weight: 600; font-size: 13px; letter-spacing: .01em; }
  .brand .kicker { margin-left:auto; font-size: 11px; color:#8a8a97; text-transform: uppercase; letter-spacing: .12em; }
  header.co { border-bottom: 1px solid #e6e6ec; padding-bottom: 18px; margin-bottom: 22px; }
  header.co h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; }
  header.co .meta { color:#55555f; font-size: 14px; margin: 2px 0; }
  header.co .facts { color:#8a8a97; font-size: 12px; margin: 2px 0 0; }
  header.co .badge { display:inline-block; margin-top: 10px; font-size: 12px; font-weight: 600; color:#0e7a4b; background:#e8f7ef; border:1px solid #bfe8d2; border-radius: 6px; padding: 4px 10px; }
  .block { margin: 20px 0; page-break-inside: avoid; }
  .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .14em; margin: 0 0 8px; }
  p { margin: 0 0 8px; }
  .summary { font-size: 15px; color:#26262e; }
  .model-note { font-size: 12px; font-style: italic; color:#8a8a97; margin: 6px 0 0; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 0 0 6px; }
  ul.opps { list-style: none; padding-left: 0; }
  ul.opps > li { margin-bottom: 12px; padding-left: 14px; border-left: 2px solid #16a34a; }
  .opp-title { font-weight: 600; }
  .opp-desc { color:#55555f; font-size: 13px; margin: 3px 0 0; }
  .opp-entry { color:#8a8a97; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 0; }
  .opp-entry span { font-weight: 600; }
  .personalization { border:1px solid #dcd8fb; background:#f5f3ff; border-radius: 10px; padding: 16px 18px; }
  blockquote { margin: 0 0 10px; padding-left: 14px; border-left: 3px solid #6d5cf0; font-size: 15px; color:#2a2440; }
  .kv { font-size: 13px; }
  .kv span { font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color:#55555f; font-size: 11px; }
  footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid #e6e6ec; font-size: 11px; color:#a2a2ad; }
  /* Analysis Detail appendix */
  .appendix { margin-top: 30px; padding-top: 4px; page-break-before: always; }
  .appendix-title { font-size: 18px; margin: 0 0 4px; padding-bottom: 8px; border-bottom: 2px solid #1a1a22; }
  .dblock { margin: 16px 0; page-break-inside: avoid; }
  .dlabel { font-size: 13px; font-weight: 700; margin: 0 0 8px; color:#2a2a34; }
  .dsub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color:#8a8a97; margin: 8px 0 4px; }
  .drow { padding: 8px 0; border-bottom: 1px solid #f0f0f4; }
  .drow:last-child { border-bottom: 0; }
  .drow-t { font-weight: 600; font-size: 13px; margin: 0 0 2px; }
  .drow-d { font-size: 12px; color:#55555f; margin: 2px 0; }
  .drow-s { font-size: 11px; color:#6d5cf0; margin: 2px 0 0; }
  .muted { font-weight: 400; color:#a2a2ad; font-size: 11px; }
  .quote { font-size: 12px; color:#6b6b76; font-style: italic; border-left: 2px solid #e0e0e6; padding-left: 8px; margin: 4px 0; }
  .ev { margin: 6px 0; }
  .ev-meta { font-size: 10px; color:#a2a2ad; margin: 2px 0 0; word-break: break-all; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0; }
  .chip { font-size: 11px; background:#f1f0f7; color:#4a4a56; border-radius: 5px; padding: 2px 8px; }
  table.kvt { width: 100%; border-collapse: collapse; margin: 4px 0; }
  table.kvt td { padding: 3px 0; vertical-align: top; font-size: 12px; }
  td.kvk { color:#8a8a97; width: 150px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding-right: 12px; }
  td.kvv { color:#26262e; }
  @page { margin: 1.4cm; }
  @media print { .page { padding: 0; } }
</style>
</head>
<body>
  <div class="page">
    <div class="brand">
      <span class="mark">D</span>
      <span class="name">Demaze Intelligence</span>
      <span class="kicker">Outbound Research Brief</span>
    </div>

    <header class="co">
      <h1>${escapeHtml(b.companyName)}</h1>
      ${metaLine ? `<p class="meta">${metaLine}</p>` : ''}
      ${factLine ? `<p class="facts">${factLine}</p>` : ''}
      ${badgeBits ? `<span class="badge">${badgeBits}</span>` : ''}
    </header>

    ${section(
      'Company Description',
      '#55555f',
      b.summary
        ? `<p class="summary">${escapeHtml(b.summary)}</p>${
            b.businessModel && !b.summary.toLowerCase().includes(b.businessModel.toLowerCase().slice(0, 20))
              ? `<p class="model-note">${escapeHtml(b.businessModel)}</p>`
              : ''
          }`
        : '',
    )}
    ${section('Recent News', '#4f46e5', list(b.recentNews ?? []))}
    ${section('Pain Points', '#b45309', list(b.painPoints ?? []))}
    ${section('AI Opportunities', '#15803d', oppsHtml)}
    ${personalization}

    ${extras ? buildAnalysisAppendix(extras) : ''}

    <footer>
      Generated by Demaze Intelligence${b.generatedAt ? ` &middot; ${escapeHtml(b.generatedAt)}` : ''} &middot; Internal use only
    </footer>
  </div>
</body>
</html>`
}
