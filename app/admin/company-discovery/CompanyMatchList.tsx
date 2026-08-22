'use client'

// ============================================================
// Company Discovery Results — select, research, view report
// ============================================================
// Presentational results list for Company Discovery. Renders whatever
// useCompanyDiscoverySearch's structured search surfaced (real Explee
// firmographic fields — industry, employee count, HQ, founding year,
// revenue) as a Demaze workspace, not a database table, and reuses its
// existing sequential "Research with Demaze" loop unchanged. No vendor
// name or discovery-provider language appears anywhere in this file.
// ============================================================

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { SearchX, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { InfoTooltip } from '@/components/ui/tooltip'
import { EmptyState } from '@/components/ui/empty-state'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { CompanyResearchCard } from './CompanyResearchCard'
import { staggerList, listItem, crossfade } from '@/lib/motion'
import { formatRevenue, countryLabel } from './search-options'
import type { CompanyDiscoverySearch, CompanyStatus, DiscoveredMatch } from './useCompanyDiscoverySearch'

// Client-side only, no backend change — once a discovery run surfaces more
// than this many companies, a text filter appears above the list so the
// user isn't stuck scrolling/scanning a long flat list.
const FILTER_THRESHOLD = 8

type SortKey = 'best_match' | 'size' | 'revenue'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'best_match', label: 'Best match' },
  { value: 'size', label: 'Company size' },
  { value: 'revenue', label: 'Annual revenue' },
]

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function daysAgoLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  return relativeTime.format(-days, 'day')
}

export function CompanyMatchList({ search, onAdjustSearch }: { search: CompanyDiscoverySearch; onAdjustSearch?: () => void }) {
  const {
    companies, selectedCount, doneCount, running, progress, pausedReason, expandedId, setExpandedId,
    toggle, selectAll, selectNone, researchSelected, stopBatch, sufficiency,
    hasMore, loadingMore, loadMore, totalAvailable,
  } = search

  const [filterText, setFilterText] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('best_match')
  const showFilter = companies.length > FILTER_THRESHOLD

  const visibleCompanies = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    const base = q ? companies.filter(c => c.match.name.toLowerCase().includes(q)) : companies
    if (sortKey === 'best_match') return base
    const key = sortKey === 'size' ? 'employeeCount' : 'revenueAnnual'
    return [...base].sort((a, b) => (b.match[key] ?? -1) - (a.match[key] ?? -1))
  }, [companies, filterText, sortKey])

  // Distinguish "haven't searched yet" (sufficiency still null, render
  // nothing) from "searched, zero real matches survived filtering" — the
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-foreground text-sm font-medium">
            {totalAvailable > 0 ? totalAvailable.toLocaleString() : companies.length} compan{(totalAvailable || companies.length) === 1 ? 'y' : 'ies'} found
          </p>
          {totalAvailable > companies.length && (
            <p className="text-muted-foreground/60 text-xs">Showing the best {companies.length} matches</p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20" onClick={stopBatch}>
              Stop after current
            </Button>
          ) : (
            <Button size="sm" onClick={researchSelected} disabled={selectedCount === 0}>
              {selectedCount === 0 ? 'No research action yet' : `Research with Demaze (${selectedCount})`}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectAll}>Select all</Button>
        <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={selectNone}>Select none</Button>
        <span className="text-muted-foreground text-xs">Selected: {selectedCount} · {doneCount} researched</span>

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
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-foreground text-sm font-medium truncate">{match.name}</span>
                    {match.domain && (
                      <span className="text-muted-foreground/70 text-xs truncate">{match.domain}</span>
                    )}
                    {!match.domain && (
                      <Badge className="text-[10px] bg-signal-medium/10 text-signal-medium border border-signal-medium/30 gap-1">
                        No domain on file
                        <InfoTooltip>This company doesn&rsquo;t have a domain on record. It can still be researched by name, but results may be thinner.</InfoTooltip>
                      </Badge>
                    )}
                  </div>

                  {match.industry && <p className="text-muted-foreground/80 text-xs">{match.industry}</p>}

                  <p className="text-muted-foreground/70 text-xs">
                    <CompanyMeta match={match} />
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <StatusBadge status={status} lastResearchedAt={match.lastResearchedAt} />
                  {(status === 'done' || status === 'already_researched') && result && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setExpandedId(expandedId === company.id ? null : company.id)}
                        className="text-muted-foreground hover:text-foreground/90 text-xs px-2 py-1 rounded border border-border hover:border-border transition-colors"
                      >
                        {expandedId === company.id ? 'Hide' : 'View report'}
                      </button>
                      <Link
                        href={`/admin/auto-gtm?url=${encodeURIComponent(match.domain || match.name)}`}
                        className="inline-flex items-center gap-1 text-primary hover:text-primary text-xs px-2 py-1 rounded border border-primary/40 hover:bg-primary/10 transition-colors"
                      >
                        Find decision makers <ArrowRight className="size-3" />
                      </Link>
                    </div>
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

      {hasMore && !filterText && (
        <div className="flex justify-center pt-1">
          <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Spinner /> Loading…</> : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}

function CompanyMeta({ match }: { match: DiscoveredMatch }) {
  const parts: string[] = []
  if (match.employeeCount != null) parts.push(`${match.employeeCount.toLocaleString()} employees`)
  const hq = match.hqCountryCode ? countryLabel(match.hqCountryCode) : match.hqLocation
  if (hq) parts.push(hq)
  if (match.founded != null) parts.push(`Founded ${match.founded}`)
  if (match.revenueAnnual != null) parts.push(`Revenue ${formatRevenue(match.revenueAnnual)}`)
  return <>{parts.join(' · ')}</>
}

// Dot shape, not just color, so status still reads at a glance for anyone
// who can't distinguish the color coding (color alone is not an accessible
// signal).
function Dot({ className }: { className?: string }) {
  return <span className={`inline-block size-1.5 rounded-full ${className}`} />
}

function StatusBadge({ status, lastResearchedAt }: { status: CompanyStatus; lastResearchedAt?: string | null }) {
  const map: Record<CompanyStatus, { label: string; className: string; dot: string }> = {
    not_researched: { label: 'Not researched', className: 'bg-accent text-muted-foreground', dot: 'bg-muted-foreground' },
    already_researched: {
      label: lastResearchedAt ? `Already researched · ${daysAgoLabel(lastResearchedAt)}` : 'Already researched',
      className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30',
      dot: 'bg-signal-strong',
    },
    running: { label: 'Researching…', className: 'bg-primary/10 text-primary border border-primary/40', dot: 'bg-primary' },
    done: { label: 'Research complete', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30', dot: 'bg-signal-strong' },
    failed: { label: 'Research failed', className: 'bg-destructive/10 text-destructive border border-destructive/40', dot: 'bg-destructive' },
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
