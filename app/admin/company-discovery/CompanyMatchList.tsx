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

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Step1Research } from '@/components/wizard/steps/Step1Research'
import type { CompanyMatch } from '@/lib/enrichment/company-discovery'
import type { ICPSegment } from '@/lib/enrichment/icp-generator'
import type { CompanyDiscoverySearch, CompanyStatus } from './useCompanyDiscoverySearch'
import type { DemazeMatch } from './useCompanyDiscoverySearch'

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
    toggle, selectAll, selectNone, researchSelected, stopBatch,
  } = search

  if (companies.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectAll}>Select all</Button>
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectNone}>Select none</Button>
        <span className="text-muted-foreground text-xs">{selectedCount} of {companies.length} selected · {doneCount} done</span>

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

      {progress && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/40 text-xs">
          <span className="text-primary font-medium">Researching {progress.done + 1} of {progress.total}</span>
          <span className="text-muted-foreground truncate">{progress.current}</span>
        </div>
      )}

      {pausedReason && (
        <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2.5 text-xs">
          <p className="text-signal-medium font-medium">⏸ Batch paused</p>
          <p className="text-signal-medium/80 mt-1">{pausedReason}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {companies.map(({ company, match, selected, status, result, errorMessage }) => (
          <div key={company.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-start gap-3 px-3 py-3">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggle(company.id)}
                disabled={running}
                className="accent-primary mt-1"
              />
              <div className="min-w-0 flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-1.5">
                <div className="md:col-span-2 flex items-center gap-2 flex-wrap">
                  <span className="text-foreground text-sm font-medium truncate">{match.name}</span>
                  <ConfidenceBadge confidence={match.confidence} />
                  {!match.domain && (
                    <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30">
                      domain not confirmed
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
                    className="text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border"
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

            {expandedId === company.id && result && (
              <div className="border-t border-border px-4 py-4">
                <Step1Research result={result} />
              </div>
            )}
          </div>
        ))}
      </div>
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

function ConfidenceBadge({ confidence }: { confidence: CompanyMatch['confidence'] }) {
  const map: Record<CompanyMatch['confidence'], string> = {
    high: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
    medium: 'bg-signal-medium/10 text-signal-medium border border-signal-medium/30',
    low: 'bg-accent text-muted-foreground',
  }
  return <Badge className={`text-[10px] ${map[confidence]}`}>{confidence}</Badge>
}

function StatusBadge({ status }: { status: CompanyStatus }) {
  const map: Record<CompanyStatus, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-accent text-muted-foreground' },
    running: { label: 'Researching…', className: 'bg-primary/10 text-primary border border-primary/40' },
    done: { label: 'Done', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' },
    failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border border-destructive/40' },
    skipped: { label: 'Skipped', className: 'bg-accent text-muted-foreground' },
  }
  const { label, className } = map[status]
  return <Badge className={`text-[10px] flex-shrink-0 ${className}`}>{label}</Badge>
}
