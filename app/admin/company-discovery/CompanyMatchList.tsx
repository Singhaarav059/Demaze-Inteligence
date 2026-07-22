'use client'

// ============================================================
// Company Match List — presentational (Step 4/5 of the Discover workflow)
// ============================================================
// The select/status/expand-to-report list, shared by the standalone
// /admin/company-discovery page and (until the parallel wizard-cleanup
// session removes that call site) the wizard's Step4Discovery. Takes a
// CompanyDiscoverySearch (from useCompanyDiscoverySearch) plus the handful
// of props that differ by caller (selectAll/selectNone are page-only
// conveniences some callers may omit; demazeSegments is optional context
// for the "Service Fit" column, only meaningful on the Discover page).
//
// Column mapping (2026-07-16, 5-step Discover workflow spec) — honest,
// not fabricated:
//   Company Name / Website     -> match.name / match.domain (real)
//   Industry                   -> match.segments (real — the ICP segment(s)
//                                  this company surfaced under, whether from
//                                  the multi-sector Demaze-lead aggregate
//                                  path or the manual single-segment search,
//                                  which now tags its own results the same way)
//   Why Matched                -> match.reason (real, existing field)
//   Service Fit                -> looked up from the matched segment's own
//                                  ICPSegment.use_cases/reason (Demaze's own
//                                  real, previously-generated segment
//                                  narration) via demazeSegments, when the
//                                  segment name matches one of Demaze's own
//                                  cached ICP segments. Falls back to an
//                                  honest "not available" note otherwise —
//                                  no invented text.
//   Opportunity Summary        -> genuinely has no real data source at this
//                                  stage. Per-company opportunities only
//                                  exist after that specific company runs
//                                  through the research pipeline (Step 5).
//                                  Shown as an explicit "available after
//                                  research" placeholder, never fabricated.
// ============================================================

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { InfoTooltip } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Step1Research } from '@/components/wizard/steps/Step1Research'
import { staggerList, listItem, crossfade } from '@/lib/motion'
import type { CompanyMatch } from '@/lib/enrichment/company-discovery'
import type { ICPSegment } from '@/lib/enrichment/icp-generator'
import type { CompanyDiscoverySearch, CompanyStatus } from './useCompanyDiscoverySearch'
import type { DemazeMatch } from './useCompanyDiscoverySearch'

// Client-side only, no backend change — once a discovery run surfaces more
// than this many companies, a text filter appears above the list so the
// user isn't stuck scrolling/scanning a long flat list.
const FILTER_THRESHOLD = 8

function serviceFitFor(match: DemazeMatch, demazeSegments: ICPSegment[]): string {
  const segNames = match.segments ?? []
  if (segNames.length === 0) return 'Not available — no Demaze ICP segment tagged for this lead.'

  const texts = segNames
    .map(name => demazeSegments.find(s => s.name.toLowerCase() === name.toLowerCase()))
    .filter((s): s is ICPSegment => !!s)
    .map(s => s.use_cases || s.reason)
    .filter(Boolean)

  if (texts.length === 0) {
    return `Matches Demaze's "${segNames.join(', ')}" segment — fit detail not available (not one of Demaze's own cached ICP segments).`
  }
  return texts.join(' | ')
}

export function CompanyMatchList({
  search,
  demazeSegments = [],
}: {
  search: CompanyDiscoverySearch
  demazeSegments?: ICPSegment[]
}) {
  const {
    companies, selectedCount, doneCount, running, progress, pausedReason, expandedId, setExpandedId,
    toggle, selectAll, selectNone, researchSelected, stopBatch, sufficiency,
  } = search

  const [filterText, setFilterText] = useState('')
  const showFilter = companies.length > FILTER_THRESHOLD
  const visibleCompanies = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(c => c.match.name.toLowerCase().includes(q))
  }, [companies, filterText])

  // Distinguish "haven't searched yet" (sufficiency still null, render
  // nothing) from "searched, zero real matches survived filtering" — the
  // latter used to also render nothing, silently discarding real API-quota-
  // spending search effort with no feedback at all.
  if (companies.length === 0 && sufficiency === null) return null
  if (companies.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No companies matched"
        description="Nothing survived filtering for this segment. Try a broader or differently-worded description."
      />
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectAll}>Select all</Button>
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectNone}>Select none</Button>
        <span className="text-muted-foreground text-xs">{selectedCount} of {companies.length} selected · {doneCount} done</span>

        {showFilter && (
          <Input
            aria-label="Filter companies by name"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter by name…"
            className="h-7 max-w-[180px] bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-xs"
          />
        )}

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20" onClick={stopBatch}>
              Stop after current
            </Button>
          ) : (
            <Button size="sm" onClick={researchSelected} disabled={selectedCount === 0}>
              Research Selected ({selectedCount})
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {progress && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/40 text-xs">
              <span className="relative flex size-2 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="text-primary font-medium">Researching {progress.done + 1} of {progress.total}</span>
              <span className="text-muted-foreground truncate">{progress.current}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pausedReason && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2.5 text-xs"
          >
            <p className="text-signal-medium font-medium">⏸ Batch paused</p>
            <p className="text-signal-medium/80 mt-1">{pausedReason}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
        <AnimatePresence>
          {visibleCompanies.map(({ company, match, selected, status, result, errorMessage }) => (
            <motion.div
              key={company.id}
              layout
              variants={listItem}
              exit="exit"
              className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                status === 'running' ? 'border-primary/50 shadow-[0_0_0_1px_var(--color-primary)]/10' : 'border-border'
              }`}
            >
              <div className="flex items-start gap-3 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${match.name}`}
                  checked={selected}
                  onChange={() => toggle(company.id)}
                  disabled={running}
                  className="accent-primary mt-1"
                />
                <div className="min-w-0 flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1.5">
                  <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
                    <span className="text-foreground text-sm font-medium truncate">{match.name}</span>
                    <ConfidenceBadge confidence={match.confidence} />
                    <ConfidenceTierTooltip />
                    {!match.domain && (
                      <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30 gap-1">
                        domain not confirmed
                        <InfoTooltip>We couldn&rsquo;t confidently resolve a website for this company. It will still be researched by name only, but results may be thinner.</InfoTooltip>
                      </Badge>
                    )}
                  </div>

                  <Field label="Website" value={match.domain ?? 'not resolved — will research by name only'} />
                  <Field
                    label="Industry"
                    value={match.segments && match.segments.length > 0 ? undefined : '—'}
                  >
                    {match.segments && match.segments.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {match.segments.map(seg => (
                          <Badge key={seg} className="text-[10px] bg-primary/10 text-primary border border-primary/30">{seg}</Badge>
                        ))}
                      </div>
                    )}
                  </Field>
                  <Field label="Why Matched" value={match.reason} className="md:col-span-2" />
                  <Field label="Service Fit" value={serviceFitFor(match, demazeSegments)} className="md:col-span-2" />
                  <Field
                    label="Opportunity Summary"
                    value="Not available yet — run Research (Step 5) on this lead to generate real pain points/opportunities."
                    muted
                    className="md:col-span-2"
                  />
                </div>

                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <StatusBadge status={status} />
                  {status === 'done' && (
                    <button
                      onClick={() => setExpandedId(expandedId === company.id ? null : company.id)}
                      className="text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border transition-colors"
                    >
                      {expandedId === company.id ? 'Hide' : 'View'}
                    </button>
                  )}
                </div>
              </div>

              {status === 'failed' && errorMessage && (
                <div className="px-3 pb-2 -mt-1">
                  <p className="text-destructive text-xs">{errorMessage}</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {expandedId === company.id && result && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden border-t border-border"
                  >
                    <div className="px-4 py-4">
                      <Step1Research result={result} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {showFilter && visibleCompanies.length === 0 && (
        <p className="text-muted-foreground/70 text-xs px-1">No companies match &ldquo;{filterText}&rdquo;.</p>
      )}
    </>
  )
}

function Field({
  label,
  value,
  muted,
  className,
  children,
}: {
  label: string
  value?: string
  muted?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={className}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</p>
      {children ?? (
        <p className={`text-xs mt-0.5 ${muted ? 'text-muted-foreground/60 italic' : 'text-foreground/90'}`}>{value}</p>
      )}
    </div>
  )
}

// Dot shape, not just color, so confidence/status still reads at a glance
// for anyone who can't distinguish the color coding (color alone is not an
// accessible signal).
function Dot({ className }: { className?: string }) {
  return <span className={`inline-block size-1.5 rounded-full ${className}`} />
}

function ConfidenceBadge({ confidence }: { confidence: CompanyMatch['confidence'] }) {
  const map: Record<CompanyMatch['confidence'], { className: string; dot: string }> = {
    high: { className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30', dot: 'bg-signal-strong' },
    medium: { className: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30', dot: 'bg-signal-medium' },
    low: { className: 'bg-accent text-muted-foreground', dot: 'bg-muted-foreground' },
  }
  const { className, dot } = map[confidence]
  return (
    <Badge className={`text-[10px] gap-1 ${className}`}>
      <Dot className={dot} />
      {confidence}
    </Badge>
  )
}

function ConfidenceTierTooltip() {
  return (
    <InfoTooltip>
      Confidence reflects how strongly this candidate was surfaced: high = named in 2+ independent search results, medium = 1 result, low = weakly matched or an unresolved domain.
    </InfoTooltip>
  )
}

function StatusBadge({ status }: { status: CompanyStatus }) {
  const map: Record<CompanyStatus, { label: string; className: string; dot: string }> = {
    pending: { label: 'Pending', className: 'bg-accent text-muted-foreground', dot: 'bg-muted-foreground' },
    running: { label: 'Researching…', className: 'bg-primary/10 text-primary border border-primary/40', dot: 'bg-primary' },
    done: { label: 'Done', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30', dot: 'bg-signal-strong' },
    failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border border-destructive/40', dot: 'bg-destructive' },
    skipped: { label: 'Skipped', className: 'bg-accent text-muted-foreground', dot: 'bg-muted-foreground' },
  }
  const { label, className, dot } = map[status]
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={status} variants={crossfade} initial="hidden" animate="visible" exit="exit">
        <Badge className={`text-[10px] flex-shrink-0 gap-1 ${className}`}>
          {status === 'running' ? (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
          ) : (
            <Dot className={dot} />
          )}
          {label}
        </Badge>
      </motion.div>
    </AnimatePresence>
  )
}
