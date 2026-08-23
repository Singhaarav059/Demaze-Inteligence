'use client'

// ============================================================
// Auto Flow — /admin/auto-gtm
// ============================================================
// One continuous inline flow, 4 Explee-style stages: Research (single URL
// or Excel/CSV batch upload) -> Decision Makers (found automatically, user
// just selects who to keep) -> Contact Information (email/phone/LinkedIn
// looked up automatically, results only) -> Outreach & Send (subject/email/
// follow-ups drafted automatically, edit or switch subject, then send from
// the same screen — drafting and sending used to be two separate steps,
// merged into one per 2026-07-31 user request). Every step reuses an
// already-built, already-tested component/route — step 1's
// AutoFlowResearchSummary (this folder) is a deliberately narrower reuse of
// ResearchCard's own exported building blocks (intelligence-lab), not the
// full research report — see that file's own header for why. Also reused:
// DecisionMakerFinder (outbound/contacts), ContactInfoStep/OutreachStep
// (this folder), lib/batch/*
// (file-parser/company-dedup/quota-pause, same as Wizard's batch mode),
// the campaigns API (used under the hood by Outreach & Send's buttons —
// framed to the user as "send emails," never "campaign", that language
// tested as confusing). This page's job is purely orchestration: holding
// state across steps instead of losing it at a page-navigation boundary,
// the way the existing separate pages do today. Added alongside those
// pages, not replacing them — they stay as manual/debug/bulk tools.
//
// Each step collapses to a one-line "done" summary once you move past it —
// clicking that summary (or its pill in the StepIndicator up top) jumps
// back and re-expands it, without leaving this page or losing anything
// already done in a later step. Only the active step shows its full
// working UI at any one time.
//
// Decision-maker discovery runs automatically inside the Decision Makers
// step (DecisionMakerFinder's autoStart + compact props) using default
// target titles, with everything found pre-selected — the user just
// unchecks who they don't want, then continues.
//
// Batch mode auto-advances through decision-maker discovery too (research
// -> auto-find decision makers -> auto-add every candidate found), one
// company at a time — same "sequential by design" quota discipline as
// Wizard's researchSelected(). Since that already happens during the
// Research step's batch loop, batch mode's Decision Makers step is just a
// summary of what was found (no per-candidate selection UI) — the review
// checkpoint for batch is Contact Information onward, same as single-
// company mode from there.
//
// AUTO-PILOT (2026-08-13): the whole chain from Research through Campaign &
// Outreach now also advances itself with zero manual "Continue" clicks —
// see the "Auto-pilot" block further down (declared near the top of the
// component, wired up right after `emailsFoundCount`). Review & Send
// (step 5) is the one deliberate stop: sending a real email always needs an
// explicit click, so auto-pilot lands there and waits. The manual Continue
// buttons (`nextAction`) are kept as a fallback/override, not removed.
//
// A "Sales Strategy" step briefly sat between Research and Decision Makers
// (2026-08-13 through the same week) — removed per a corrected product
// direction: Auto Flow stays a narrow, practical outbound workflow, and
// does not encode Demaze's sales positioning/targeting rules until an
// approved sector playbook exists. The Sales Knowledge/Sales Intelligence
// backend this step used (lib/sales-knowledge/*, the sales-intelligence API
// routes, the /admin/outbound/sales-knowledge admin page) still exists for
// that future work, it's just not wired into this flow. See CLAUDE.md's
// Sales Intelligence section for the full history.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Workflow, Building2, Radar, ArrowRight, Lightbulb, Users, Mail } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { InfoTooltip } from '@/components/ui/tooltip'
import { StageProgress, type ProgressStage } from '@/components/ui/stage-progress'
import { MetricTile } from '@/components/ui/metric-tile'
import { useSlashFocus } from '@/lib/hooks/useSlashFocus'
import { cn } from '@/lib/utils'
import { fadeSlideUp, staggerList, listItem } from '@/lib/motion'
import { getResearchCardData } from '@/app/admin/intelligence-lab/ResearchCard'
import { AutoFlowResearchSummary } from './AutoFlowResearchSummary'
import { DecisionMakerFinder, type DecisionMakerFinderHandle } from '@/app/admin/outbound/contacts/DecisionMakerFinder'
import { StepIndicator, STEPS, type StepMeta } from './StepIndicator'
import { ContactInfoStep } from './ContactInfoStep'
import { OutreachStep } from './OutreachStep'
import { ReviewSendStep } from './ReviewSendStep'
import { TrackFollowUpStep } from './TrackFollowUpStep'
import { CompanyPipelineList } from './CompanyPipelineList'
import { useAutoGtmFlow, type BatchCompanyStatus } from './useAutoGtmFlow'

// Hedged as "likely current activity", not measured fact — there's no
// streaming signal from the research call to confirm any of this, see
// stage-progress.tsx's header comment.
const RESEARCH_STAGES: ProgressStage[] = [
  { label: 'Fetching site…', afterMs: 0 },
  { label: 'Analyzing content…', afterMs: 15_000 },
  { label: 'Finalizing…', afterMs: 40_000 },
]

function BatchStatusBadge({ status }: { status: BatchCompanyStatus }) {
  const map: Record<BatchCompanyStatus, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-accent text-muted-foreground' },
    researching: { label: 'Researching…', className: 'bg-primary/10 text-primary border border-primary/40' },
    discovering: { label: 'Finding decision makers…', className: 'bg-primary/10 text-primary border border-primary/40' },
    done: { label: 'Done', className: 'bg-signal-strong/10 text-signal-strong border border-signal-strong/30' },
    failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive border border-destructive/40' },
  }
  const { label, className } = map[status]
  return <Badge className={`text-[10px] ${className}`}>{label}</Badge>
}

export default function AutoGtmFlowPage() {
  const flow = useAutoGtmFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const decisionMakerRef = useRef<DecisionMakerFinderHandle>(null)
  const stepContentRef = useRef<HTMLDivElement>(null)
  const hasFocusedOnceRef = useRef(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  useSlashFocus(urlInputRef)
  const [dmSelectedCount, setDmSelectedCount] = useState(0)
  const [committingDm, setCommittingDm] = useState(false)
  const [showStartNewConfirm, setShowStartNewConfirm] = useState(false)
  // Set by Review & Send's "Edit" action on a specific contact — read once
  // by OutreachStep (step 4) to preselect that contact's draft in the
  // detail pane instead of always defaulting to the first contact in the
  // list. Plain page-level state, not part of useAutoGtmFlow's URL-synced
  // machinery — this is a one-shot UI handoff between two steps, not
  // something that needs to survive a refresh.
  const [focusContactId, setFocusContactId] = useState<string | null>(null)

  // Auto-pilot state (see the block below `emailsFoundCount` for the full
  // explanation) — declared up here alongside this file's other per-run
  // refs/state, since the effects that use them live further down (after
  // hasResearch/batchHasProgress are computed).
  const autoAdvancedRef = useRef<Set<number>>(new Set())
  const [dmDiscoveryDone, setDmDiscoveryDone] = useState(false)
  const [draftingSettled, setDraftingSettled] = useState(false)

  function advanceOnce(fromStep: number, toStep: 1 | 2 | 3 | 4 | 5 | 6) {
    if (autoAdvancedRef.current.has(fromStep)) return
    autoAdvancedRef.current.add(fromStep)
    flow.setStep(toStep)
  }

  // Focus management (Phase B a11y pass): move keyboard/screen-reader focus
  // to the new step's content region on every real step change — same
  // "land somewhere sensible" discipline as MobileNav.tsx's drawer-open
  // focus move. A plain useEffect is safe to use here specifically because
  // the step content is NOT wrapped in AnimatePresence (see that block's
  // own comment for why) — the new motion.div mounts synchronously in the
  // same commit as the step-state change, so stepContentRef is already
  // pointing at the right element by the time this effect runs. Skips the
  // very first sync (initial page load / resumed-run correction) so it
  // never yanks focus away from wherever the browser naturally placed it
  // on arrival.
  useEffect(() => {
    if (!flow.stepSynced) return
    if (!hasFocusedOnceRef.current) {
      hasFocusedOnceRef.current = true
      return
    }
    stepContentRef.current?.focus()
  }, [flow.step, flow.stepSynced])

  const hasResearch = Boolean(flow.result && flow.result.success && flow.result.analysisResult)
  const batchSelectedCount = flow.batchCompanies.filter(c => c.selected).length
  const batchDoneCount = flow.batchCompanies.filter(c => c.status === 'done').length
  const batchHasProgress = flow.batchCompanies.some(c => c.status !== 'pending')

  const sortedContacts =
    flow.inputMode === 'batch'
      ? [...flow.contacts].sort((a, b) => a.company_name.localeCompare(b.company_name))
      : flow.contacts

  const emailsFoundCount = flow.contacts.filter(c => c.email).length

  // Real research data for the company-header strip below — reuses
  // ResearchCard's own exported getResearchCardData() rather than
  // re-deriving signal/opportunity counts, same "same underlying data, only
  // presentation differs" discipline AutoFlowResearchSummary.tsx already
  // documents for its own use of this function.
  const researchData = useMemo(() => (flow.result ? getResearchCardData(flow.result) : null), [flow.result])

  // ── Auto-pilot (2026-08-13) ──────────────────────────────────
  // User request: the flow should not need manual "Continue" clicks between
  // Research and Review & Send — once research completes, Decision Makers
  // discovers + commits itself, Contact Information looks itself up, and
  // Campaign & Outreach drafts itself, landing on Review & Send with
  // everything ready. Review & Send (step 5) is the one deliberate stop:
  // the actual "Confirm & Send" action always needs an explicit click —
  // sending a real email to a real prospect requires per-batch confirmation
  // every time, a standing rule (see CLAUDE.md's SCOPE PIVOT section and
  // ReviewSendStep.tsx), not something this automation pass touches.
  //
  // Each step below already exposes (or was given, this session) a
  // "this step's work has settled" signal — hasResearch,
  // DecisionMakerFinder's onDiscoveryComplete, per-contact
  // email_finder_status, OutreachStep's onDraftingSettled — and an effect
  // watches that signal to advance once it fires. The manual "Continue"
  // buttons (nextAction below) are left in place as a fallback, not
  // removed — if something is slow or a step needs manual finishing.
  //
  // autoAdvancedRef guards each step-transition to fire AT MOST ONCE per
  // run, so this never fights deliberate manual back-navigation: if you
  // click back to an earlier step's pill to review or redo something,
  // auto-pilot won't immediately yank you forward again — you'd need to
  // use the manual Continue button (or edit and it re-settles) to move on
  // from there. Reset whenever a new run starts (runId changes).
  useEffect(() => {
    autoAdvancedRef.current = new Set()
    setDmDiscoveryDone(false)
    setDraftingSettled(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.runId])

  // Re-arm the per-step "settled" signals every time that step is (re)entered
  // — DecisionMakerFinder/OutreachStep are only mounted while their step is
  // active, so their own completion callbacks only fire while these are
  // freshly false anyway; this just guarantees that even on a fast re-visit.
  useEffect(() => {
    if (flow.step === 2) setDmDiscoveryDone(false)
    if (flow.step === 4) setDraftingSettled(false)
  }, [flow.step])

  // Step 1 -> 2: research/batch completing is the trigger, for both single
  // and batch mode alike — Decision Makers is step 2 for either input mode
  // now that there's no Sales Strategy step in between to special-case.
  useEffect(() => {
    if (!flow.stepSynced || flow.step !== 1) return
    if (flow.inputMode === 'single' && hasResearch) advanceOnce(1, 2)
    if (flow.inputMode === 'batch' && batchHasProgress && !flow.batchRunning && flow.contacts.length > 0) {
      advanceOnce(1, 2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step, flow.stepSynced, flow.inputMode, hasResearch, batchHasProgress, flow.batchRunning, flow.contacts.length])

  // Step 2 -> 3: single mode waits for DecisionMakerFinder's
  // onDiscoveryComplete, then commits whatever's selected — but ONLY when
  // no contacts exist yet for this run (a resumed run that already has
  // committed contacts must not re-add them; outbound_contacts has no
  // uniqueness constraint, so a duplicate commit would create real dupes).
  // Batch mode already committed every candidate during its own research
  // loop (see runBatchThroughDecisionMakers), so it only needs to wait for
  // that loop to finish, never a discovery-complete signal from this step.
  //
  // FIXED (audit follow-up, live-caught): also gated on `!flow.resuming`
  // now. dmDiscoveryDone can become true (a fast cache-restore, especially
  // once the decision-maker search cache actually persists — see the P1
  // fix this follows) BEFORE flow.contacts has been repopulated by
  // restoreContactsAndCampaign, which runs concurrently, not before, a
  // resumed/re-researched run's DecisionMakerFinder mount. Reading
  // flow.contacts.length === 0 during that window is reading STALE
  // emptiness, not real emptiness — confirmed live: this raced and
  // auto-committed 25 duplicate/unreviewed contacts for a real run.
  // useAutoGtmFlow.ts's `resuming` flag is already true for exactly that
  // window (both call sites: resumeFromRun and runResearch's re-research
  // branch), so gating on it here closes this the same way it already
  // closes the analogous ensureCampaignId race in CampaignSettingsPanel.
  useEffect(() => {
    if (!flow.stepSynced || flow.step !== 2 || autoAdvancedRef.current.has(2) || flow.resuming) return

    if (flow.inputMode === 'single') {
      if (!dmDiscoveryDone) return
      autoAdvancedRef.current.add(2)
      void (async () => {
        if (flow.contacts.length === 0) {
          setCommittingDm(true)
          try {
            await decisionMakerRef.current?.commitSelected()
          } finally {
            setCommittingDm(false)
          }
        }
        flow.setStep(3)
      })()
      return
    }

    if (flow.inputMode === 'batch' && !flow.batchRunning) advanceOnce(2, 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step, flow.stepSynced, flow.inputMode, dmDiscoveryDone, flow.contacts.length, flow.batchRunning, flow.resuming])

  // Step 3 -> 4: waits for every contact's email lookup to settle out of
  // 'pending' (ContactInfoStep already runs these automatically on mount —
  // see that file). Zero contacts is vacuously "settled" too.
  useEffect(() => {
    if (!flow.stepSynced || flow.step !== 3) return
    if (flow.contacts.length > 0 && flow.contacts.some(c => c.email_finder_status === 'pending')) return
    advanceOnce(3, 4)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step, flow.stepSynced, flow.contacts])

  // Step 4 -> 5: waits for OutreachStep's onDraftingSettled, then lands on
  // Review & Send — the deliberate stop, see this block's header comment.
  useEffect(() => {
    if (!flow.stepSynced || flow.step !== 4 || !draftingSettled) return
    if (autoAdvancedRef.current.has(4)) return
    autoAdvancedRef.current.add(4)
    toast.success('Everything is drafted — review and send whenever you’re ready.')
    flow.setStep(5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step, flow.stepSynced, draftingSettled])

  // The flow's one "move forward" control, rendered once at the top next to
  // the step pills (see StepIndicator) so it's always visible without
  // scrolling. Everything through Review & Send now also advances on its
  // own (see the auto-pilot block above) — these buttons stay as a manual
  // fallback/override, and remain the only way to move past step 6 (the
  // real send always needs an explicit click). Left null on step 5, which
  // has nothing further to continue to.
  let nextAction: { label: string; onClick: () => void; disabled: boolean; loading?: boolean } | null = null
  if (flow.step === 1 && flow.inputMode === 'single') {
    nextAction = {
      label: 'Continue to Decision Makers',
      onClick: () => flow.setStep(2),
      disabled: !hasResearch || flow.researching,
    }
  } else if (flow.step === 1 && flow.inputMode === 'batch') {
    nextAction = {
      label: `Review contacts (${flow.contacts.length})`,
      onClick: () => flow.setStep(2),
      disabled: !batchHasProgress || flow.batchRunning || flow.contacts.length === 0,
    }
  } else if (flow.step === 2) {
    // FIXED (audit follow-up): this used to commit whenever dmSelectedCount
    // > 0, with no check of whether contacts already exist for this run —
    // unlike the auto-pilot effect above (step 2's own useEffect), which
    // has always guarded commitSelected() behind `flow.contacts.length ===
    // 0`. On a resumed run with a cached decision-maker search,
    // DecisionMakerFinder pre-selects every cached candidate regardless of
    // which ones were already committed as contacts, so clicking this
    // manual button (rather than letting auto-pilot handle it) could
    // re-add them as duplicates — outbound_contacts has no uniqueness
    // constraint. Now mirrors the auto-pilot guard exactly, so the manual
    // fallback button can never diverge from what auto-pilot would have
    // done. Also checks !flow.resuming for the same reason the auto-pilot
    // effect does (see that effect's own comment) — flow.contacts.length
    // can still be stale/not-yet-restored while resuming is true, so this
    // treats "still resuming" the same as "don't know yet, don't commit".
    const willCommit = flow.inputMode === 'single' && !flow.resuming && flow.contacts.length === 0 && dmSelectedCount > 0
    nextAction = {
      label: `Continue to Contact Info (${willCommit ? flow.contacts.length + dmSelectedCount : flow.contacts.length})`,
      onClick: async () => {
        // Single-company mode: whoever's currently checked in the Decision
        // Makers list gets added as a contact right here, as part of moving
        // forward — no separate "Add Selected as Contacts" click needed.
        // Batch mode already added every candidate during its own research
        // loop, so there's nothing to commit here.
        if (willCommit) {
          setCommittingDm(true)
          try {
            await decisionMakerRef.current?.commitSelected()
          } finally {
            setCommittingDm(false)
          }
        }
        flow.setStep(3)
      },
      disabled: flow.contacts.length === 0 && dmSelectedCount === 0,
      loading: committingDm,
    }
  } else if (flow.step === 3) {
    nextAction = { label: 'Continue to Campaign & Outreach', onClick: () => flow.setStep(4), disabled: flow.contacts.length === 0 }
  } else if (flow.step === 4) {
    // Same simple "contacts exist" gate step 3→4 already uses, not a
    // draft-readiness count — Review & Send (the destination) is itself
    // where "0 ready to send" is shown and handled honestly, same
    // don't-hard-block-forward-navigation precedent as every other step
    // transition in this flow.
    nextAction = { label: 'Continue to Review & Send', onClick: () => flow.setStep(5), disabled: flow.contacts.length === 0 }
  } else if (flow.step === 5) {
    // Always enabled once reached — "0 sent" is still a valid, visitable
    // state on Track & Follow Up (it shows its own honest empty state),
    // same reasoning the old step gate's comment already documented.
    nextAction = { label: 'Continue to Track & Follow Up', onClick: () => flow.setStep(6), disabled: false }
  }

  // Real, per-step progress detail for the compact StepIndicator strip below
  // — every value here is derived from flow state already computed above
  // (contact counts, the drafting-settled/decision-maker-discovery signals,
  // send outcomes), never invented. See StepIndicator.tsx's own header for
  // why this replaced the old giant numbered-circle stepper.
  const contactsCommitted = flow.contacts.length > 0
  const emailLookupSettled = contactsCommitted && !flow.contacts.some(c => c.email_finder_status === 'pending')
  const sentCount = Object.values(flow.campaignContactStatus).filter(s => s.status === 'sent').length
  const stepMeta: StepMeta[] = [
    hasResearch || (flow.inputMode === 'batch' && batchHasProgress && !flow.batchRunning)
      ? {
          status: 'complete',
          detail: flow.inputMode === 'single'
            ? (flow.companyName || flow.domain)
            : `${batchDoneCount}/${flow.batchCompanies.length} researched`,
        }
      : flow.researching || flow.batchRunning
        ? { status: 'active', detail: 'Researching…' }
        : { status: flow.step === 1 ? 'active' : 'not_started' },
    contactsCommitted
      ? { status: 'complete', detail: `${flow.contacts.length} found` }
      : flow.step === 2
        ? { status: 'active', detail: committingDm ? 'Adding…' : dmDiscoveryDone ? 'Reviewing…' : 'Searching…' }
        : { status: hasResearch || batchHasProgress ? 'waiting' : 'not_started' },
    emailLookupSettled
      ? { status: 'complete', detail: `${emailsFoundCount} verified` }
      : flow.step === 3
        ? { status: 'active', detail: 'Looking up…' }
        : { status: contactsCommitted ? 'waiting' : 'not_started' },
    draftingSettled
      ? { status: 'complete', detail: 'Drafted' }
      : flow.step === 4
        ? { status: 'active', detail: 'Drafting…' }
        : { status: emailLookupSettled ? 'waiting' : 'not_started' },
    sentCount > 0
      ? { status: 'complete', detail: `${sentCount} sent` }
      : flow.step === 5
        ? { status: 'active' }
        : { status: flow.maxStepReached >= 5 ? 'waiting' : 'not_started' },
    flow.step === 6
      ? { status: 'active' }
      : flow.maxStepReached >= 6
        ? { status: 'complete', detail: 'Tracking' }
        : { status: sentCount > 0 ? 'waiting' : 'not_started' },
  ]

  return (
    <div className={cn('mx-auto max-w-3xl px-4 py-8 space-y-4', nextAction && 'pb-28 md:pb-8')}>
      {/* Header — flat panel, not a floating glass card (intelligence-workspace pass) */}
      <div className="rounded-lg border border-border bg-card px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Workflow className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-foreground">Auto Flow</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Research a prospect company (or upload a lead list), pick who to contact, and send them a
                personalized email, all in one continuous flow.{' '}
                <Link href="/admin/wizard" className="underline hover:text-foreground">
                  Need the manual/debug tools instead?
                </Link>
              </p>
            </div>
          </div>
          {(flow.runId || flow.batchCompanies.length > 0) && (
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setShowStartNewConfirm(true)}>
              Start New
            </Button>
          )}
        </div>
      </div>

      {/* Company intelligence header — the researched company is the central
          object of the page once research exists, not just another step's
          content. Every field/metric here comes straight from
          getResearchCardData()/flow state; a missing field (no industry, no
          HQ) is simply omitted, never shown as a placeholder. */}
      {flow.inputMode === 'single' && hasResearch && researchData && (
        <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-3">
          <div className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="truncate text-base font-semibold text-foreground">{researchData.companyName}</h2>
                {researchData.confidence && (
                  <span
                    className={cn(
                      'text-[11px]',
                      researchData.confidence === 'high'
                        ? 'text-signal-strong'
                        : researchData.confidence === 'medium'
                          ? 'text-signal-medium'
                          : 'text-muted-foreground'
                    )}
                  >
                    {researchData.confidence} confidence
                  </span>
                )}
              </div>
              {researchData.facts.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {researchData.facts.map(f => f.value).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile icon={Radar} label="Signals" value={researchData.signalCount} />
            <MetricTile icon={Lightbulb} label="Opportunities" value={researchData.opportunities.length} />
            <MetricTile icon={Users} label="Decision Makers" value={flow.contacts.length} />
            <MetricTile icon={Mail} label="Verified Contacts" value={emailsFoundCount} />
          </div>
        </div>
      )}

      {flow.inputMode === 'batch' && batchHasProgress && (
        <p className="px-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {batchDoneCount} of {flow.batchCompanies.length} compan{flow.batchCompanies.length === 1 ? 'y' : 'ies'} researched
          </span>
          {flow.contacts.length > 0 && ` · ${flow.contacts.length} contact${flow.contacts.length === 1 ? '' : 's'}`}
          {emailsFoundCount > 0 && ` · ${emailsFoundCount} email${emailsFoundCount === 1 ? '' : 's'} found`}
        </p>
      )}

      {/* Compact progress strip — see StepIndicator.tsx's own header for why
          this replaced the old giant numbered-circle stepper. */}
      <div className="rounded-lg border border-border bg-card px-2 py-1.5">
        <StepIndicator
          current={flow.step}
          maxReached={flow.maxStepReached}
          meta={stepMeta}
          onStepClick={n => flow.setStep(n as 1 | 2 | 3 | 4 | 5 | 6)}
        />
      </div>

      {/* Next Best Action — the flow's one "move forward" control, now a
          distinct callout instead of a bare button crowded next to the step
          pills. Hidden on mobile: page.tsx's own sticky bottom bar (below)
          already covers the same action there. */}
      {nextAction && (
        <div className="hidden items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 md:flex">
          <div className="flex min-w-0 items-center gap-2">
            <ArrowRight className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary/80">Next best action</p>
              <p className="truncate text-sm text-foreground">{nextAction.label}</p>
            </div>
          </div>
          <Button onClick={nextAction.onClick} disabled={nextAction.disabled} className="shrink-0">
            {nextAction.loading ? <Spinner className="size-3.5" /> : null}
            Continue
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={showStartNewConfirm}
        onOpenChange={setShowStartNewConfirm}
        title="Start a new research?"
        description="This clears the current company and progress from this screen so you can start over. Nothing already saved (past runs, contacts, drafts) is deleted, you can still find it in History."
        confirmLabel="Start New"
        onConfirm={() => { setShowStartNewConfirm(false); flow.resetFlow() }}
      />

      {/* Screen-reader-only announcement on step change — sighted users
          already see the pill highlight slide and the content transition. */}
      <span className="sr-only" role="status" aria-live="polite">
        {`Step ${flow.step} of ${STEPS.length}: ${STEPS[flow.step - 1]}`}
      </span>

      {flow.stepSynced && (
      // Deliberately NOT wrapped in <AnimatePresence mode="wait">. A first
      // version was — and it looked fine in every load-a-fresh-URL check,
      // but a real click-driven step transition (verified live: click
      // "Back" from a settled step, check document.body's rendered text)
      // reproducibly got AnimatePresence's exit permanently stuck: the
      // StepIndicator pills/aria-live region (which read `flow.step`
      // directly, outside this block) correctly showed the new step, while
      // the actual content inside stayed frozen on the OLD step's markup
      // forever — reproduced in a completely fresh tab with a clean
      // console, and reproduced identically with no focus-management code
      // attached at all, so this isn't specific to this file's a11y work.
      // Root cause not worth chasing further into framer-motion's mode="wait"
      // internals — dropping AnimatePresence removes the exit-tracking
      // machinery that was getting stuck, at the cost of the outgoing
      // step's fade-out (an acceptable trade for "always shows the right
      // content"). The entering step's own fade/slide-in (motion.div's own
      // initial/animate, below) still plays without AnimatePresence —only
      // the coordinated "wait for exit, then enter" sequencing is gone.
      <motion.div
          key={flow.step}
          ref={stepContentRef}
          tabIndex={-1}
          aria-label={`${STEPS[flow.step - 1]} step content`}
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          className="space-y-6 outline-none"
        >

      {/* Step 1: Research */}

      {flow.step === 1 && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
          <button
            onClick={() => flow.setInputMode('single')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              flow.inputMode === 'single'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Single Company
          </button>
          <button
            onClick={() => flow.setInputMode('batch')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              flow.inputMode === 'batch'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Upload Lead List
          </button>
        </div>
      )}

      {flow.step === 1 && flow.inputMode === 'single' && (
        <Card className="border-border bg-card">
          <CardContent className="px-5 py-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Research company</h2>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={urlInputRef}
                aria-label="Company URL"
                value={flow.url}
                onChange={e => flow.setUrl(e.target.value)}
                placeholder="https://company.com (press / to focus)"
                className="flex-1 font-mono text-sm"
                disabled={flow.researching}
                onKeyDown={e => e.key === 'Enter' && flow.runResearch()}
              />
              {/* Lightweight/Full mode picker deliberately not exposed here — Auto
                  Flow always researches in the app-wide default (full) mode; the
                  toggle stays available in Wizard/Intelligence Lab's manual/debug
                  tools for anyone who needs it. flow.mode/setMode are unchanged
                  in the hook, just not rendered as a choice in this flow. */}
              <Button onClick={() => flow.runResearch()} disabled={flow.researching || !flow.url.trim()}>
                {flow.researching && !flow.forcingFresh ? (
                  <>
                    <Spinner className="size-3.5" /> Researching…
                  </>
                ) : (
                  'Research'
                )}
              </Button>
              <Button
                onClick={() => flow.runResearch({ force: true })}
                disabled={flow.researching || !flow.url.trim()}
                variant="outline"
                title="Ignore any cached scrape for this URL and research it fresh"
              >
                {flow.researching && flow.forcingFresh ? (
                  <>
                    <Spinner className="size-3.5" /> Clearing cache…
                  </>
                ) : (
                  '↻ Clear Cache & Re-Research'
                )}
              </Button>
            </div>
            {flow.error && (
              <div role="alert" aria-live="assertive" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {flow.error}
              </div>
            )}
            {/* Visible in place of the old sr-only-only announcement — its
                label carries the same role="status"/aria-live so screen
                readers still get an update, sighted users now get one too
                instead of just the button's spinner. */}
            <StageProgress active={flow.researching} stages={RESEARCH_STAGES} />
          </CardContent>
        </Card>
      )}

      {flow.step === 1 && flow.inputMode === 'single' && !hasResearch && (
        <CompanyPipelineList
          onResume={async (runId, step) => {
            await flow.resumeFromRun(runId)
            // 'sent' rows land on step 6 (Track & Follow Up) — already sent,
            // just checking status. 'in_progress' rows land on step 4
            // (Campaign & Outreach) — auto-pilot picks up drafting/review
            // from wherever this run left off. See CompanyPipelineList's own
            // header for the two stages.
            flow.setStep(step)
          }}
        />
      )}

      {flow.step === 1 && flow.inputMode === 'batch' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardContent className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx,.pdf"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void flow.handleBatchFile(f)
                  }}
                  disabled={flow.batchUploading}
                  className="text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-accent file:text-foreground/90 file:text-xs hover:file:bg-accent"
                />
                {flow.batchUploading && <span className="text-xs text-muted-foreground">Parsing…</span>}
              </div>
              <p className="text-muted-foreground/70 text-xs flex items-center gap-1.5">
                Supported: .xlsx, .csv, .docx, .pdf
                <InfoTooltip>
                  Each company is researched, then its decision makers are found automatically.
                  Review everything together once the batch finishes.
                </InfoTooltip>
              </p>
              {flow.batchUploadError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {flow.batchUploadError}
                </div>
              )}
              {flow.batchUploadWarnings.length > 0 && (
                <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2 text-xs space-y-0.5">
                  {flow.batchUploadWarnings.map((w, i) => (
                    <p key={i} className="text-signal-medium">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {flow.batchCompanies.length > 0 && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={flow.selectAllBatch} disabled={flow.batchRunning}>
                  Select all
                </Button>
                <Button size="sm" variant="outline" onClick={flow.selectNoneBatch} disabled={flow.batchRunning}>
                  Select none
                </Button>
                <span className="text-muted-foreground text-xs">
                  {batchSelectedCount} of {flow.batchCompanies.length} selected · {batchDoneCount} done
                </span>
                <div className="ml-auto">
                  {flow.batchRunning ? (
                    <Button size="sm" variant="outline" onClick={flow.stopBatch}>
                      Stop after current
                    </Button>
                  ) : (
                    <Button size="sm" onClick={flow.runBatchThroughDecisionMakers} disabled={batchSelectedCount === 0}>
                      Research + Find Decision Makers ({batchSelectedCount})
                    </Button>
                  )}
                </div>
              </div>

              {flow.batchProgress && (
                <div role="status" aria-live="polite" className="flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/10 border border-primary/40 text-xs">
                  <span className="text-primary font-medium">
                    Company {flow.batchProgress.done + 1} of {flow.batchProgress.total}
                  </span>
                  <span className="text-muted-foreground truncate">{flow.batchProgress.current}</span>
                </div>
              )}

              {flow.batchPausedReason && (
                <div className="rounded-lg border border-signal-medium/30 bg-signal-medium/10 px-3 py-2.5 text-xs">
                  <p className="text-signal-medium font-medium">⏸ Batch paused</p>
                  <p className="text-signal-medium/80 mt-1">{flow.batchPausedReason}</p>
                </div>
              )}

              <motion.div variants={staggerList} initial="hidden" animate="visible" className="space-y-1.5">
                {flow.batchCompanies.map(({ company, selected, status, contactsFound, errorMessage }) => (
                  <motion.div
                    key={company.id}
                    variants={listItem}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => flow.toggleBatchCompany(company.id)}
                      disabled={flow.batchRunning}
                      className="accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground text-sm truncate">{company.companyName}</span>
                      {(company.icpSegment || company.sourceListId) && (
                        <p className="text-muted-foreground/70 text-xs truncate">
                          {[company.icpSegment, company.sourceListId].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {errorMessage && <p className="text-destructive text-xs mt-0.5">{errorMessage}</p>}
                    </div>
                    {status === 'done' && contactsFound > 0 && (
                      <span className="text-xs text-muted-foreground">{contactsFound} decision maker(s)</span>
                    )}
                    {status === 'done' && contactsFound === 0 && (
                      <span className="text-xs text-muted-foreground/60">no decision makers found</span>
                    )}
                    <BatchStatusBadge status={status} />
                  </motion.div>
                ))}
              </motion.div>
            </>
          )}
        </div>
      )}

      {flow.step === 1 && flow.inputMode === 'single' && hasResearch && flow.result && (
        <AutoFlowResearchSummary result={flow.result} qualification={flow.qualification} />
      )}

      {/* Step 2: Decision Makers (found automatically, user just selects who to keep) */}

      {flow.step === 2 && (
        <>
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Decision Makers
              <InfoTooltip>
                Titles searched: CEO, CTO, VP Operations, Plant Head, and similar roles.
              </InfoTooltip>
            </h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {flow.inputMode === 'single'
                ? 'Found automatically below. Uncheck anyone you don’t want, then continue.'
                : 'Already found while researching. Review the list, then continue.'}
            </p>
          </div>

          {flow.inputMode === 'single' && flow.runId && (
            <DecisionMakerFinder
              ref={decisionMakerRef}
              autoStart
              compact
              companyName={flow.companyName}
              domain={flow.domain}
              sourceRunId={flow.runId}
              onContactAdded={flow.addContactRow}
              onSelectionChange={setDmSelectedCount}
              onDiscoveryComplete={() => setDmDiscoveryDone(true)}
              leadershipContacts={flow.result?.extractorResult?.leadershipContacts}
              analysisResult={flow.result?.analysisResult}
            />
          )}

          {flow.inputMode === 'batch' && (
            <Card className="border-border bg-card">
              <CardContent className="px-5 py-4">
                <p className="text-sm text-foreground">
                  {flow.contacts.length} decision maker{flow.contacts.length === 1 ? '' : 's'} found across{' '}
                  {batchDoneCount} compan{batchDoneCount === 1 ? 'y' : 'ies'}.
                </p>
                {flow.contacts.length === 0 && (
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    No decision makers were found for this batch. You can still continue, or go back and
                    research different companies.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Button variant="outline" onClick={() => flow.setStep(1)}>
            ← Back
          </Button>
        </>
      )}

      {/* Step 3: Contact Information (email/phone/LinkedIn looked up automatically) */}

      {flow.step === 3 && (
        <>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Contact Information</h2>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Email, phone, and LinkedIn are looked up automatically below.
            </p>
          </div>

          <ContactInfoStep
            contacts={sortedContacts}
            pendingAction={flow.pendingAction}
            findEmailForContact={flow.findEmailForContact}
            deleteContact={flow.deleteContact}
            groupByCompany={flow.inputMode === 'batch'}
          />

          <Button variant="outline" onClick={() => flow.setStep(2)}>
            ← Back
          </Button>
        </>
      )}

      {/* Step 4: Campaign & Outreach (subject/email/follow-ups drafted
          automatically, plus campaign settings — no send action here, that
          moved to Review & Send) */}

      {flow.step === 4 && (
        <>
          <OutreachStep
            contacts={sortedContacts}
            campaignId={flow.campaignId}
            ensureCampaignId={flow.ensureCampaignId}
            resuming={flow.resuming}
            defaultCampaignName={flow.inputMode === 'batch' ? `Batch (${flow.contacts.length} contacts) - Auto Flow` : `${flow.companyName} - Auto Flow`}
            updateContactEmail={flow.updateContactEmail}
            initialActiveContactId={focusContactId}
            onDraftingSettled={() => setDraftingSettled(true)}
          />
          <Button variant="outline" onClick={() => flow.setStep(3)}>
            ← Back
          </Button>
        </>
      )}

      {/* Step 5: Review & Send (final counts, per-contact preview/remove,
          the one "Confirm & Send" action) */}

      {flow.step === 5 && (
        <>
          <ReviewSendStep
            contacts={sortedContacts}
            qualification={flow.qualification}
            researchQualityFlagged={flow.researchQualityFlagged}
            campaignId={flow.campaignId}
            ensureCampaignId={flow.ensureCampaignId}
            campaignContactStatus={flow.campaignContactStatus}
            sendingContactId={flow.sendingContactId}
            sendingSelected={flow.sendingSelected}
            sendOneContact={flow.sendOneContact}
            sendSelectedContacts={flow.sendSelectedContacts}
            onEditContact={contactId => {
              if (contactId) setFocusContactId(contactId)
              flow.setStep(4)
            }}
          />
          <Button variant="outline" onClick={() => flow.setStep(4)}>
            ← Back
          </Button>
        </>
      )}

      {/* Step 6: Track & Follow Up (real send/open/reply status for this
          company's contacts, continuing the flow past send instead of
          leaving it as a dead end) */}

      {flow.step === 6 && (
        <>
          <TrackFollowUpStep campaignId={flow.campaignId} contacts={flow.contacts} />
          <Button variant="outline" onClick={() => flow.setStep(5)}>
            ← Back
          </Button>
        </>
      )}

        </motion.div>
      )}

      {/* Sticky bottom CTA — mobile only (2026-08-04 mobile pass). Mirrors
          StepIndicator's nextAction button, which is hidden on mobile in
          favor of this: a phone-sized checkout-flow-style sticky action bar
          reads as "app" far more than requiring a scroll back to the header
          to advance. Sits just above BottomTabBar (bottom offset = tab
          bar's own 3.5rem height + its safe-area inset), not overlapping
          it. Arbitrary-value calc()/env() here for the same reason
          app/admin/layout.tsx uses it instead of a named @utility — see
          globals.css's note on why calc() inside @utility silently failed
          to compile in this Tailwind v4 install. */}
      {nextAction && (
        <div
          className="fixed inset-x-0 bottom-[calc(3.5rem_+_env(safe-area-inset-bottom,0px))] z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden"
        >
          <Button size="lg" className="w-full" onClick={nextAction.onClick} disabled={nextAction.disabled}>
            {nextAction.loading ? <Spinner className="size-3.5" /> : null}
            {nextAction.label}
          </Button>
        </div>
      )}
    </div>
  )
}
