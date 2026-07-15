'use client'

// ============================================================
// Research Card — shared result display (the SDR-facing hero)
// ============================================================
// Rendered by intelligence-lab (hero) + run-history + batch.
// Maps analysisResult onto the locked 5-field output schema:
//   Company Description · Pain Points · AI Opportunities ·
//   Recent News · Personalization Summary
//
// Layout goal: use the full width. The old card was capped at
// max-w-3xl, leaving a large empty gutter on the right. This
// version is full-bleed with a 2-column hero (description +
// facts rail) and a balanced 2-up grid for the body sections.
// ============================================================

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { humanizeText, humanizeList } from '@/lib/text/humanize'
import { downloadBriefPdf, downloadBriefWord } from '@/lib/export/download-brief'
import type { BriefInput, BriefExtras } from '@/lib/export/brief-html'
import { getCompetitors, getICPSegments, getMarketIntelligence, getResearchQuality } from '@/lib/pipeline/analysis-sections'
import type { RunResult } from './_types'

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  )
}

function Section({
  label,
  accent,
  className,
  children,
}: {
  label: string
  accent?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('border-border bg-card', className)}>
      <CardContent className="px-5 py-4">
        <p
          className={cn(
            'mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]',
            accent ?? 'text-muted-foreground',
          )}
        >
          {label}
        </p>
        {children}
      </CardContent>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="text-right text-xs font-medium text-foreground/90">{value}</span>
    </div>
  )
}

export function ResearchCard({ result }: { result: RunResult }) {
  const a = result.analysisResult as Record<string, unknown> | undefined
  if (!a)
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
        <div className="mb-3 grid size-11 place-items-center rounded-xl bg-accent text-muted-foreground">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </div>
        <p className="max-w-xs text-sm text-muted-foreground">
          Enter a company URL and run <strong className="text-foreground">Analyze</strong> to generate a research brief.
        </p>
      </div>
    )

  const str = (v: unknown) => (v != null && v !== '' ? String(v) : null)

  const companyName = str(a.company_name) ?? 'Unknown Company'
  const industry = str(a.industry) ?? ''
  const subIndustry = str(a.sub_industry) ?? ''
  const sizeEstimate = str(a.company_size_estimate) ?? ''
  const headquarters = str(a.headquarters_location) ?? ''
  const summary = humanizeText(a.company_summary)
  const confidence = str(a.confidence_level) ?? 'low'
  const businessModel = humanizeText(a.business_model)

  const recentActivity: string[] = humanizeList(a.recent_activity)

  // Evidence-strength — driven by extracted signal count
  const signalCount = result.extractorResult?.signals?.length ?? 0
  const tier = signalCount >= 4 ? 'strong' : signalCount >= 2 ? 'medium' : 'weak'
  const tierMeta = {
    strong: { label: 'Strong signal', text: 'text-signal-strong', ring: 'border-signal-strong/40 bg-signal-strong/10' },
    medium: { label: 'Some signal', text: 'text-signal-medium', ring: 'border-signal-medium/40 bg-signal-medium/10' },
    weak: { label: 'Inferred', text: 'text-signal-none', ring: 'border-border bg-accent/40' },
  }[tier]
  const confText =
    confidence === 'high' ? 'text-signal-strong' : confidence === 'medium' ? 'text-signal-medium' : 'text-muted-foreground'

  const rawPainPoints = Array.isArray(a.pain_points) ? (a.pain_points as unknown[]) : []
  const painPoints: string[] = rawPainPoints
    .slice(0, 6)
    .map((p) =>
      typeof p === 'string'
        ? p
        : typeof p === 'object' && p !== null
          ? (str((p as Record<string, unknown>).title) ?? '')
          : '',
    )
    .map((p) => humanizeText(p))
    .filter(Boolean)

  const opportunities = Array.isArray(a.opportunities)
    ? (a.opportunities as Array<Record<string, unknown>>).slice(0, 6)
    : []
  const aiSynthesisFailed = a.ai_synthesis_status === 'failed'
  const aiSynthesisFailureReason = str(a.ai_synthesis_failure_reason)

  const competitors = getCompetitors(a)
  const icpSegments = getICPSegments(a)
  const marketIntel = getMarketIntelligence(a)
  const researchQuality = getResearchQuality(a)

  const outreachIntel = a.outreach_intelligence as Record<string, unknown> | null
  const openingAngle = humanizeText(str(outreachIntel?.opening_angle) ?? str(a.outreach_angle) ?? '')
  const whyNow = humanizeText(str(outreachIntel?.why_now) ?? str((a.why_now as Record<string, unknown>)?.explanation) ?? '')
  const whatToSell = humanizeText(str((a.executive_brief as Record<string, unknown>)?.what_to_sell) ?? '')

  const facts: Array<{ label: string; value: string }> = [
    industry && { label: 'Industry', value: industry },
    subIndustry && subIndustry !== industry && { label: 'Segment', value: subIndustry },
    headquarters && { label: 'HQ', value: headquarters },
    sizeEstimate && { label: 'Size', value: sizeEstimate },
  ].filter(Boolean) as Array<{ label: string; value: string }>

  // Assemble the export payload from the already-humanized display fields,
  // so the downloaded PDF/Word match exactly what's on screen.
  const briefInput: BriefInput = {
    companyName,
    industry: industry || undefined,
    subIndustry: subIndustry || undefined,
    headquarters: headquarters || undefined,
    sizeEstimate: sizeEstimate || undefined,
    confidence: confidence || undefined,
    signalCount,
    summary: summary || undefined,
    businessModel: businessModel || undefined,
    recentNews: recentActivity,
    painPoints,
    opportunities: opportunities.map((o) => ({
      title: humanizeText(o.title),
      description: str(o.description) ? humanizeText(o.description) : undefined,
      entryPoint: str(o.entry_point) ? humanizeText(o.entry_point) : undefined,
    })),
    openingAngle: openingAngle || undefined,
    whatToSell: whatToSell || undefined,
    whyNow: whyNow || undefined,
  }

  // Full Analysis-tab detail appended after the brief in the export.
  const briefExtras: BriefExtras = {
    analysis: a,
    signals: result.extractorResult?.signals ?? [],
  }

  return (
    <div className="space-y-3">
      {/* Export toolbar */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => downloadBriefPdf(briefInput, briefExtras)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Download the full brief + analysis as a PDF"
        >
          <DownloadIcon className="size-3.5" />
          PDF
        </button>
        <button
          type="button"
          onClick={() => downloadBriefWord(briefInput, briefExtras)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Download the full brief + analysis as a Word document"
        >
          <DownloadIcon className="size-3.5" />
          Word
        </button>
      </div>

      {/* AI synthesis failure banner */}
      {aiSynthesisFailed && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="px-5 py-3">
            <p className="text-sm font-semibold text-destructive">AI synthesis failed, this report is incomplete</p>
            <p className="mt-1 text-xs text-destructive/80">
              The AI narrative step could not produce a valid response after a retry. Sections below reflect
              deterministic signal data only, empty sections mean the AI failed to write them, not that nothing was
              found. Re-run the analysis to retry.
            </p>
            {aiSynthesisFailureReason && (
              <p className="mt-1.5 font-mono text-[10px] text-destructive/60">{aiSynthesisFailureReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Hero: description (wide) + facts rail (narrow) ─────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-border bg-card lg:col-span-2">
          <CardContent className="px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground">{companyName}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[industry, subIndustry && subIndustry !== industry ? subIndustry : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className={cn('shrink-0 rounded-lg border px-3 py-2 text-right', tierMeta.ring)}>
                <div className={cn('text-xs font-semibold', tierMeta.text)}>{tierMeta.label}</div>
                <div className={cn('mt-0.5 text-xs', confText)}>{confidence} confidence</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                  {signalCount} signal{signalCount !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            {summary && (
              <p className="mt-4 border-t border-border pt-4 text-[15px] leading-relaxed text-foreground/90">{summary}</p>
            )}
            {businessModel && !summary.toLowerCase().includes(businessModel.toLowerCase().slice(0, 20)) && (
              <p className="mt-2 text-xs italic text-muted-foreground">{businessModel}</p>
            )}
          </CardContent>
        </Card>

        {/* Facts rail, fills what used to be dead space on the right */}
        <Card className="border-border bg-card">
          <CardContent className="flex h-full flex-col px-5 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              At a glance
            </p>
            {facts.length > 0 ? (
              <div className="divide-y divide-border/60">
                {facts.map((f) => (
                  <Fact key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">No firmographic detail extracted.</p>
            )}
            <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
              <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-center">
                <div className="text-lg font-semibold text-foreground">{painPoints.length}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Pain points</div>
              </div>
              <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-center">
                <div className="text-lg font-semibold text-foreground">{opportunities.length}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Opportunities</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent News */}
      {recentActivity.length > 0 && (
        <Section label="Recent News">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
            {recentActivity.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground/90">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Pain Points + AI Opportunities */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Section label="Pain Points" accent="text-signal-medium">
          {painPoints.length > 0 ? (
            <ul className="space-y-2.5">
              {painPoints.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-foreground/90">
                  <span className="mt-0.5 shrink-0 text-signal-medium">▸</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {aiSynthesisFailed ? 'AI synthesis failed, see banner above.' : 'No pain points identified. Try a fresh scrape.'}
            </p>
          )}
        </Section>

        <Section label="AI Opportunities" accent="text-signal-strong">
          {opportunities.length > 0 ? (
            <ul className="space-y-3">
              {opportunities.map((o, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0 text-signal-strong">▸</span>
                  <div>
                    <span className="font-medium text-foreground">{humanizeText(o.title)}</span>
                    {str(o.description) && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{humanizeText(o.description)}</p>
                    )}
                    {str(o.entry_point) && (
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        Entry point: <span className="normal-case text-muted-foreground/80">{humanizeText(o.entry_point)}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {aiSynthesisFailed ? 'AI synthesis failed, see banner above.' : 'No opportunities identified. Try a fresh scrape.'}
            </p>
          )}
        </Section>
      </div>

      {/* Competitors (Phase 2 item 1) — additive to the locked 5-field
          schema above, same "only render when there's something real"
          discipline as Recent News: an empty/insufficient result shows no
          section at all rather than a "no competitors found" message. */}
      {competitors.length > 0 && (
        <Section label="Competitors" accent="text-signal-medium">
          <ul className="space-y-3">
            {competitors.map((c, i) => {
              const confClass =
                c.confidence === 'high'
                  ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
                  : c.confidence === 'medium'
                    ? 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
                    : 'border-border bg-accent/40 text-muted-foreground'
              return (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{c.name}</span>
                    {c.why_they_compete && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {humanizeText(c.why_they_compete)}
                      </p>
                    )}
                    {(c.market_position || c.differentiator) && (
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        {c.market_position && (
                          <>Position: <span className="normal-case text-muted-foreground/80">{c.market_position}</span></>
                        )}
                        {c.market_position && c.differentiator && ' · '}
                        {c.differentiator && (
                          <>Differentiator: <span className="normal-case text-muted-foreground/80">{c.differentiator}</span></>
                        )}
                      </p>
                    )}
                  </div>
                  {c.confidence && (
                    <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confClass)}>
                      {c.confidence}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Target Customer Segments (ICP Generator, Phase 2 item 2) — who
          THIS company sells to, not company_fit (that's a separate score of
          how well this company fits Demaze's own ICP). Same "only render
          when there's something real" discipline as Competitors above. */}
      {icpSegments.length > 0 && (
        <Section label="Target Customer Segments" accent="text-signal-medium">
          <ul className="space-y-3">
            {icpSegments.map((s, i) => {
              const confClass =
                s.confidence === 'high'
                  ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
                  : s.confidence === 'medium'
                    ? 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
                    : 'border-border bg-accent/40 text-muted-foreground'
              return (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{s.name}</span>
                    {s.reason && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {humanizeText(s.reason)}
                      </p>
                    )}
                    {(s.criteria || s.buying_indicators) && (
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        {s.criteria && (
                          <>Criteria: <span className="normal-case text-muted-foreground/80">{s.criteria}</span></>
                        )}
                        {s.criteria && s.buying_indicators && ' · '}
                        {s.buying_indicators && (
                          <>Buying signal: <span className="normal-case text-muted-foreground/80">{s.buying_indicators}</span></>
                        )}
                      </p>
                    )}
                  </div>
                  {s.confidence && (
                    <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confClass)}>
                      {s.confidence}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Market Intelligence (Phase 2 item 6) — industry-level trends/
          growth indicators/challenges/shifts for the sector the researched
          company operates in. Pure passthrough (no LLM narration layer, see
          lib/enrichment/market-intelligence.ts header) — each item is
          rendered as-extracted. Same "only render when there's something
          real" discipline as Competitors/Target Customer Segments. */}
      {marketIntel.length > 0 && (
        <Section label="Market Intelligence" accent="text-signal-medium">
          <ul className="space-y-3">
            {marketIntel.map((m, i) => {
              const confClass =
                m.confidence === 'high'
                  ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
                  : m.confidence === 'medium'
                    ? 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
                    : 'border-border bg-accent/40 text-muted-foreground'
              const categoryLabel =
                m.category === 'growth_indicator' ? 'Growth Indicator'
                : m.category === 'challenge' ? 'Challenge'
                : m.category === 'shift' ? 'Industry Shift'
                : 'Trend'
              return (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      {categoryLabel}
                    </span>
                    <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">{m.statement}</p>
                  </div>
                  {m.confidence && (
                    <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confClass)}>
                      {m.confidence}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Research Quality (Phase 2 item 4) — a per-item confidence audit
          cross-checking whether an item's stated confidence is actually
          justified by its evidence. Informational only, never gates or
          suppresses anything above it. Same "only render when there's
          something real" discipline as Competitors/Target Customer
          Segments — an audit with zero flags shows no section at all. */}
      {researchQuality && (researchQuality.items_flagged ?? 0) > 0 && (
        <Section label="Research Quality" accent="text-signal-medium">
          <p className="mb-3 text-xs text-muted-foreground">
            {researchQuality.items_flagged} of {researchQuality.items_audited} audited item
            {researchQuality.items_audited !== 1 ? 's' : ''} flagged for review — informational only, nothing above
            was suppressed or downgraded.
          </p>
          <ul className="space-y-2.5">
            {(researchQuality.flags ?? []).map((f, i) => {
              const severityClass =
                f.severity === 'warn'
                  ? 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
                  : 'border-border bg-accent/40 text-muted-foreground'
              return (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{f.item_ref}</span>
                    {f.reason && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.reason}</p>}
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      {f.item_type}
                    </p>
                  </div>
                  {f.severity && (
                    <span
                      className={cn(
                        'shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize',
                        severityClass,
                      )}
                    >
                      {f.severity}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* Personalization Summary, full width, the payoff */}
      {(openingAngle || whatToSell) && (
        <Card className="border-primary/30 bg-primary/[0.07]">
          <CardContent className="px-6 py-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              Personalization Summary
            </p>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {openingAngle && (
                <p className="border-l-2 border-primary pl-4 text-[15px] leading-relaxed text-foreground/90 lg:col-span-2">
                  &ldquo;{openingAngle}&rdquo;
                </p>
              )}
              <div className="space-y-3 text-xs">
                {whatToSell && (
                  <div>
                    <p className="mb-0.5 font-semibold uppercase tracking-wider text-muted-foreground">Lead with</p>
                    <p className="text-foreground/90">{whatToSell}</p>
                  </div>
                )}
                {whyNow && (
                  <div>
                    <p className="mb-0.5 font-semibold uppercase tracking-wider text-muted-foreground">Why now</p>
                    <p className="text-muted-foreground">{whyNow}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
