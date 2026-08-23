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
//
// Sections below are exported individually so the wizard flow
// (components/wizard/steps/*) can regroup them into staged
// steps without duplicating markup — ResearchCard itself stays
// a flat composer for its existing call sites (intelligence-lab
// hero, batch-upload, company-discovery expanded row).
// ============================================================

import Link from 'next/link'
import { Fragment, useState, type ReactNode } from 'react'
import {
  Building2, Newspaper, AlertTriangle, Lightbulb, Users, Target, TrendingUp,
  ShieldCheck, Sparkles, MessageSquare, ExternalLink, CheckCircle2, BrainCircuit,
  Radar,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { EvidenceStack, SourceRow } from '@/components/ui/evidence-stack'
import { IntelStatus } from '@/components/ui/intel-status'
import { MetricTile } from '@/components/ui/metric-tile'
import { cn } from '@/lib/utils'
import { humanizeText, humanizeList } from '@/lib/text/humanize'
import { downloadBriefPdf, downloadBriefWord } from '@/lib/export/download-brief'
import type { BriefInput, BriefExtras } from '@/lib/export/brief-html'
import {
  getCompetitors,
  getICPSegments,
  getMarketIntelligence,
  getResearchQuality,
  getCompanyOfferings,
  getBusinessProfile,
  getSignals,
  getPainPointsStructured,
  getOutreachDraft,
  getWhyDemaze,
  getCompanyFit,
  getAutomationOpportunity,
  getWhyNow,
  type CompetitorProfile,
  type ICPSegment,
  type MarketIntelItem,
  type ResearchQualityAudit,
  type CompanyBusinessProfile,
  type OutreachDraft,
  type WhyDemaze,
  type WhyDemazeReason,
  type CompanyFit,
  type AutomationOpportunity,
  type WhyNow,
} from '@/lib/pipeline/analysis-sections'
import { DEMAZE_PROOF_POINTS, type ProofPoint } from '@/lib/knowledge/demaze-proof-points'
import type { RunResult } from './_types'

const str = (v: unknown) => (v != null && v !== '' ? String(v) : null)

// Compact "source reference" chip — domain + external-link affordance. Never
// labeled "verified"; this pipeline doesn't mechanically verify sources, it
// just cites where a claim was found. Reused by Competitors/Target Segments/
// Market Intelligence, the three sections that already carry source_urls.
function domainFromUrl(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SourceLinks({ urls }: { urls?: string[] }) {
  if (!urls || urls.length === 0) return null
  const deduped = Array.from(new Set(urls)).slice(0, 3)
  return (
    <div className="mt-1.5 -mx-2 flex flex-col">
      {deduped.map((u) => (
        <SourceRow
          key={u}
          icon={ExternalLink}
          label={domainFromUrl(u)}
          href={u.startsWith('http') ? u : `https://${u}`}
        />
      ))}
    </div>
  )
}

// Shared FACT vs DEMAZE READ tag — only ever reflects a real claim_type/source
// field already on the data (see hard constraint: never fabricate this
// distinction). 'observed'/'deterministic'/'llm_verified' read as an
// observed fact; 'inferred'/'llm_inferred' read as Demaze's own read on it.
function ClaimTag({ claimType, source }: { claimType?: string; source?: string }) {
  const isFact = source === 'deterministic' || source === 'llm_verified' || claimType === 'observed'
  const isInference = source === 'llm_inferred' || claimType === 'inferred'
  if (!isFact && !isInference) return null
  return isFact ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-evidence-fact">
      <CheckCircle2 className="size-3" /> Fact
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-evidence-inference">
      <BrainCircuit className="size-3" /> Demaze read
    </span>
  )
}

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
  icon: Icon,
  className,
  children,
}: {
  label: string
  accent?: string
  icon?: React.ComponentType<{ className?: string }>
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('border-border bg-card', className)}>
      <CardContent className="px-5 py-4">
        <p
          className={cn(
            'mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]',
            accent ?? 'text-muted-foreground',
          )}
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
        </p>
        {children}
      </CardContent>
    </Card>
  )
}

// Joins an array of possibly-null JSX fragments with a " · " separator,
// skipping nulls — shared by CompetitorsSection/TargetSegmentsSection's
// meta lines below.
function joinWithDot(parts: Array<ReactNode | false | null | undefined>): ReactNode[] {
  const present = parts.filter(Boolean) as ReactNode[]
  return present.flatMap((part, i) => (
    i === 0 ? [<Fragment key={i}>{part}</Fragment>] : [<Fragment key={`sep-${i}`}> · </Fragment>, <Fragment key={i}>{part}</Fragment>]
  ))
}

function confidenceClass(confidence?: string) {
  return confidence === 'high'
    ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
    : confidence === 'medium'
      ? 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
      : 'border-border bg-accent/40 text-muted-foreground'
}

// ============================================================
// Individually-exported sections
// ============================================================

export function ExportToolbar({ briefInput, briefExtras }: { briefInput: BriefInput; briefExtras: BriefExtras }) {
  return (
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
  )
}

export function AISynthesisFailureBanner({ failed, reason }: { failed: boolean; reason?: string | null }) {
  if (!failed) return null
  return (
    <Card className="border-destructive/40 bg-destructive/10">
      <CardContent className="px-5 py-3">
        <p className="text-sm font-semibold text-destructive">AI synthesis failed, this report is incomplete</p>
        <p className="mt-1 text-xs text-destructive/80">
          The AI narrative step could not produce a valid response after a retry. Sections below reflect
          deterministic signal data only, empty sections mean the AI failed to write them, not that nothing was
          found. Re-run the analysis to retry.
        </p>
        {reason && <p className="mt-1.5 font-mono text-[10px] text-destructive/60">{reason}</p>}
      </CardContent>
    </Card>
  )
}

export interface ResearchHeroProps {
  companyName: string
  industry: string
  subIndustry: string
  summary: string
  businessModel: string
  confidence: string
  signalCount: number
  painPointsCount: number
  opportunitiesCount: number
  facts: Array<{ label: string; value: string }>
  // When available (a saved/cached run), shown as "Researched Xh ago" next
  // to the status dot instead of a bare "Research complete" — real data
  // only, from RunResult.cachedAt, never fabricated.
  lastResearchedAt?: string
}

// Small relative-time formatter — mirrors intelligence-lab/page.tsx's own
// local timeAgo(), duplicated per this codebase's small-helper-per-file
// convention rather than extracted into a shared util for one caller.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function ResearchHero({
  companyName,
  industry,
  subIndustry,
  summary,
  businessModel,
  confidence,
  signalCount,
  painPointsCount,
  opportunitiesCount,
  facts,
  lastResearchedAt,
}: ResearchHeroProps) {
  const confText =
    confidence === 'high' ? 'text-signal-strong' : confidence === 'medium' ? 'text-signal-medium' : 'text-muted-foreground'

  return (
    <div className="space-y-3">
      <Card className="border-border bg-card">
        <CardContent className="px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground">{companyName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {[industry, subIndustry && subIndustry !== industry ? subIndustry : null, ...facts.filter(f => f.label !== 'Industry' && f.label !== 'Segment').map(f => f.value)]
                  .filter(Boolean)
                  .join(' · ') || 'No firmographic detail extracted.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <IntelStatus status="complete" label={lastResearchedAt ? `Researched ${timeAgo(lastResearchedAt)}` : undefined} />
              <span className={cn('text-xs', confText)}>{confidence} confidence</span>
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

      <div className="grid grid-cols-3 gap-2.5">
        <MetricTile icon={Radar} label="Signals" value={signalCount} />
        <MetricTile icon={AlertTriangle} label="Pain points" value={painPointsCount} />
        <MetricTile icon={Lightbulb} label="Opportunities" value={opportunitiesCount} />
      </div>
    </div>
  )
}

// Scored labels only ever come from scorer.ts's shared scoreLabel()
// ('Strong' | 'Good' | 'Moderate' | 'Weak') — same tone scale used by
// evidenceBadge/confidenceClass below, just keyed off this specific label
// set instead of a raw 'high'/'medium' confidence string.
function scoredLabelTone(label?: string): string {
  if (label === 'Strong') return 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
  if (label === 'Good') return 'border-signal-medium/40 bg-signal-medium/10 text-signal-medium'
  if (label === 'Moderate') return 'border-signal-weak/40 bg-signal-weak/10 text-signal-weak'
  if (label === 'Weak') return 'border-border bg-accent/40 text-muted-foreground'
  return 'border-border bg-accent/40 text-muted-foreground'
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border px-3.5 py-3', tone)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] opacity-70" title={sub}>{sub}</p>}
    </div>
  )
}

// Top summary row — company_fit ("is this a good lead for Demaze"),
// automation_opportunity, why_now (urgency), and the existing confidence
// field. All four are scored deterministically upstream (lib/pipeline/
// scorer.ts) and already flow into the API response — previously only
// ever rendered in intelligence-lab's raw debug Inspector (ScoreRow), not
// on this shared card. Renders nothing (not a row of "—" placeholders) if
// none of the four scores are present, e.g. a run from before this scoring
// pass existed.
export function FitSummaryRow({
  companyFit,
  automationOpportunity,
  whyNow,
  confidence,
}: {
  companyFit?: CompanyFit
  automationOpportunity?: AutomationOpportunity
  whyNow?: WhyNow
  confidence: string
}) {
  if (!companyFit?.label && !automationOpportunity?.label && !whyNow?.urgency_label) return null
  const confTone =
    confidence === 'high' ? scoredLabelTone('Strong') : confidence === 'medium' ? scoredLabelTone('Good') : scoredLabelTone('Weak')
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {companyFit?.label && (
        <SummaryCard label="Fit" value={companyFit.label} sub={companyFit.rationale} tone={scoredLabelTone(companyFit.label)} />
      )}
      {automationOpportunity?.label && (
        <SummaryCard label="Opportunity" value={automationOpportunity.label} tone={scoredLabelTone(automationOpportunity.label)} />
      )}
      {whyNow?.urgency_label && (
        <SummaryCard label="Why Now" value={whyNow.urgency_label} sub={whyNow.explanation} tone={scoredLabelTone(whyNow.score != null && whyNow.score >= 5 ? 'Strong' : whyNow.score != null && whyNow.score >= 2 ? 'Good' : 'Weak')} />
      )}
      {confidence && (
        <SummaryCard label="Confidence" value={confidence.charAt(0).toUpperCase() + confidence.slice(1)} tone={confTone} />
      )}
    </div>
  )
}

export function RecentNewsSection({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <Section label="Recent News" icon={Newspaper}>
      <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 rounded-lg border border-border/60 bg-accent/20 px-3 py-2.5 text-sm">
            <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Fact</span>
            <span className="text-foreground/90 leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export interface SignalItem {
  type?: unknown
  category?: unknown
  strength?: unknown
  evidence?: unknown
}

// Detected Signals — the deterministic evidence layer under Pain
// Points/Opportunities (lib/pipeline SIGNAL_PATTERNS), each backed by a
// real quote from the company's own scraped/enriched content. Previously
// only ever shown in intelligence-lab's debug Inspector — never on the
// SDR-facing report itself. Same "only render when there's something
// real" discipline as every other additive section here.
export function SignalsSection({ signals }: { signals: SignalItem[] }) {
  if (signals.length === 0) return null
  return (
    <Section label="Signals Detected" accent="text-signal-medium" icon={Radar}>
      <ul className="space-y-3">
        {signals.map((sig, i) => {
          const type = str(sig.type)
          const category = str(sig.category)
          const strength = str(sig.strength)
          const evidence = str(sig.evidence)
          if (!evidence && !type) return null
          return (
            <li key={i}>
              <EvidenceStack
                fact={evidence ? `“${evidence}”` : (type ?? 'Signal detected')}
                factMeta={joinWithDot([
                  type && <span className="capitalize">{type.replace(/_/g, ' ')}</span>,
                  strength && <span className="capitalize">{strength}</span>,
                  category && <span className="capitalize">{category.replace(/_/g, ' ')}</span>,
                ])}
              />
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export interface OpportunityItem {
  title?: unknown
  description?: unknown
  entry_point?: unknown
  evidence?: unknown
  claim_type?: unknown
  source?: unknown
  category?: unknown
  service_line?: unknown
  relevance?: unknown
  // Real fields on the normalized opportunity (normalize.ts) — the verbatim
  // fact this opportunity is grounded in, and (for llm_inferred entries with
  // no literal quote) the stated reasoning basis. Used to drive the
  // Evidence -> Inference -> Opportunity chain below.
  observed_basis?: unknown
  inferred_from?: unknown
}

export interface PainPointItem {
  title?: unknown
  confidence?: unknown
  claim_type?: unknown
  evidence?: unknown
  reasoning?: unknown
}

// Master Plan Phase 4/10.4: "never present inference as fact." source/
// claim_type already exist on every opportunity (normalize.ts) but were
// never surfaced here — this is a pure read of already-present data, no
// new plumbing. 'deterministic' (regex-matched real content) and
// 'llm_verified' (quote-verified against real content) both read as
// Confirmed; 'llm_inferred' (reasoning, no literal quote) reads as
// Reasonable inference — matches this repo's own evidence_id discipline
// (see normalize.ts's stableEvidenceId).
// Kept as a thin wrapper around the shared ClaimTag for existing callers
// that pass the looser OpportunityItem shape.
function evidenceBadge(o: OpportunityItem): { claimType?: string; source?: string } | null {
  const source = str(o.source) ?? undefined
  const claimType = str(o.claim_type) ?? undefined
  if (!source && !claimType) return null
  return { claimType, source }
}

export function PainPointsAndOpportunitiesSection({
  painPoints,
  painPointsStructured,
  opportunities,
  aiSynthesisFailed,
}: {
  painPoints: string[]
  // Optional — when present (and non-empty), each pain point renders as an
  // evidence-graded assessment card (confidence + Fact/Demaze-read tag +
  // evidence quote + reasoning) instead of a flat bullet. Falls back to the
  // plain `painPoints` list when omitted, so existing callers that only pass
  // `painPoints` (Step1Research, AutoFlowResearchSummary) are unaffected.
  painPointsStructured?: PainPointItem[]
  opportunities: OpportunityItem[]
  aiSynthesisFailed: boolean
}) {
  const structured = (painPointsStructured ?? []).filter(p => str(p.title))

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Section label="Pain Points" accent="text-signal-medium" icon={AlertTriangle}>
        {structured.length > 0 ? (
          <ul className="space-y-3">
            {structured.map((p, i) => {
              const claimType = str(p.claim_type) ?? undefined
              const borderTone =
                claimType === 'observed' ? 'border-evidence-fact/50' : claimType === 'inferred' ? 'border-evidence-inference/50' : 'border-border'
              const conf = str(p.confidence)
              return (
                <li key={i} className={cn('border-l-2 py-0.5 pl-3', borderTone)}>
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground">{humanizeText(p.title)}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <ClaimTag claimType={claimType} />
                      {conf && (
                        <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize', confidenceClass(conf))}>
                          {conf}
                        </span>
                      )}
                    </div>
                  </div>
                  {str(p.evidence) && (
                    <p className="mt-1 text-xs italic leading-relaxed text-muted-foreground/80">&ldquo;{humanizeText(p.evidence)}&rdquo;</p>
                  )}
                  {str(p.reasoning) && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{humanizeText(p.reasoning)}</p>
                  )}
                </li>
              )
            })}
          </ul>
        ) : painPoints.length > 0 ? (
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

      <Section label="AI Opportunities" accent="text-signal-strong" icon={Lightbulb}>
        {opportunities.length > 0 ? (
          <ul className="space-y-3">
            {opportunities.map((o, i) => {
              const badge = evidenceBadge(o)
              const service = str(o.service_line) ?? str(o.category)
              const relevance = str(o.relevance)
              // Evidence -> Inference -> Opportunity chain, only when there's
              // real fact-level grounding (a verbatim quote or stated observed
              // basis) to anchor it — never label reasoning-only content as
              // EVIDENCE (hard rule: don't present inference as observed fact).
              const factText = str(o.evidence) ?? str(o.observed_basis)
              const inferenceText = str(o.inferred_from)
              const metaRow = (service || str(o.entry_point) || relevance) ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {service && (
                    <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {humanizeText(service)}
                    </span>
                  )}
                  {relevance && (
                    <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize', confidenceClass(relevance.toLowerCase()))}>
                      {relevance} relevance
                    </span>
                  )}
                  {str(o.entry_point) && (
                    <span className="text-[10px] text-muted-foreground/70">
                      Entry point: <span className="text-muted-foreground/90">{humanizeText(o.entry_point)}</span>
                    </span>
                  )}
                </div>
              ) : undefined

              if (factText) {
                return (
                  <li key={i} className="rounded-lg border border-border/60 bg-accent/10 px-3.5 py-3">
                    <EvidenceStack
                      fact={`“${humanizeText(factText)}”`}
                      inference={inferenceText ? humanizeText(inferenceText) : undefined}
                      opportunity={
                        <>
                          <span className="font-medium text-foreground">{humanizeText(o.title)}</span>
                          {str(o.description) && (
                            <span className="mt-0.5 block font-normal text-muted-foreground">{humanizeText(o.description)}</span>
                          )}
                        </>
                      }
                      opportunityMeta={metaRow}
                    />
                  </li>
                )
              }

              return (
                <li key={i} className="rounded-lg border border-border bg-accent/20 px-3.5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <span className="font-medium text-foreground">{humanizeText(o.title)}</span>
                    {badge && <ClaimTag claimType={badge.claimType} source={badge.source} />}
                  </div>
                  {str(o.description) && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{humanizeText(o.description)}</p>
                  )}
                  {inferenceText && (
                    <p className="mt-1.5 text-xs leading-relaxed text-evidence-inference/90">{humanizeText(inferenceText)}</p>
                  )}
                  {metaRow && <div className="mt-2">{metaRow}</div>}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            {aiSynthesisFailed ? 'AI synthesis failed, see banner above.' : 'No opportunities identified. Try a fresh scrape.'}
          </p>
        )}
      </Section>
    </div>
  )
}

// Business Profile (2026-07-16 rebuild) — structured "what does this
// company actually do" (services/problems solved/ideal customers/industries
// served/target company size/market positioning/technical capabilities/
// business outcomes), see lib/pipeline/business-profile.ts. This is the
// anchor fact Competitors and Target Customer Segments below are grounded
// in, replacing the narrower "What They Offer" list. Same "only render
// when there's something real" discipline as every other additive section
// here.
function BusinessProfileList({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <ul className="mt-1 grid grid-cols-1 gap-x-8 gap-y-1.5 md:grid-cols-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-foreground/90">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{humanizeText(item)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BusinessProfileSection({ profile }: { profile?: CompanyBusinessProfile }) {
  if (!profile) return null
  const hasContent =
    (profile.services?.length ?? 0) > 0 ||
    (profile.problems_solved?.length ?? 0) > 0 ||
    !!profile.ideal_customers ||
    (profile.industries_served?.length ?? 0) > 0 ||
    !!profile.target_company_size ||
    !!profile.market_positioning ||
    (profile.technical_capabilities?.length ?? 0) > 0 ||
    (profile.business_outcomes?.length ?? 0) > 0
  if (!hasContent) return null

  return (
    <Section label="Business Profile" accent="text-signal-strong" icon={Building2}>
      <div className="space-y-3">
        {(profile.ideal_customers || profile.target_company_size || profile.market_positioning) && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {profile.ideal_customers && <>Ideal customers: <span className="text-muted-foreground/90">{profile.ideal_customers}</span>. </>}
            {profile.target_company_size && <>Target size: <span className="text-muted-foreground/90">{profile.target_company_size}</span>. </>}
            {profile.market_positioning && <>Positioning: <span className="text-muted-foreground/90">{profile.market_positioning}</span>.</>}
          </p>
        )}
        <BusinessProfileList label="Services" items={profile.services} />
        <BusinessProfileList label="Problems Solved" items={profile.problems_solved} />
        <BusinessProfileList label="Industries Served" items={profile.industries_served} />
        <BusinessProfileList label="Technical Capabilities" items={profile.technical_capabilities} />
        <BusinessProfileList label="Business Outcomes" items={profile.business_outcomes} />
      </div>
    </Section>
  )
}

// Competitors (Phase 2 item 1) — additive to the locked 5-field schema
// above, same "only render when there's something real" discipline as
// Recent News: an empty/insufficient result shows no section at all
// rather than a "no competitors found" message.
const CATEGORY_LABEL: Record<string, string> = { direct: 'Direct', growing: 'Growing', established: 'Established' }

export function CompetitorsSection({ competitors }: { competitors: CompetitorProfile[] }) {
  if (competitors.length === 0) return null
  return (
    <Section label="Competitors" accent="text-signal-medium" icon={Users}>
      <ul className="space-y-3">
        {competitors.map((c, i) => (
          <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-accent/10 px-3.5 py-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-foreground">{c.name}</span>
              {c.category && CATEGORY_LABEL[c.category] && (
                <span className="ml-2 rounded-md border border-border bg-accent/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {CATEGORY_LABEL[c.category]}
                </span>
              )}
              {c.source === 'ai_knowledge' && (
                <span
                  className="ml-2 rounded-md border border-border bg-accent/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title="Identified from the AI's general knowledge, not a cited web source"
                >
                  AI-assessed
                </span>
              )}
              {c.website && (
                <a
                  href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-[11px] text-primary hover:underline"
                >
                  {c.website}
                </a>
              )}
              {c.why_they_compete && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {humanizeText(c.why_they_compete)}
                </p>
              )}
              {(c.market_position || c.differentiator || c.similarities || c.relative_size) && (
                <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {joinWithDot([
                    c.market_position && <>Position: <span className="normal-case text-muted-foreground/80">{c.market_position}</span></>,
                    c.differentiator && <>Differentiator: <span className="normal-case text-muted-foreground/80">{c.differentiator}</span></>,
                    c.similarities && <>Similarities: <span className="normal-case text-muted-foreground/80">{c.similarities}</span></>,
                    c.relative_size && <>Relative size: <span className="normal-case text-muted-foreground/80">{c.relative_size}</span></>,
                  ])}
                </p>
              )}
              <SourceLinks urls={c.source_urls} />
            </div>
            {c.confidence && (
              <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confidenceClass(c.confidence))}>
                {c.confidence}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// Target Customer Segments (ICP Generator, Phase 2 item 2) — who THIS
// company sells to, not company_fit (that's a separate score of how well
// this company fits Demaze's own ICP). Same "only render when there's
// something real" discipline as Competitors above.
//
// onSelectSegment lets a caller (e.g. the wizard) handle segment selection
// in-page instead of navigating to /admin/company-discovery. When omitted,
// falls back to the original Link-based navigation so existing flat call
// sites (ResearchCard's own composition) are unchanged.
export function TargetSegmentsSection({
  segments,
  companyName,
  onSelectSegment,
}: {
  segments: ICPSegment[]
  companyName: string
  onSelectSegment?: (segmentName: string, excludeCompanyName: string) => void
}) {
  if (segments.length === 0) return null
  return (
    <Section label="Target Customer Segments" accent="text-signal-medium" icon={Target}>
      <ul className="space-y-3">
        {segments.map((s, i) => (
          <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-accent/10 px-3.5 py-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-foreground">{s.name}</span>
              {s.source === 'ai_knowledge' && (
                <span
                  className="ml-2 rounded-md border border-border bg-accent/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title="Identified from the AI's general knowledge, not a cited web source"
                >
                  AI-assessed
                </span>
              )}
              {(s.market_attractiveness || s.priority) && (
                <span className="ml-2 space-x-1">
                  {s.market_attractiveness && (
                    <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize', confidenceClass(s.market_attractiveness))}>
                      Fit: {s.market_attractiveness}
                    </span>
                  )}
                  {s.priority && (
                    <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize', confidenceClass(s.priority))}>
                      Priority: {s.priority}
                    </span>
                  )}
                </span>
              )}
              {s.reason && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {humanizeText(s.reason)}
                </p>
              )}
              {(s.criteria || s.buying_indicators || s.use_cases || (s.example_companies && s.example_companies.length > 0)) && (
                <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {joinWithDot([
                    s.criteria && <>Criteria: <span className="normal-case text-muted-foreground/80">{s.criteria}</span></>,
                    s.buying_indicators && <>Buying signal: <span className="normal-case text-muted-foreground/80">{s.buying_indicators}</span></>,
                    s.use_cases && <>Use case: <span className="normal-case text-muted-foreground/80">{s.use_cases}</span></>,
                    s.example_companies && s.example_companies.length > 0 && <>Example clients: <span className="normal-case text-muted-foreground/80">{s.example_companies.join(', ')}</span></>,
                  ])}
                </p>
              )}
              <SourceLinks urls={s.source_urls} />
              {s.name && (
                onSelectSegment ? (
                  <button
                    type="button"
                    onClick={() => onSelectSegment(s.name!, companyName)}
                    className="mt-1.5 inline-block text-[11px] font-medium text-primary hover:underline"
                  >
                    Find companies in this segment →
                  </button>
                ) : (
                  <Link
                    href={`/admin/company-discovery?segment=${encodeURIComponent(s.name)}&exclude=${encodeURIComponent(companyName)}`}
                    className="mt-1.5 inline-block text-[11px] font-medium text-primary hover:underline"
                  >
                    Find companies in this segment →
                  </Link>
                )
              )}
            </div>
            {s.confidence && (
              <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confidenceClass(s.confidence))}>
                {s.confidence}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// Market Intelligence (Phase 2 item 6) — industry-level trends/growth
// indicators/challenges/shifts for the sector the researched company
// operates in. Pure passthrough (no LLM narration layer, see
// lib/enrichment/market-intelligence.ts header) — each item is rendered
// as-extracted. Same "only render when there's something real" discipline
// as Competitors/Target Customer Segments.
export function MarketIntelligenceSection({ items }: { items: MarketIntelItem[] }) {
  if (items.length === 0) return null
  return (
    <Section label="Market Intelligence" accent="text-signal-medium" icon={TrendingUp}>
      <ul className="space-y-3">
        {items.map((m, i) => {
          const categoryLabel =
            m.category === 'growth_indicator' ? 'Growth Indicator'
            : m.category === 'challenge' ? 'Challenge'
            : m.category === 'shift' ? 'Industry Shift'
            : 'Trend'
          return (
            <li key={i} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-accent/10 px-3.5 py-3 text-sm">
              <div className="min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {categoryLabel}
                </span>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground/90">{m.statement}</p>
                <SourceLinks urls={m.source_urls} />
              </div>
              {m.confidence && (
                <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', confidenceClass(m.confidence))}>
                  {m.confidence}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// Research Quality (Phase 2 item 4) — a per-item confidence audit
// cross-checking whether an item's stated confidence is actually justified
// by its evidence. Informational only, never gates or suppresses anything
// above it. Same "only render when there's something real" discipline as
// Competitors/Target Customer Segments — an audit with zero flags shows no
// section at all.
export function ResearchQualitySection({ quality }: { quality?: ResearchQualityAudit }) {
  if (!quality || (quality.items_flagged ?? 0) === 0) return null
  return (
    <Section label="Research Quality" accent="text-signal-medium" icon={ShieldCheck}>
      <p className="mb-3 text-xs text-muted-foreground">
        {quality.items_flagged} of {quality.items_audited} audited item
        {quality.items_audited !== 1 ? 's' : ''} flagged for review. Informational only, nothing above was
        suppressed or downgraded.
      </p>
      <ul className="space-y-2.5">
        {(quality.flags ?? []).map((f, i) => {
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
                <span className={cn('shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize', severityClass)}>
                  {f.severity}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// Personalization Summary, full width, the payoff.
export function PersonalizationSummarySection({
  openingAngle,
  whatToSell,
  whyNow,
  whyContact,
  likelyProblem,
}: {
  openingAngle: string
  whatToSell: string
  whyNow: string
  // Master Plan Step 10.2 — "why this problem"/"why now" as distinct
  // questions from "what to sell". Sourced from outreach_intelligence
  // (getOutreachIntelligence()'s why_contact/likely_problem), previously
  // only rendered in intelligence-lab/page.tsx's own separate debug-tab
  // section — never in this shared component, which is what batch-upload,
  // run-history, and Auto Flow resume actually use. Optional/additive:
  // absent on any run predating these fields.
  whyContact?: string
  likelyProblem?: string
}) {
  if (!openingAngle && !whatToSell) return null
  return (
    <Card className="border-primary/30 bg-primary/[0.07]">
      <CardContent className="px-6 py-5">
        <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          <MessageSquare className="size-3.5" /> Personalization Summary
        </p>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {openingAngle && (
            <p className="border-l-2 border-primary pl-4 text-[15px] leading-relaxed text-foreground/90 lg:col-span-2">
              &ldquo;{openingAngle}&rdquo;
            </p>
          )}
          <div className="space-y-3 text-xs">
            {whyContact && (
              <div>
                <p className="mb-0.5 font-semibold uppercase tracking-wider text-muted-foreground">Why this company, why now</p>
                <p className="text-foreground/90">{whyContact}</p>
              </div>
            )}
            {likelyProblem && (
              <div>
                <p className="mb-0.5 font-semibold uppercase tracking-wider text-muted-foreground">Why this problem</p>
                <p className="text-foreground/90">{likelyProblem}</p>
              </div>
            )}
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
  )
}

// Why Demaze Should Care — evidence-graded reasons this company is worth
// pursuing (lib/pipeline's why_demaze: signal + a real evidence quote +
// evidence_tier + business_implication + recommended_service, each
// independently confidence-graded). This has existed and been populated
// since the narrative prompt shipped, but was only ever rendered in
// intelligence-lab's debug Inspector tab (MaybeWhyDemaze/WhyDemazeCard) —
// invisible on every SDR-facing surface (Auto Flow, run-history, batch,
// company-discovery) that renders ResearchCard instead. Ported here with
// the same content/fields, restyled to this file's Section/confidenceClass
// conventions instead of page.tsx's ad hoc classes. Older ("v3") runs whose
// why_demaze.reasons are plain strings still render, just without the
// evidence/confidence chips those runs never had.
export function WhyDemazeSection({ whyDemaze }: { whyDemaze?: WhyDemaze }) {
  if (!whyDemaze || !whyDemaze.reasons || whyDemaze.reasons.length === 0) return null
  return (
    <Section label="Why Demaze Should Care" accent="text-signal-strong" icon={Sparkles}>
      <div className="space-y-3">
        {whyDemaze.summary && (
          <p className="text-sm leading-relaxed text-foreground/90">{humanizeText(whyDemaze.summary)}</p>
        )}
        <div className="space-y-2.5">
          {whyDemaze.reasons.map((reason, i) => {
            if (typeof reason === 'string') {
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 text-signal-strong">▸</span>
                  <span className="text-foreground/90">{humanizeText(reason)}</span>
                </div>
              )
            }
            const r = reason as Exclude<WhyDemazeReason, string>
            return (
              <div key={i} className="rounded-lg border border-signal-strong/25 bg-signal-strong/[0.06] px-3.5 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{r.signal}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {r.confidence && (
                      <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize', confidenceClass(r.confidence))}>
                        {r.confidence}
                      </span>
                    )}
                    {r.evidence_tier && (
                      <span className="rounded-md border border-border bg-accent/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {r.evidence_tier}
                      </span>
                    )}
                  </div>
                </div>
                {r.evidence && (
                  <p className="border-l-2 border-border-strong pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                    &ldquo;{r.evidence}&rdquo;
                  </p>
                )}
                {r.business_implication && (
                  <p className="text-xs leading-relaxed text-foreground/90">{humanizeText(r.business_implication)}</p>
                )}
                {r.recommended_service && (
                  <span className="inline-block rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {r.recommended_service}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {whyDemaze.relevant_services && whyDemaze.relevant_services.length > 0 && (
          <div className="border-t border-border pt-2.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">Relevant Demaze Services</p>
            <div className="flex flex-wrap gap-1.5">
              {whyDemaze.relevant_services.map((svc, i) => (
                <span key={i} className="rounded-md border border-signal-strong/30 bg-signal-strong/10 px-2 py-0.5 text-[10px] font-medium text-signal-strong">
                  {svc}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Outreach Draft (2026-07-16) — literal LinkedIn connection note / first
// message / follow-up drafts grounded in a matched Demaze proof point
// (lib/knowledge/demaze-proof-points.ts). Drafting only, a rep reviews and
// sends manually. Same "only render when there's something real" discipline
// as Competitors/Target Customer Segments — no drafts, no section.
export function OutreachDraftSection({
  draft,
  matchedProofPoint,
}: {
  draft?: OutreachDraft
  matchedProofPoint?: ProofPoint
}) {
  if (!draft?.connection_note && !draft?.first_message && !draft?.follow_up) return null

  const messages: Array<{ label: string; text?: string }> = [
    { label: 'Connection note', text: draft.connection_note },
    { label: 'First message (after connect)', text: draft.first_message },
    { label: 'Follow-up', text: draft.follow_up },
  ]

  return (
    <Section label="Outreach Draft" accent="text-primary">
      {matchedProofPoint && (
        <div className="mb-4 rounded-lg border border-border bg-accent/30 px-3 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground/90">{matchedProofPoint.title}</span>
            <span
              className={cn(
                'rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                matchedProofPoint.provenance === 'named_client'
                  ? 'border-signal-strong/40 bg-signal-strong/10 text-signal-strong'
                  : 'border-accent bg-accent text-muted-foreground',
              )}
            >
              {matchedProofPoint.provenance === 'named_client' ? 'Named client' : 'Composite example'}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">{matchedProofPoint.client}</p>
          <p className="mt-1 text-muted-foreground/80">
            {matchedProofPoint.outcomes.map(o => `${o.metric}: ${o.value}${o.window ? ` (${o.window})` : ''}`).join(' · ')}
          </p>
        </div>
      )}
      <ul className="space-y-3">
        {messages.filter(m => m.text).map((m, i) => (
          <li key={i} className="rounded-lg border border-border px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{m.label}</span>
              <CopyButton text={m.text!} />
            </div>
            <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/90">{m.text}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ============================================================
// ResearchCard — flat composer, unchanged output for existing
// call sites (intelligence-lab hero, batch-upload, company-discovery
// expanded row).
// ============================================================

// Pure derivation of every field ResearchCard's sections need, lifted out
// so the wizard steps (components/wizard/steps/*) can compute the same
// data from a RunResult without duplicating this logic — each step just
// calls this once and renders its subset of the returned fields.
export function getResearchCardData(result: RunResult) {
  const a = result.analysisResult as Record<string, unknown> | undefined
  if (!a) return null

  const companyName = str(a.company_name) ?? 'Unknown Company'
  const industry = str(a.industry) ?? ''
  const subIndustry = str(a.sub_industry) ?? ''
  const sizeEstimate = str(a.company_size_estimate) ?? ''
  const headquarters = str(a.headquarters_location) ?? ''
  const summary = humanizeText(a.company_summary)
  const confidence = str(a.confidence_level) ?? 'low'
  const businessModel = humanizeText(a.business_model)

  const recentActivity: string[] = humanizeList(a.recent_activity)

  // extractorResult only exists for live in-session runs; historical runs
  // loaded from run-history only have the normalized analysisResult, which
  // carries its own merged `signals` array (see normalize.ts's mergeSignals).
  const signals = getSignals(a).slice(0, 8) as SignalItem[]
  const signalCount = result.extractorResult?.signals?.length ?? signals.length

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
  const painPointsStructured = getPainPointsStructured(a).slice(0, 6) as PainPointItem[]
  const aiSynthesisFailed = a.ai_synthesis_status === 'failed'
  const aiSynthesisFailureReason = str(a.ai_synthesis_failure_reason)

  const competitors = getCompetitors(a)
  const icpSegments = getICPSegments(a)
  const marketIntel = getMarketIntelligence(a)
  const researchQuality = getResearchQuality(a)
  const companyOfferings = getCompanyOfferings(a)
  const businessProfile = getBusinessProfile(a)
  const whyDemaze = getWhyDemaze(a)
  const companyFit = getCompanyFit(a)
  const automationOpportunity = getAutomationOpportunity(a)
  const whyNowScore = getWhyNow(a)

  const outreachIntel = a.outreach_intelligence as Record<string, unknown> | null
  const openingAngle = humanizeText(str(outreachIntel?.conversation_angle) ?? str(a.outreach_angle) ?? '')
  const whyNow = humanizeText(str(outreachIntel?.why_now) ?? str((a.why_now as Record<string, unknown>)?.explanation) ?? '')
  const whatToSell = humanizeText(str((a.executive_brief as Record<string, unknown>)?.what_to_sell) ?? '')
  const whyContact = humanizeText(str(outreachIntel?.why_contact) ?? '')
  const likelyProblem = humanizeText(str(outreachIntel?.likely_problem) ?? '')

  const outreachDraft = getOutreachDraft(a)
  const matchedProofPoint = outreachDraft?.matched_proof_point_id
    ? DEMAZE_PROOF_POINTS.find(p => p.id === outreachDraft.matched_proof_point_id)
    : undefined

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

  return {
    companyName,
    industry,
    subIndustry,
    summary,
    businessModel,
    confidence,
    signalCount,
    signals,
    // RunResult.cachedAt — real "when this run's scrape was cached" timestamp,
    // used to show "Researched Xh ago" in the header when available.
    lastResearchedAt: result.cachedAt,
    recentActivity,
    painPoints,
    painPointsStructured,
    opportunities,
    aiSynthesisFailed,
    aiSynthesisFailureReason,
    competitors,
    icpSegments,
    marketIntel,
    researchQuality,
    companyOfferings,
    businessProfile,
    whyDemaze,
    companyFit,
    automationOpportunity,
    whyNowScore,
    openingAngle,
    whatToSell,
    whyNow,
    whyContact,
    likelyProblem,
    outreachDraft,
    matchedProofPoint,
    facts,
    briefInput,
    briefExtras,
  }
}

export type ResearchCardData = NonNullable<ReturnType<typeof getResearchCardData>>

// ============================================================
// ResearchCard — flat composer, unchanged output for existing
// call sites (intelligence-lab hero, batch-upload, company-discovery
// expanded row).
// ============================================================

export function ResearchCard({ result }: { result: RunResult }) {
  const data = getResearchCardData(result)
  if (!data)
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

  const {
    companyName, industry, subIndustry, summary, businessModel, confidence, signalCount, signals, lastResearchedAt,
    recentActivity, painPoints, painPointsStructured, opportunities, aiSynthesisFailed, aiSynthesisFailureReason,
    competitors, icpSegments, marketIntel, researchQuality, businessProfile, whyDemaze,
    companyFit, automationOpportunity, whyNowScore, openingAngle, whatToSell, whyNow,
    whyContact, likelyProblem,
    outreachDraft, matchedProofPoint, facts, briefInput, briefExtras,
  } = data

  return (
    <div className="space-y-3">
      <ExportToolbar briefInput={briefInput} briefExtras={briefExtras} />
      <AISynthesisFailureBanner failed={aiSynthesisFailed} reason={aiSynthesisFailureReason} />
      <ResearchHero
        companyName={companyName}
        industry={industry}
        subIndustry={subIndustry}
        summary={summary}
        businessModel={businessModel}
        confidence={confidence}
        signalCount={signalCount}
        painPointsCount={painPoints.length}
        opportunitiesCount={opportunities.length}
        facts={facts}
        lastResearchedAt={lastResearchedAt}
      />
      <FitSummaryRow companyFit={companyFit} automationOpportunity={automationOpportunity} whyNow={whyNowScore} confidence={confidence} />
      <WhyDemazeSection whyDemaze={whyDemaze} />
      <BusinessProfileSection profile={businessProfile} />
      <RecentNewsSection items={recentActivity} />
      <SignalsSection signals={signals} />
      <PainPointsAndOpportunitiesSection
        painPoints={painPoints}
        painPointsStructured={painPointsStructured}
        opportunities={opportunities}
        aiSynthesisFailed={aiSynthesisFailed}
      />
      <CompetitorsSection competitors={competitors} />
      <TargetSegmentsSection segments={icpSegments} companyName={companyName} />
      <MarketIntelligenceSection items={marketIntel} />
      <ResearchQualitySection quality={researchQuality} />
      <PersonalizationSummarySection openingAngle={openingAngle} whatToSell={whatToSell} whyNow={whyNow} whyContact={whyContact} likelyProblem={likelyProblem} />
      <OutreachDraftSection draft={outreachDraft} matchedProofPoint={matchedProofPoint} />
    </div>
  )
}
