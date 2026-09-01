'use client'

// ============================================================
// Company Discovery Results - select, research, view report
// ============================================================
// Presentational results list for Company Discovery. Renders whatever
// useCompanyDiscoverySearch's structured search surfaced (real Explee
// firmographic fields - industry, employee count, HQ, founding year,
// revenue) as a Demaze workspace, not a database table, and reuses its
// existing sequential "Research with Demaze" loop unchanged. No vendor
// name or discovery-provider language appears anywhere in this file.
// ============================================================

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SearchX, Building2, Globe, ExternalLink, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { InfoTooltip } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Avatar } from '@/components/ui/avatar'
import { IntelStatus, type IntelStatusKind } from '@/components/ui/intel-status'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DecisionMakerFinder } from '@/app/admin/outbound/contacts/DecisionMakerFinder'
import { CompanyResearchCard } from './CompanyResearchCard'
import { staggerList, listItem } from '@/lib/motion'
import { formatRevenue, countryLabel } from './search-options'
import type { CompanyDiscoverySearch, CompanyStatus, DiscoveredMatch } from './useCompanyDiscoverySearch'

// Client-side only, no backend change - once a discovery run surfaces more
// than this many companies, a text filter appears above the list so the
// user isn't stuck scrolling/scanning a long flat list.
const FILTER_THRESHOLD = 8

type SortKey = 'best_match' | 'size' | 'revenue'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'best_match', label: 'Best match' },
  { value: 'size', label: 'Company size' },
  { value: 'revenue', label: 'Annual revenue' },
]

type StatusFilter = 'all' | 'unresearched' | 'researched'
const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unresearched', label: 'Unresearched' },
  { value: 'researched', label: 'Researched' },
]
const RESEARCHED_STATUSES: CompanyStatus[] = ['done', 'already_researched']

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function daysAgoLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  return relativeTime.format(-days, 'day')
}

// CompanyStatus (this page's own research-loop state) -> IntelStatusKind
// (the shared status vocabulary) - 'running' has no 1:1 name match, and
// 'already_researched' carries an optional "N days ago" label override.
function toIntelStatus(status: CompanyStatus, lastResearchedAt?: string | null): { status: IntelStatusKind; label?: string } {
  if (status === 'running') return { status: 'researching' }
  if (status === 'done') return { status: 'complete' }
  if (status === 'already_researched') {
    return { status: 'already_researched', label: lastResearchedAt ? `Already researched · ${daysAgoLabel(lastResearchedAt)}` : undefined }
  }
  return { status }
}

export function CompanyMatchList({ search, onAdjustSearch }: { search: CompanyDiscoverySearch; onAdjustSearch?: () => void }) {
  const {
    companies, selectedCount, doneCount, running, progress, pausedReason, expandedId, setExpandedId,
    viewingId, viewStoredResult,
    toggle, selectAll, selectNone, researchSelected, stopBatch, sufficiency,
    hasMore, loadingMore, loadMore, totalAvailable,
  } = search

  const [filterText, setFilterText] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('best_match')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const showFilter = companies.length > FILTER_THRESHOLD

  const researchedCount = useMemo(() => companies.filter(c => RESEARCHED_STATUSES.includes(c.status)).length, [companies])

  const visibleCompanies = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    let base = q ? companies.filter(c => c.match.name.toLowerCase().includes(q)) : companies
    if (statusFilter === 'researched') base = base.filter(c => RESEARCHED_STATUSES.includes(c.status))
    if (statusFilter === 'unresearched') base = base.filter(c => !RESEARCHED_STATUSES.includes(c.status))
    if (sortKey === 'best_match') return base
    const key = sortKey === 'size' ? 'employeeCount' : 'revenueAnnual'
    return [...base].sort((a, b) => (b.match[key] ?? -1) - (a.match[key] ?? -1))
  }, [companies, filterText, sortKey, statusFilter])

  // Distinguish "haven't searched yet" (sufficiency still null, render
  // nothing) from "searched, zero real matches survived filtering" - the
  // latter used to also render nothing, silently discarding real search
  // effort with no feedback at all.
  if (companies.length === 0 && sufficiency === null) return null
  if (companies.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching companies found"
        description="Try widening the company-size range, adding another headquarters region, or removing an advanced filter."
        action={onAdjustSearch && <Button size="sm" variant="outline" onClick={onAdjustSearch}>Adjust search</Button>}
      />
    )
  }

  const totalLabel = totalAvailable > 0 ? totalAvailable.toLocaleString() : companies.length
  const totalCount = totalAvailable || companies.length

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="size-4 text-muted-foreground/60 shrink-0" />
            <p className="text-foreground text-sm min-w-0">
              <span className="font-semibold">{totalLabel}</span> compan{totalCount === 1 ? 'y' : 'ies'} match your search.
              {totalAvailable > companies.length && (
                <span className="block text-muted-foreground/60 text-xs mt-0.5">We selected the {companies.length} strongest matches to research first.</span>
              )}
            </p>
          </div>
          {running ? (
            <Button size="sm" variant="destructive" onClick={stopBatch}>
              Stop after current
            </Button>
          ) : (
            <Button size="sm" onClick={researchSelected} disabled={selectedCount === 0}>
              {selectedCount === 0 ? 'No research action yet' : `Research these ${selectedCount}`}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-t border-border/60">
          <Button size="xs" variant="ghost" onClick={selectAll}>Select all</Button>
          <Button size="xs" variant="ghost" onClick={selectNone}>Select none</Button>
          <span className="text-muted-foreground text-xs">{selectedCount} selected · {doneCount} researched</span>

          {researchedCount > 0 && researchedCount < companies.length && (
            <div className="flex items-center gap-0.5 rounded-md bg-accent/40 p-0.5" role="tablist" aria-label="Filter by research status">
              {STATUS_TABS.map(t => (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={statusFilter === t.value}
                  onClick={() => setStatusFilter(t.value)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                    statusFilter === t.value ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  {t.value === 'researched' && ` (${researchedCount})`}
                  {t.value === 'unresearched' && ` (${companies.length - researchedCount})`}
                </button>
              ))}
            </div>
          )}

          {showFilter && (
            <Input
              aria-label="Filter companies by name"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by name…"
              className="h-7 max-w-[180px] bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-xs"
            />
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-muted-foreground/60 text-xs">Sort:</span>
            <Select items={SORT_OPTIONS} value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-7 w-auto min-w-[9rem] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
                status === 'running'
                  ? 'border-primary/50'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${match.name}`}
                  checked={selected}
                  onChange={() => toggle(company.id)}
                  disabled={running}
                  className="accent-primary mt-1.5"
                />
                <Avatar name={match.name} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-foreground text-sm font-semibold truncate">{match.name}</span>
                    {match.domain && (
                      <span className="text-muted-foreground/60 text-xs truncate">{match.domain}</span>
                    )}
                    {!match.domain && (
                      <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30 gap-1">
                        No domain on file
                        <InfoTooltip>This company doesn&rsquo;t have a domain on record. It can still be researched by name, but results may be thinner.</InfoTooltip>
                      </Badge>
                    )}
                  </div>

                  <p className="text-muted-foreground/70 text-xs">
                    <CompanyMeta match={match} />
                  </p>
                </div>

                <div className="flex flex-row flex-wrap items-center justify-end gap-1.5 pl-8 sm:flex-col sm:items-end sm:pl-0 sm:flex-shrink-0">
                  <IntelStatus {...toIntelStatus(status, match.lastResearchedAt)} />
                  {status === 'done' && result && (result.signals.length > 0 || result.opportunities.length > 0) && (
                    <p className="text-muted-foreground/60 text-[11px] whitespace-nowrap">
                      {result.signals.length} signal{result.signals.length === 1 ? '' : 's'} · {result.opportunities.length} opportunit{result.opportunities.length === 1 ? 'y' : 'ies'}
                    </p>
                  )}
                  <button
                    onClick={async () => {
                      const next = expandedId === company.id ? null : company.id
                      setExpandedId(next)
                      // Result exists (a prior visit to this page researched
                      // this company) but hasn't been fetched into state yet -
                      // see useCompanyDiscoverySearch.ts's viewStoredResult().
                      if (next && !result && status === 'already_researched' && match.hasStoredResult) {
                        await viewStoredResult(company.id)
                      }
                    }}
                    disabled={viewingId === company.id}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border-strong transition-colors disabled:opacity-60"
                  >
                    {viewingId === company.id ? (
                      <Spinner className="size-3" />
                    ) : (
                      <>
                        {expandedId === company.id ? 'Hide details' : 'Details'}
                        <ChevronRight className={`size-3 transition-transform ${expandedId === company.id ? 'rotate-90' : ''}`} />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {status === 'failed' && errorMessage && (
                <div className="px-4 pb-2 -mt-1">
                  <p className="text-destructive text-xs">{errorMessage}</p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {expandedId === company.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden border-t border-border bg-background/30"
                  >
                    <div className="px-4 py-4 space-y-4">
                      <CompanyQuickFacts match={match} />
                      {/* Search runs only when the user clicks "Find People"
                          inside this component - never automatically, and
                          never for every row at once (real per-lookup cost). */}
                      <DecisionMakerFinder
                        companyName={match.name}
                        domain={match.domain || ''}
                        sourceRunId={company.id}
                        onContactAdded={() => {}}
                      />
                      {result && (
                        <CompanyResearchCard
                          result={result}
                          firmographics={{
                            industry: match.industry,
                            employeeCount: match.employeeCount,
                            hqLocation: match.hqLocation,
                            founded: match.founded,
                            revenueAnnual: match.revenueAnnual,
                          }}
                        />
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      {visibleCompanies.length === 0 && (filterText || statusFilter !== 'all') && (
        <p className="text-muted-foreground/70 text-xs px-1">
          {filterText ? `No companies match "${filterText}".` : `No ${statusFilter} companies.`}
        </p>
      )}

      {hasMore && !filterText && (
        <div className="flex justify-center pt-1">
          <Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Spinner /> Loading…</> : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

// Description/funding stage/website/LinkedIn - already returned by the same
// Explee company-search call that supplied everything else in the row
// (see useCompanyDiscoverySearch.ts's DiscoveredMatch), just never surfaced
// before. No network call here, no additional cost.
function CompanyQuickFacts({ match }: { match: DiscoveredMatch }) {
  const hasLinks = match.websiteUrl || match.linkedinUrl
  if (!match.description && !match.fundingStage && !hasLinks) return null
  return (
    <div className="space-y-2">
      {match.description && <p className="text-sm text-foreground/90">{match.description}</p>}
      {(match.fundingStage || hasLinks) && (
        <div className="flex flex-wrap items-center gap-2">
          {match.fundingStage && <Badge variant="secondary" className="text-[10px]">{match.fundingStage}</Badge>}
          {match.websiteUrl && (
            <a
              href={match.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
            >
              <Globe className="size-3" /> Website
            </a>
          )}
          {match.linkedinUrl && (
            <a
              href={match.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
            >
              <ExternalLink className="size-3" /> LinkedIn
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function CompanyMeta({ match }: { match: DiscoveredMatch }) {
  const parts: string[] = []
  if (match.industry) parts.push(match.industry)
  if (match.employeeCount != null) parts.push(`${match.employeeCount.toLocaleString()} employees`)
  const hq = match.hqCountryCode ? countryLabel(match.hqCountryCode) : match.hqLocation
  if (hq) parts.push(hq)
  if (match.founded != null) parts.push(`Founded ${match.founded}`)
  if (match.revenueAnnual != null) parts.push(`Revenue ${formatRevenue(match.revenueAnnual)}`)
  if (parts.length === 0) return <>No firmographic data on file.</>
  return <>{parts.join(' · ')}</>
}
