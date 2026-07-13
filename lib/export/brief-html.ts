// ============================================================
// Brief export — build a self-contained HTML document of the
// SDR research brief. Pure (no DOM/window), so it's testable and
// shared by both the PDF (print) and Word (.doc) download paths.
// Mirrors the ResearchCard's 5-field schema:
//   Company Description · Recent News · Pain Points ·
//   AI Opportunities · Personalization Summary
// ============================================================

export interface BriefOpportunity {
  title: string
  description?: string
  entryPoint?: string
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

/**
 * Build a complete, standalone HTML document string for the brief.
 * Works for both browser print-to-PDF and Word (.doc) import — Word
 * reads the same HTML and the office xmlns hints improve fidelity.
 */
export function buildBriefHtml(b: BriefInput): string {
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

    ${section('Company Description', '#55555f', b.summary ? `<p class="summary">${escapeHtml(b.summary)}</p>` : '')}
    ${section('Recent News', '#4f46e5', list(b.recentNews ?? []))}
    ${section('Pain Points', '#b45309', list(b.painPoints ?? []))}
    ${section('AI Opportunities', '#15803d', oppsHtml)}
    ${personalization}

    <footer>
      Generated by Demaze Intelligence${b.generatedAt ? ` &middot; ${escapeHtml(b.generatedAt)}` : ''} &middot; Internal use only
    </footer>
  </div>
</body>
</html>`
}
