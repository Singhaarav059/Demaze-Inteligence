'use client'

// ============================================================
// OutreachStep — Auto Flow step 4, "Campaign & Outreach"
// ============================================================
// Drafts each contact's outreach email automatically (subject lines -> pick
// the first -> full email -> follow-up sequence), then lets you review,
// edit, switch subject, and regenerate — plus the campaign's own settings
// (name, sending account, daily limit, send window, follow-up cadence
// override) via CampaignSettingsPanel. Master-detail layout (contact list
// left, full draft right) carried over unchanged from the prior merged
// "Outreach & Send" step.
//
// RESTRUCTURED (2026-08-12, 5→6 step split): sending itself moved OUT of
// this step entirely, into the new Review & Send step (ReviewSendStep.tsx)
// — this step now only prepares content and settings, never sends. That's
// why there's no ConfirmDialog, no campaignContactStatus, no Send button
// here anymore; drafting/regenerate/switch-subject/edit logic is otherwise
// unchanged from before the split.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip } from '@/components/ui/tooltip'
import { TypewriterText } from '@/components/ui/typewriter-text'
import { expandCollapse } from '@/lib/motion'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { SalesIntelligenceRow } from '@/lib/sales-knowledge/types'
import { CampaignSettingsPanel } from './CampaignSettingsPanel'

// Read-only summary of the Sales Strategy step's recommendation (spec
// item 16: "Sales Strategy" section showing angle/problem/capability/
// proof/CTA above the drafted outreach) — editing happens on step 2, not
// here. Renders nothing when no Sales Intelligence exists for this run
// (never generated, or Sales Knowledge unconfigured) — purely additive,
// generation itself works identically either way (see assemble-input.ts's
// degrade-gracefully contract).
function SalesStrategySummary({ salesIntelligence }: { salesIntelligence: SalesIntelligenceRow | null | undefined }) {
  if (!salesIntelligence?.recommended_problem_slug && !salesIntelligence?.active_problem_slug) return null
  const positioning = salesIntelligence.active_positioning_text ?? salesIntelligence.positioning_text
  const cta = salesIntelligence.active_cta ?? salesIntelligence.recommended_cta
  return (
    <div className="rounded-lg border border-border bg-accent/20 px-3 py-2.5 space-y-1">
      <p className="text-xs font-medium text-foreground">Sales Strategy</p>
      {positioning && <p className="text-xs text-muted-foreground">{positioning}</p>}
      {cta && <p className="text-xs text-muted-foreground/80">CTA: {cta}</p>}
    </div>
  )
}

// Shown in place of the eventual email body while drafting is in flight —
// gives the multi-stage ~30-90s wait a sense of progress instead of a
// frozen spinner line.
function DraftSkeleton() {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

interface EmailDraft {
  hook: string
  personalization: string
  painPoint: string
  valueProp: string
  cta: string
  signature: string
  fullText: string
}

interface FollowupDraft {
  sequence: number
  angle: string
  urgency: 'low' | 'medium' | 'high'
  subject: string
  body: string
}

interface GeneratedContent {
  contact_id?: string
  subject_lines: string[] | null
  selected_subject_line: string | null
  email_draft: EmailDraft | null
  followups: FollowupDraft[] | null
  status?: 'draft' | 'approved' | 'sent'
}

interface EditDraft {
  email: string
  subject: string
  body: string
}

type DraftStage = 'subjects' | 'email' | 'followups'

function urgencyBadgeVariant(urgency: FollowupDraft['urgency']) {
  if (urgency === 'high') return 'destructive' as const
  if (urgency === 'medium') return 'secondary' as const
  return 'outline' as const
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

async function fetchGenerated(contactId: string): Promise<GeneratedContent | null> {
  try {
    const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`)
    const data = await res.json()
    return data.success ? data.generated : null
  } catch {
    return null
  }
}

// One automatic pass: subject lines -> auto-pick the first (already
// ordered by relevance) -> email from that subject -> follow-up sequence.
// Each of these 3 calls goes through the real AI provider chain and can
// take ~30-60s+, so onStage lets the caller show which call is in flight
// instead of one opaque spinner for a minute or more.
async function autoDraft(contactId: string, onStage: (stage: DraftStage) => void): Promise<GeneratedContent | null> {
  onStage('subjects')
  const subjRes = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-subject-lines`, { method: 'POST' })
  const subjData = await subjRes.json()
  if (!subjData.success) return null
  const firstSubject: string | undefined = subjData.generated?.subject_lines?.[0]
  if (!firstSubject) return subjData.generated ?? null

  onStage('email')
  const emailRes = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectLine: firstSubject }),
  })
  const emailData = await emailRes.json()
  if (!emailData.success) return subjData.generated ?? null

  onStage('followups')
  const followRes = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-followups`, { method: 'POST' })
  const followData = await followRes.json()
  return followData.success ? followData.generated : emailData.generated
}

// Switching the selected subject line regenerates the email + follow-up
// sequence from it, so what's shown always stays internally consistent.
async function switchSubjectAndRegenerate(contactId: string, subject: string): Promise<GeneratedContent | null> {
  await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_subject_line: subject }),
  })

  const emailRes = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectLine: subject }),
  })
  const emailData = await emailRes.json()
  if (!emailData.success) return null

  const followRes = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-followups`, { method: 'POST' })
  const followData = await followRes.json()
  return followData.success ? followData.generated : emailData.generated
}

export function OutreachStep({
  contacts: allContacts,
  campaignId,
  ensureCampaignId,
  resuming,
  defaultCampaignName,
  updateContactEmail,
  initialActiveContactId,
  salesIntelligence,
}: {
  contacts: OutboundContact[]
  campaignId: string | null
  ensureCampaignId: () => Promise<string | null>
  // True while a resumed run is still being restored — see
  // useAutoGtmFlow.ts's `resuming` state for the duplicate-campaign race
  // this closes. Threaded straight through to CampaignSettingsPanel.
  resuming: boolean
  defaultCampaignName: string
  updateContactEmail: (contactId: string, email: string) => Promise<boolean>
  // Set when arriving here via Review & Send's "Edit" action on a specific
  // contact — preselects that contact's draft in the detail pane instead of
  // defaulting to the first contact in the list.
  initialActiveContactId?: string | null
  // Read-only display only (see SalesStrategySummary above) — generation
  // itself reads this from the server side (fetch-context.ts), not from
  // this prop, so it stays correct even if this prop is stale/absent.
  salesIntelligence?: SalesIntelligenceRow | null
}) {
  // Contacts with no email can't be drafted for without burning AI credits
  // on content that has nowhere to go — discard them before this step ever
  // sees them, rather than showing them with a disabled/fallback state.
  // Scoped to this step's own rendering only (the full contact list,
  // including no-email ones, is still what earlier steps and the flow's own
  // contact-count summary read from).
  const contacts = useMemo(() => allContacts.filter(c => c.email), [allContacts])
  const [drafts, setDrafts] = useState<Record<string, GeneratedContent | null>>({})
  // Per-contact, not a single shared value — drafting now runs for several
  // contacts at once (see DRAFT_CONCURRENCY below), so both need to be
  // keyed by contact id rather than tracking "the one contact currently
  // drafting."
  const [draftingIds, setDraftingIds] = useState<Set<string>>(new Set())
  const [draftingStages, setDraftingStages] = useState<Record<string, DraftStage | null>>({})
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  // Which contact's full draft is shown in the detail pane (right side of
  // the split view).
  const [activeContactId, setActiveContactId] = useState<string | null>(initialActiveContactId ?? null)

  function beginDrafting(contactId: string) {
    setDraftingIds(prev => new Set(prev).add(contactId))
    setDraftingStages(prev => ({ ...prev, [contactId]: null }))
  }

  function setContactDraftingStage(contactId: string, stage: DraftStage) {
    setDraftingStages(prev => ({ ...prev, [contactId]: stage }))
  }

  function endDrafting(contactId: string) {
    setDraftingIds(prev => {
      const next = new Set(prev)
      next.delete(contactId)
      return next
    })
    setDraftingStages(prev => {
      const next = { ...prev }
      delete next[contactId]
      return next
    })
  }

  // How many contacts draft at once. Each contact's own 3 calls
  // (subjects -> email -> followups) are inherently sequential — one
  // depends on the previous one's output — but different contacts don't
  // depend on each other, so this pool runs several contacts' sequences
  // in parallel instead of the whole list one contact at a time. Capped
  // (not Promise.all over everything) so a large batch doesn't fire dozens
  // of concurrent requests at the AI provider at once.
  const DRAFT_CONCURRENCY = 3

  const draftMissing = useCallback(async () => {
    const missing = contacts.filter(c => !(c.id in drafts))
    if (missing.length === 0) return

    let cursor = 0
    async function worker() {
      while (cursor < missing.length) {
        const contact = missing[cursor++]

        beginDrafting(contact.id)
        try {
          const existing = await fetchGenerated(contact.id)
          const generated = existing?.email_draft
            ? existing
            : await autoDraft(contact.id, stage => setContactDraftingStage(contact.id, stage))
          setDrafts(prev => ({ ...prev, [contact.id]: generated }))
        } catch {
          toast.error(`Could not draft an email for ${contact.person_name}`)
          setDrafts(prev => ({ ...prev, [contact.id]: null }))
        } finally {
          endDrafting(contact.id)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, missing.length) }, worker))
  }, [contacts, drafts])

  const draftForContact = useCallback(async (contact: OutboundContact) => {
    beginDrafting(contact.id)
    try {
      const generated = await autoDraft(contact.id, stage => setContactDraftingStage(contact.id, stage))
      setDrafts(prev => ({ ...prev, [contact.id]: generated }))
    } catch {
      toast.error(`Could not draft an email for ${contact.person_name}`)
    } finally {
      endDrafting(contact.id)
    }
  }, [])

  useEffect(() => {
    // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void draftMissing()
    // Deliberately keyed on the joined contact-id list, not `contacts`/
    // `draftMissing` — this should only re-run when the set of contacts
    // actually changes, not on every drafts-state update draftMissing itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.map(c => c.id).join(',')])

  // Default the detail pane to the first contact, and fall back to another
  // one if the currently-active contact disappears from the list.
  useEffect(() => {
    setActiveContactId(prev => {
      if (prev && contacts.some(c => c.id === prev)) return prev
      if (initialActiveContactId && contacts.some(c => c.id === initialActiveContactId)) return initialActiveContactId
      return contacts[0]?.id ?? null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, initialActiveContactId])

  function selectContact(contactId: string) {
    if (contactId !== activeContactId) {
      cancelEditing()
    }
    setActiveContactId(contactId)
  }

  async function regenerate(contactId: string) {
    beginDrafting(contactId)
    try {
      const generated = await autoDraft(contactId, stage => setContactDraftingStage(contactId, stage))
      setDrafts(prev => ({ ...prev, [contactId]: generated }))
    } catch {
      toast.error('Could not regenerate this email')
    } finally {
      endDrafting(contactId)
    }
  }

  async function switchSubject(contactId: string, subject: string) {
    setSwitchingId(contactId)
    try {
      const generated = await switchSubjectAndRegenerate(contactId, subject)
      if (!generated) {
        toast.error('Could not switch subject line')
        return
      }
      setDrafts(prev => ({ ...prev, [contactId]: generated }))
      toast.success('Switched subject line')
    } catch {
      toast.error('Could not switch subject line')
    } finally {
      setSwitchingId(null)
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startEditing(contact: OutboundContact) {
    const generated = drafts[contact.id]
    setEditDraft({
      email: contact.email ?? '',
      subject: generated?.selected_subject_line ?? '',
      body: generated?.email_draft?.fullText ?? '',
    })
    setEditingContactId(contact.id)
  }

  function cancelEditing() {
    setEditingContactId(null)
    setEditDraft(null)
  }

  async function saveEditing(contact: OutboundContact) {
    if (!editDraft) return
    setSavingEdit(true)
    try {
      const generated = drafts[contact.id]
      const trimmedEmail = editDraft.email.trim()

      const tasks: Promise<boolean>[] = []

      if (trimmedEmail !== (contact.email ?? '')) {
        tasks.push(updateContactEmail(contact.id, trimmedEmail))
      }

      const subjectChanged = editDraft.subject !== (generated?.selected_subject_line ?? '')
      const bodyChanged = editDraft.body !== (generated?.email_draft?.fullText ?? '')
      if (subjectChanged || bodyChanged) {
        tasks.push(
          (async () => {
            try {
              const res = await fetch(`/api/admin/outbound/contacts/${contact.id}/generated-content`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  selected_subject_line: editDraft.subject,
                  email_draft: { ...generated?.email_draft, fullText: editDraft.body },
                }),
              })
              const data = await res.json()
              if (!data.success) {
                toast.error(data.error ?? 'Failed to save draft edits')
                return false
              }
              setDrafts(prev => ({
                ...prev,
                [contact.id]: {
                  ...(prev[contact.id] ?? { subject_lines: null, followups: null, status: 'draft' as const }),
                  selected_subject_line: data.generated.selected_subject_line,
                  email_draft: data.generated.email_draft,
                },
              }))
              return true
            } catch {
              toast.error('Could not reach the generation API')
              return false
            }
          })()
        )
      }

      if (tasks.length === 0) {
        cancelEditing()
        return
      }

      const results = await Promise.all(tasks)
      if (results.every(Boolean)) {
        toast.success('Changes saved')
        cancelEditing()
      }
      // Leave the edit form open with whatever succeeded still applied
      // locally if one of the two saves failed — the failing call already
      // showed its own toast.error, and closing here would silently discard
      // the other, still-unsaved edit too.
    } finally {
      setSavingEdit(false)
    }
  }

  const readyCount = contacts.filter(c => drafts[c.id]?.email_draft).length

  return (
    <div className="space-y-3">
      <CampaignSettingsPanel campaignId={campaignId} ensureCampaignId={ensureCampaignId} resuming={resuming} defaultCampaignName={defaultCampaignName} />

      <SalesStrategySummary salesIntelligence={salesIntelligence} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Campaign & Outreach
            <InfoTooltip>
              Each draft is a real AI call and can take a minute or two per contact, this isn&apos;t stuck, it&apos;s
              thinking. Nothing is sent from this screen — review and send happens on the next step.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Drafted automatically below. Edit, switch subject, or regenerate — sending happens on the next step.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {readyCount} of {contacts.length} drafted
        </Badge>
      </div>

      {contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-4">No contacts to draft for.</p>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col md:flex-row">
          {/* Left: compact contact list — click a row to preview its draft on the right */}
          <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <div className="max-h-[560px] overflow-y-auto divide-y divide-border">
              {contacts.map(contact => {
                const generated = drafts[contact.id]
                const isActive = activeContactId === contact.id
                const isDraftingThis = draftingIds.has(contact.id) && !generated?.email_draft

                return (
                  <div
                    key={contact.id}
                    className={`flex items-center gap-2 px-3 py-2 ${isActive ? 'bg-accent' : 'hover:bg-accent/40'}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectContact(contact.id)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <span className="size-7 shrink-0 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                        {initialsOf(contact.person_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-foreground truncate">{contact.person_name}</span>
                          {generated?.email_draft && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">drafted</Badge>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70 truncate">
                          {contact.title_hint || contact.email}
                        </span>
                        {isDraftingThis && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <Spinner className="size-2.5" /> drafting…
                          </span>
                        )}
                        {!generated?.email_draft && !isDraftingThis && (
                          <span className="block text-[10px] text-muted-foreground/50">no draft</span>
                        )}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: full draft (To / Subject / Body) for the selected contact */}
          <div className="flex-1 min-w-0 p-4 space-y-3">
            {(() => {
              const contact = contacts.find(c => c.id === activeContactId)
              if (!contact) return <p className="text-xs text-muted-foreground/60">Select a contact to preview.</p>

              const generated = drafts[contact.id]
              const isEditing = editingContactId === contact.id
              const isDrafting = draftingIds.has(contact.id)
              const draftingStage = draftingStages[contact.id] ?? null
              const isSwitching = switchingId === contact.id
              const isExpanded = expandedIds.has(contact.id)
              const otherSubjects = (generated?.subject_lines ?? []).filter(s => s !== generated?.selected_subject_line)

              return (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{contact.person_name}</span>
                        {contact.title_hint && (
                          <span className="text-xs text-muted-foreground/70">{contact.title_hint}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {generated?.email_draft && (
                        <Button size="sm" variant="ghost" onClick={() => toggleExpanded(contact.id)}>
                          {isExpanded ? 'Hide' : 'Details'}
                        </Button>
                      )}
                      {generated?.email_draft && (
                        <Button size="sm" variant="outline" disabled={isDrafting || isSwitching} onClick={() => regenerate(contact.id)}>
                          {isDrafting ? <Spinner className="size-3.5" /> : null}
                          Regenerate
                        </Button>
                      )}
                    </div>
                  </div>

                  {isDrafting && !generated?.email_draft && (
                    <div className="space-y-2">
                      <p role="status" aria-live="polite" className="text-xs text-muted-foreground flex items-center gap-2">
                        <Spinner className="size-3.5" />
                        {draftingStage === 'email' && 'Drafting the email…'}
                        {draftingStage === 'followups' && 'Writing follow-ups…'}
                        {(draftingStage === 'subjects' || draftingStage === null) && 'Writing subject lines…'}
                      </p>
                      <DraftSkeleton />
                    </div>
                  )}

                  {isSwitching && (
                    <p role="status" aria-live="polite" className="text-xs text-muted-foreground flex items-center gap-2">
                      <Spinner className="size-3.5" /> Switching subject and redrafting…
                    </p>
                  )}

                  {generated?.email_draft ? (
                    isEditing && editDraft ? (
                      <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground/70" htmlFor={`email-${contact.id}`}>
                            To
                          </label>
                          <input
                            id={`email-${contact.id}`}
                            type="email"
                            value={editDraft.email}
                            onChange={e => setEditDraft(d => (d ? { ...d, email: e.target.value } : d))}
                            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground/70" htmlFor={`subject-${contact.id}`}>
                            Subject
                          </label>
                          <input
                            id={`subject-${contact.id}`}
                            type="text"
                            value={editDraft.subject}
                            onChange={e => setEditDraft(d => (d ? { ...d, subject: e.target.value } : d))}
                            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground/70" htmlFor={`body-${contact.id}`}>
                            Body
                          </label>
                          <textarea
                            id={`body-${contact.id}`}
                            value={editDraft.body}
                            onChange={e => setEditDraft(d => (d ? { ...d, body: e.target.value } : d))}
                            rows={10}
                            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground whitespace-pre-wrap"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEditing(contact)} disabled={savingEdit}>
                            {savingEdit ? <Spinner className="size-3.5" /> : null}
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEditing} disabled={savingEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      !isSwitching && (
                        <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                          <div className="text-xs text-muted-foreground/70">
                            To: <span className="text-foreground">{contact.email}</span>
                          </div>
                          <div className="text-xs text-muted-foreground/70">
                            Subject: <span className="text-foreground font-medium">{generated.selected_subject_line}</span>
                          </div>
                          <p className="text-xs text-foreground whitespace-pre-wrap pt-2 border-t border-border/60">
                            <TypewriterText text={generated.email_draft.fullText} />
                          </p>
                          <Button size="sm" variant="outline" onClick={() => startEditing(contact)}>
                            Edit
                          </Button>
                        </div>
                      )
                    )
                  ) : (
                    !isDrafting && (
                      <div className="rounded-md border border-dashed border-border bg-background/50 p-3 space-y-2">
                        <p className="text-xs text-muted-foreground/60">No draft yet for this contact.</p>
                        <Button size="sm" variant="outline" onClick={() => void draftForContact(contact)}>
                          Draft Email
                        </Button>
                      </div>
                    )
                  )}

                  <AnimatePresence initial={false}>
                    {isExpanded && generated && (
                      <motion.div
                        variants={expandCollapse}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="overflow-hidden"
                      >
                        <div className="pt-2 border-t border-border space-y-3">
                          {otherSubjects.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground/70 mb-1">
                                Other subject line options (click to switch, redrafts the email to match):
                              </p>
                              <ul className="space-y-1">
                                {otherSubjects.map(s => (
                                  <li key={s}>
                                    <button
                                      type="button"
                                      disabled={isSwitching || isDrafting}
                                      onClick={() => switchSubject(contact.id, s)}
                                      className="w-full text-left text-xs rounded-md px-2 py-1.5 border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                                    >
                                      {s}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {generated.followups && generated.followups.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground/70 mb-1">Follow-up sequence:</p>
                              <div className="space-y-2">
                                {generated.followups.map(f => (
                                  <div key={f.sequence} className="rounded-md border border-border bg-background/50 p-2.5 space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-medium text-foreground">
                                        Follow-up {f.sequence}: {f.angle}
                                      </span>
                                      <Badge variant={urgencyBadgeVariant(f.urgency)} className="text-[10px]">
                                        {f.urgency}
                                      </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground/70">Subject: {f.subject}</p>
                                    <p className="text-xs text-foreground whitespace-pre-wrap">{f.body}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
