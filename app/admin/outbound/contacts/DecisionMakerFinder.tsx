'use client'

// ============================================================
// DecisionMakerFinder — search for candidate decision-makers by title,
// review, and add selected ones as real contacts.
// ============================================================
// Extracted out of contacts/page.tsx so it's reusable by the Auto Flow
// guided-flow page (app/admin/auto-gtm) as well. Fully self-contained —
// takes only the company identity it needs, calls the discovery + contact-
// creation APIs directly, and reports each newly-created contact back to
// the caller via onContactAdded rather than depending on any shared hook.
// ============================================================

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { staggerList, listItem } from '@/lib/motion'
import { DEFAULT_TARGET_TITLES } from '@/lib/outbound/decision-maker-discovery/types'
import type { DecisionMakerCandidate, LeadershipContactInput } from '@/lib/outbound/decision-maker-discovery/types'
import type { OutboundContact } from './useOutboundContacts'

// Placeholder rows shown while a search is in flight, so the layout doesn't
// jump from "nothing" to "content" — same pattern as company-discovery/
// page.tsx's CompanyRowSkeletons.
function CandidateRowSkeletons() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center gap-2.5">
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// Imperative handle so a parent step (Auto Flow) can trigger "add whatever
// is currently checked" itself — e.g. from its own "Continue" button —
// instead of requiring a separate "Add Selected as Contacts" click here.
export interface DecisionMakerFinderHandle {
  commitSelected: () => Promise<void>
}

function confidenceBadgeVariant(confidence: 'high' | 'medium' | 'low') {
  if (confidence === 'high') return 'default' as const
  if (confidence === 'medium') return 'secondary' as const
  return 'outline' as const
}

function groundingBadgeVariant(status: 'confirmed' | 'conflict' | 'not_found') {
  if (status === 'confirmed') return 'default' as const
  if (status === 'conflict') return 'destructive' as const
  return 'outline' as const
}

function groundingLabel(status: 'confirmed' | 'conflict' | 'not_found') {
  if (status === 'confirmed') return 'Confirmed on website'
  if (status === 'conflict') return 'Conflicts with website'
  return 'Not on website'
}

export const DecisionMakerFinder = forwardRef<DecisionMakerFinderHandle, {
  companyName: string
  domain: string
  sourceRunId: string
  onContactAdded: (contact: OutboundContact) => void
  // When true, searches automatically on mount using the default target
  // titles below — no click needed. Used by Auto Flow so decision-maker
  // discovery happens without the user asking for it; the search box stays
  // here so they can still adjust titles and re-run by hand if they want to.
  autoStart?: boolean
  // When true, the target-titles input collapses behind an "Adjust titles"
  // toggle instead of always showing, and the "Add Selected as Contacts"
  // button is hidden — used by the Auto Flow guided flow's Decision Makers
  // step, which wants "search runs automatically, user just selects, and
  // the flow's own Continue button commits the selection" (via the
  // commitSelected imperative handle above) instead of a separate add step.
  // The standalone Contacts page keeps everything always visible (default false).
  compact?: boolean
  // Fires whenever the checked-candidate count changes, so a compact-mode
  // parent (Auto Flow) can enable/disable its own Continue button without
  // duplicating selection state here.
  onSelectionChange?: (count: number) => void
  // Named leadership individuals already extracted from the company's own
  // scraped site (lib/pipeline/evidence-extractor.ts's leadershipContacts).
  // Optional — when provided, every returned candidate is cross-checked
  // against it server side and gets a "Confirmed on website" / "Conflicts
  // with website" / "Not on website" badge (2026-07-18 grounding fix). Auto
  // Flow passes this from the live run's extractorResult; the standalone
  // Contacts page passes it via getLeadershipContacts() on the saved run's
  // final_result (2026-07-19 fix — leadership_contacts is now a real
  // top-level NormalizedAnalysis field, see normalize.ts). Only genuinely
  // omitted for a run saved before that field existed — those still show
  // candidates ungrounded rather than erroring.
  leadershipContacts?: LeadershipContactInput[]
}>(function DecisionMakerFinder({
  companyName,
  domain,
  sourceRunId,
  onContactAdded,
  autoStart = false,
  compact = false,
  onSelectionChange,
  leadershipContacts,
}, ref) {
  const [discovering, setDiscovering] = useState(false)
  const [candidates, setCandidates] = useState<DecisionMakerCandidate[]>([])
  const [candidatesProvider, setCandidatesProvider] = useState<string | null>(null)
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [targetTitlesInput, setTargetTitlesInput] = useState(DEFAULT_TARGET_TITLES.join(', '))
  const [adding, setAdding] = useState(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  const [showTitlesInput, setShowTitlesInput] = useState(!compact)
  // Auto Flow's autoStart previously fired handleDiscover() the instant this
  // component mounted, with zero confirmation — a real cost-incurring search
  // (Decision-Maker Discovery's active provider is a real vendor, Prospeo,
  // per /admin/outbound/integrations, not mock) firing silently on arrival
  // at this step. Gated behind a one-time confirm dialog (2026-07-19 fix) —
  // the manual "Find Decision Makers"/"Search Again" button stays a single
  // click with no extra confirmation, since an explicit click already is
  // the user's consent.
  //
  // Refined (2026-07-19, second pass): the confirm dialog used to fire
  // unconditionally, even while the active provider is the free 'mock' one
  // (the seeded default — see migration 010) — pure friction with no real
  // cost behind it. Now it only asks when the currently-active provider for
  // this capability is a real, non-mock vendor; on mock it searches
  // immediately, same as before this fix existed. If the provider check
  // itself fails (e.g. Supabase unreachable), err toward asking rather than
  // risking a silent paid search.
  const [showAutoStartConfirm, setShowAutoStartConfirm] = useState(false)

  useEffect(() => {
    if (!autoStart || hasAutoStarted) return
    // One-time guard-flag pattern (hasAutoStarted itself prevents re-firing),
    // not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasAutoStarted(true)
    void (async () => {
      let isPaidProvider = true
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (data.success) {
          const row = (data.integrations as Array<{ capability: string; provider_name: string; is_active: boolean }>).find(
            r => r.capability === 'decision_maker_discovery' && r.is_active
          )
          isPaidProvider = Boolean(row && row.provider_name !== 'mock')
        }
      } catch {
        // Leave isPaidProvider=true — ask rather than risk a silent paid search.
      }
      if (isPaidProvider) setShowAutoStartConfirm(true)
      else void handleDiscover()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, hasAutoStarted])

  async function handleDiscover() {
    const titles = targetTitlesInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    setSelectedCandidates(new Set())
    setDiscovering(true)
    try {
      const res = await fetch('/api/admin/outbound/decision-makers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          domain,
          targetTitles: titles.length ? titles : undefined,
          leadershipContacts: leadershipContacts?.length ? leadershipContacts : undefined,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Decision-maker discovery failed')
        return
      }
      const result = data.result as {
        candidates: DecisionMakerCandidate[]
        providerUsed: string
        status: 'found' | 'not_found' | 'error'
        reason?: string
      }
      setCandidates(result.candidates)
      setCandidatesProvider(result.providerUsed)
      // Pre-select everything found — "the user simply selects who they
      // want to contact" reads more naturally as "uncheck who you don't
      // want" than starting from an empty list every search.
      setSelectedCandidates(new Set(result.candidates.map((_, i) => i)))
      if (result.status === 'found') toast.success(`Found ${result.candidates.length} candidate(s)`)
      else toast.warning(result.reason ?? 'No candidates found')
    } catch {
      toast.error('Could not reach the decision-maker discovery API')
    } finally {
      setDiscovering(false)
    }
  }

  function toggleCandidate(index: number) {
    setSelectedCandidates(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  useEffect(() => {
    onSelectionChange?.(selectedCandidates.size)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidates])

  async function handleAddSelected() {
    const toAdd = candidates.filter((_, i) => selectedCandidates.has(i))
    setAdding(true)
    try {
      for (const candidate of toAdd) {
        const res = await fetch('/api/admin/outbound/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_run_id: sourceRunId,
            company_domain: domain,
            company_name: companyName,
            person_name: candidate.personName,
            title_hint: candidate.title,
            linkedin_url: candidate.linkedinUrl,
            discovery_source: 'decision_maker_discovery',
            discovery_confidence: candidate.confidence,
            discovery_provider: candidatesProvider ?? undefined,
          }),
        })
        const data = await res.json()
        if (!data.success) {
          toast.error(data.error ?? `Failed to add ${candidate.personName}`)
          continue
        }
        onContactAdded(data.contact)
        toast.success(`Added ${candidate.personName}`)
      }
    } finally {
      setAdding(false)
      setSelectedCandidates(new Set())
    }
  }

  useImperativeHandle(ref, () => ({ commitSelected: handleAddSelected }))

  return (
    <Card className="border-border bg-card">
      <CardContent className="px-5 py-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Find Decision Makers</h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            {autoStart && showAutoStartConfirm
              ? 'This search uses paid credits, waiting for your confirmation before running it.'
              : autoStart && compact
              ? 'Searching automatically using common titles (CEO, CTO, VP Operations, etc). Found candidates start checked below — uncheck anyone you don’t want, then hit Continue.'
              : autoStart
              ? 'Searching automatically using common titles (CEO, CTO, VP Operations, etc). Found candidates start checked below, uncheck anyone you don’t want, nothing is added until you confirm.'
              : 'Searches for candidate decision-makers by title. Found candidates start checked below, uncheck anyone you don’t want, nothing is added until you confirm.'}
          </p>
        </div>
        {showTitlesInput ? (
          <div className="space-y-1">
            <Label htmlFor="target-titles">Target titles (comma-separated)</Label>
            <Input
              id="target-titles"
              value={targetTitlesInput}
              onChange={e => setTargetTitlesInput(e.target.value)}
              placeholder={DEFAULT_TARGET_TITLES.join(', ')}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowTitlesInput(true)}
            className="text-xs text-muted-foreground/70 underline hover:text-foreground text-left"
          >
            Adjust titles
          </button>
        )}
        <Button size="sm" variant="outline" disabled={discovering} onClick={handleDiscover}>
          {discovering ? <Spinner className="size-3.5" /> : null}
          {autoStart && (candidates.length > 0 || discovering) ? 'Search Again' : 'Find Decision Makers'}
        </Button>

        {discovering && candidates.length === 0 && (
          <div className="pt-2 border-t border-border">
            <CandidateRowSkeletons />
          </div>
        )}

        {candidates.length > 0 && (
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-xs text-muted-foreground/70">
              {candidates.length} candidate{candidates.length === 1 ? '' : 's'} found
            </p>
            <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-2">
              {candidates.map((candidate, i) => (
                <motion.label
                  key={`${candidate.title}-${i}`}
                  variants={listItem}
                  className="flex items-center gap-2.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedCandidates.has(i)}
                    onChange={() => toggleCandidate(i)}
                    className="size-3.5"
                  />
                  <span className="text-foreground">{candidate.personName}</span>
                  <span className="text-xs text-muted-foreground/70">{candidate.title}</span>
                  <Badge variant={confidenceBadgeVariant(candidate.confidence)}>{candidate.confidence}</Badge>
                  {candidate.grounding && (
                    <Badge
                      variant={groundingBadgeVariant(candidate.grounding.status)}
                      title={candidate.grounding.reason}
                    >
                      {groundingLabel(candidate.grounding.status)}
                    </Badge>
                  )}
                </motion.label>
              ))}
            </motion.div>
            {compact ? (
              <p className="text-xs text-muted-foreground/70">
                {selectedCandidates.size} selected — hit Continue above to add {selectedCandidates.size === 1 ? 'them' : 'them all'} and move on.
              </p>
            ) : (
              <Button size="sm" disabled={adding || selectedCandidates.size === 0} onClick={handleAddSelected}>
                {adding ? <Spinner className="size-3.5" /> : null}
                Add Selected as Contacts ({selectedCandidates.size})
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={showAutoStartConfirm}
        onOpenChange={open => { if (!open) setShowAutoStartConfirm(false) }}
        title="Search for decision makers?"
        description="This looks up decision makers for this company using the currently configured provider — which may use paid credits if a real vendor (not the mock) is active in Outbound Integrations. Nothing is added as a contact until you review and select from the results."
        confirmLabel="Search"
        onConfirm={() => { setShowAutoStartConfirm(false); void handleDiscover() }}
      />
    </Card>
  )
})
