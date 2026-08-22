'use client'

// ============================================================
// Company Discovery — /admin/company-discovery
// ============================================================
// Redesigned as a professional, self-contained Demaze feature: pick an
// industry + HQ location + employee range, find matching companies, then
// research any of them with Demaze's own intelligence pipeline
// (CompanyMatchList -> researchSelected(), unchanged).
//
// Explee is the only company-discovery data source behind this page (see
// useCompanyDiscoverySearch.ts / lib/enrichment/sources/explee-client.ts)
// and is deliberately never named here — no vendor terminology, API-key
// controls, or raw query fields are exposed. The architecture stays:
//   Demaze UI -> structured company-data search -> company results -> Demaze research
// ============================================================

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, MapPin, Users, Filter, HelpCircle, Search, Clock, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { GuideNote } from '@/components/ui/guide-note'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { fadeSlideUp } from '@/lib/motion'
import { useCompanyDiscoverySearch } from './useCompanyDiscoverySearch'
import { CompanyMatchList } from './CompanyMatchList'
import { SECTOR_OPTIONS, EMPLOYEE_RANGES, COUNTRY_OPTIONS, type SectorOption } from './search-options'

const RECENT_SEARCHES_KEY = 'demaze_company_discovery_recent_searches'
const MAX_RECENT_SEARCHES = 5

interface RecentSearchEntry {
  sector: SectorOption
  countries: string[]
  employeeRangeLabel: string | null
  resultCount: number
  searchedAt: string
}

function loadRecentSearches(): RecentSearchEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function CompanyRowSkeletons() {
  return (
    <div className="space-y-1.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-lg border border-border bg-card px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function CompanyDiscoveryInner() {
  const searchParams = useSearchParams()
  const search = useCompanyDiscoverySearch()
  const { searching, searchError, sufficiency, discoveryReason } = search

  const [sector, setSector] = useState<SectorOption | ''>('')
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set())
  const [employeeRangeKey, setEmployeeRangeKey] = useState('')
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([])

  const searchCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setRecentSearches(loadRecentSearches())
  }, [])

  function scrollToSearch() {
    searchCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleCountry(code: string) {
    setSelectedCountries(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function recordRecentSearch(entry: RecentSearchEntry) {
    setRecentSearches(prev => {
      const next = [entry, ...prev].slice(0, MAX_RECENT_SEARCHES)
      try { window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)) } catch { /* best-effort only */ }
      return next
    })
  }

  async function runSearch() {
    if (!sector) {
      search.setSearchError('Select an industry to search.')
      return
    }
    const range = EMPLOYEE_RANGES.find(r => r.key === employeeRangeKey)
    const count = await search.handleSearch({
      sector,
      countries: Array.from(selectedCountries),
      employeeRangeKey: employeeRangeKey || undefined,
      excludeKeywords: excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
    })
    if (count >= 0) {
      recordRecentSearch({
        sector,
        countries: Array.from(selectedCountries),
        employeeRangeLabel: range?.label ?? null,
        resultCount: count,
        searchedAt: new Date().toISOString(),
      })
    }
  }

  async function applyRecentSearch(entry: RecentSearchEntry) {
    setSector(entry.sector)
    setSelectedCountries(new Set(entry.countries))
    const range = EMPLOYEE_RANGES.find(r => r.label === entry.employeeRangeLabel)
    setEmployeeRangeKey(range?.key ?? '')
    scrollToSearch()
    const count = await search.handleSearch({
      sector: entry.sector,
      countries: entry.countries,
      employeeRangeKey: range?.key,
    })
    if (count >= 0) {
      recordRecentSearch({ ...entry, resultCount: count, searchedAt: new Date().toISOString() })
    }
  }

  // ── Arrive-via-link autosearch ───────────────────────────────
  // From a report's "Find companies in this segment →" link
  // (?segment=...&exclude=...). Runs once; bypasses the industry select
  // with the segment's own free-text description.
  const autoSearchedRef = useRef(false)
  useEffect(() => {
    if (autoSearchedRef.current) return
    const segment = searchParams.get('segment')
    if (!segment) return
    autoSearchedRef.current = true
    search.handleSearch({ definitionOverride: segment, excludeCompanyName: searchParams.get('exclude') ?? undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-3">
        <p className="text-muted-foreground/60 text-xs">Demaze <span className="mx-1">›</span> Discover</p>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Company Discovery</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-lg">
              Find companies that match your ideal customer profile.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" className="border-border bg-card text-foreground/90 hover:bg-accent" onClick={() => setShowHowItWorks(v => !v)}>
              <HelpCircle className="size-3.5" /> How it works
            </Button>
            <Button size="sm" onClick={scrollToSearch}>
              <Search className="size-3.5" /> Discover Companies
            </Button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showHowItWorks && (
          <motion.div variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit">
            <GuideNote>
              <p><strong>1. Choose an industry</strong> — Manufacturing, Automotive, or E-commerce.</p>
              <p><strong>2. Narrow by location and size</strong> — headquarters country and employee count, both optional.</p>
              <p><strong>3. Find companies</strong> — matched against your criteria.</p>
              <p><strong>4. Research the ones you want</strong> — select any result to run Demaze&rsquo;s full research pipeline on it.</p>
            </GuideNote>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={searchCardRef}>
        <Card className="bg-card border-border">
          <CardContent className="px-5 py-5 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Search Criteria</h2>
              <p className="text-muted-foreground/70 text-xs mt-0.5">Define the companies you want to target.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sector-select" className="gap-1.5">
                  <Building2 className="size-3.5 text-muted-foreground" /> Industry / Sector
                </Label>
                <Select
                  items={SECTOR_OPTIONS.map(s => ({ value: s, label: s }))}
                  value={sector}
                  onValueChange={(v) => setSector(v as SectorOption)}
                >
                  <SelectTrigger id="sector-select">
                    <SelectValue placeholder="Select an industry" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECTOR_OPTIONS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="employee-range-select" className="gap-1.5">
                  <Users className="size-3.5 text-muted-foreground" /> Employee Range <span className="text-muted-foreground/60 font-normal">(optional)</span>
                </Label>
                <Select
                  items={EMPLOYEE_RANGES.map(r => ({ value: r.key, label: r.label }))}
                  value={employeeRangeKey}
                  onValueChange={(v) => setEmployeeRangeKey(v as string)}
                >
                  <SelectTrigger id="employee-range-select">
                    <SelectValue placeholder="Any size" />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYEE_RANGES.map(r => (
                      <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 md:col-span-3">
                <Label className="gap-1.5">
                  <MapPin className="size-3.5 text-muted-foreground" /> HQ Location <span className="text-muted-foreground/60 font-normal">(optional)</span>
                </Label>
                <p className="text-muted-foreground/50 text-[11px]">Headquarters country — not sales or customer regions.</p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {COUNTRY_OPTIONS.map(c => {
                    const isSelected = selectedCountries.has(c.code)
                    return (
                      <motion.button
                        key={c.code}
                        type="button"
                        onClick={() => toggleCountry(c.code)}
                        whileTap={{ scale: 0.94 }}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'border-primary/50 bg-primary/15 text-primary'
                            : 'border-border bg-transparent text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {isSelected ? '✓ ' : ''}{c.label}
                      </motion.button>
                    )
                  })}
                </div>
              </div>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground/70 hover:text-foreground/80 flex items-center gap-1.5 w-fit">
                <Filter className="size-3.5" /> Advanced filters
              </summary>
              <div className="mt-3 space-y-1.5 max-w-md">
                <Label htmlFor="exclude-keywords">Exclude Keywords <span className="text-muted-foreground/60 font-normal">(optional)</span></Label>
                <Input
                  id="exclude-keywords"
                  value={excludeKeywords}
                  onChange={(e) => setExcludeKeywords(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !searching) runSearch() }}
                  placeholder="e.g. academy, jobs, careers"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground/60 text-sm"
                />
              </div>
            </details>

            <div className="flex items-center gap-3 flex-wrap pt-1">
              <Button onClick={runSearch} disabled={searching || !sector}>
                {searching ? <><Spinner /> Searching…</> : <><Search className="size-3.5" /> Find Companies</>}
              </Button>
              {!sector && <span className="text-muted-foreground/50 text-xs">Select an industry to get started.</span>}
            </div>

            <AnimatePresence mode="wait">
              {searchError && (
                <motion.div key="search-error" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                  <p className="text-destructive">{searchError}</p>
                </motion.div>
              )}
              {sufficiency === 'sufficient' && discoveryReason && (
                <motion.p key="sufficient-reason" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="text-muted-foreground/70 text-xs">
                  {discoveryReason}
                </motion.p>
              )}
              {sufficiency === 'insufficient' && !searchError && (
                <motion.div key="insufficient" variants={fadeSlideUp} initial="hidden" animate="visible" exit="exit" className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs">
                  <p className="text-signal-medium">{discoveryReason}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>

      <p className="text-muted-foreground/50 text-xs px-1">
        Powered by our company data infrastructure — structured company data is used to find companies matching your criteria.
      </p>

      {recentSearches.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground/80 flex items-center gap-1.5">
            <Clock className="size-3.5" /> Recent Searches
          </h3>
          <div className="space-y-1.5">
            {recentSearches.map((entry, i) => (
              <button
                key={i}
                onClick={() => applyRecentSearch(entry)}
                disabled={searching}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:bg-accent transition-colors disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-foreground text-xs font-medium truncate">
                    {entry.sector}
                    {entry.countries.length > 0 && ` · ${entry.countries.join(', ')}`}
                    {entry.employeeRangeLabel && ` · ${entry.employeeRangeLabel}`}
                  </p>
                  <p className="text-muted-foreground/60 text-[11px] mt-0.5">
                    {entry.resultCount} compan{entry.resultCount === 1 ? 'y' : 'ies'} found · {new Date(entry.searchedAt).toLocaleString()}
                  </p>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground/50 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {searching && <CompanyRowSkeletons />}

      <CompanyMatchList search={search} />
    </div>
  )
}

export default function CompanyDiscoveryPage() {
  return (
    <Suspense fallback={null}>
      <CompanyDiscoveryInner />
    </Suspense>
  )
}
