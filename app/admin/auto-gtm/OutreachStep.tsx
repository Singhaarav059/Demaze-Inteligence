'use client'

// ============================================================
// OutreachStep — Auto Flow's merged "Outreach & Send" step
// ============================================================
// Drafts each contact's outreach email automatically (subject lines -> pick
// the first -> full email -> follow-up sequence), then lets you review,
// edit, switch subject, regenerate, and send — all from one screen.
// Previously this was two separate steps (Outreach: drafting only; Review &
// Send: sending only) — merged into one per explicit user request
// (2026-07-31): drafting and sending are one continuous action here, not
// two different destinations to navigate between. Master-detail layout
// (contact list left, full draft + send controls right) carried over from
// the old Review & Send step; auto-drafting/regenerate/switch-subject logic
// carried over from the old Outreach step. Both send paths (per-contact
// "Send Email", multi-select "Send Selected") are built on useAutoGtmFlow's
// sendOneContact/sendSelectedContacts, driving the existing sending
// infrastructure under the hood — "campaign" is never a word used in this
// UI. Freshly generated draft text types in word by word via
// TypewriterText instead of popping in fully formed.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { InfoTooltip } from '@/components/ui/tooltip'
import { TypewriterText } from '@/components/ui/typewriter-text'
import { expandCollapse } from '@/lib/motion'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'

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

interface SendOutcomeDetail {
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

interface EditDraft {
  email: string
  subject: string
  body: string
}

// What's pending confirmation, if anything — a single piece of state covers
// both "Send Selected" and a per-contact "Send Email" so only one
// ConfirmDialog is ever rendered at a time (see CLAUDE.md's standing rule
// that sending real email always requires per-batch confirmation once real
// send infrastructure exists).
type PendingSend =
  | { kind: 'selected'; contactIds: string[]; count: number }
  | { kind: 'one'; contactId: string; name: string }
  | null

type DraftStage = 'subjects' | 'email' | 'followups'

function urgencyBadgeVariant(urgency: FollowupDraft['urgency']) {
  if (urgency === 'high') return 'destructive' as const
  if (urgency === 'medium') return 'secondary' as const
  return 'outline' as const
}

function sendStatusBadgeVariant(status: SendOutcomeDetail['status']) {
  if (status === 'sent') return 'default' as const
  if (status === 'skipped') return 'secondary' as const
  return 'destructive' as const
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
  contacts,
  campaignContactStatus,
  sendingContactId,
  sendingSelected,
  sendOneContact,
  sendSelectedContacts,
  updateContactEmail,
}: {
  contacts: OutboundContact[]
  campaignContactStatus: Record<string, SendOutcomeDetail>
  sendingContactId: string | null
  sendingSelected: boolean
  sendOneContact: (contactId: string) => Promise<void>
  sendSelectedContacts: (contactIds: string[]) => Promise<void>
  updateContactEmail: (contactId: string, email: string) => Promise<boolean>
}) {
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
  const [pendingSend, setPendingSend] = useState<PendingSend>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Was hardcoded 'Demo mode' regardless of the actually-active sending
  // provider — null while loading = treated as mock (safe default: don't
  // imply "real" before we've confirmed it).
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)
  // Which contact's full draft is shown in the detail pane (right side of
  // the split view).
  const [activeContactId, setActiveContactId] = useState<string | null>(null)
  // Typed-in email for a no-email contact's manual "add email & draft"
  // override — scoped to whichever contact is active, cleared on switch.
  const [manualEmail, setManualEmail] = useState('')

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

        // A contact with no email will be skipped when sending anyway (see
        // the "will be skipped when sending" badge below) — auto-drafting
        // for one still burns 3 real AI calls (subjects/email/followups)
        // for content that can't be sent yet. Skip the AI calls entirely;
        // still check for an already-existing draft (e.g. from before an
        // email was removed, or drafted manually via draftForContact below)
        // so it isn't silently thrown away.
        if (!contact.email) {
          const existing = await fetchGenerated(contact.id)
          setDrafts(prev => ({ ...prev, [contact.id]: existing }))
          continue
        }

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

  // Manual override for a no-email contact: save the typed-in email, then
  // draft for real. The only way to get an email onto such a contact today
  // (Contact Info's automatic finder already ran and came up empty) is to
  // type one in here.
  const draftForContact = useCallback(
    async (contact: OutboundContact, email?: string) => {
      if (email) {
        const ok = await updateContactEmail(contact.id, email)
        if (!ok) return
      }
      beginDrafting(contact.id)
      try {
        const generated = await autoDraft(contact.id, stage => setContactDraftingStage(contact.id, stage))
        setDrafts(prev => ({ ...prev, [contact.id]: generated }))
      } catch {
        toast.error(`Could not draft an email for ${contact.person_name}`)
      } finally {
        endDrafting(contact.id)
      }
    },
    [updateContactEmail]
  )

  useEffect(() => {
    // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void draftMissing()
    // Deliberately keyed on the joined contact-id list, not `contacts`/
    // `draftMissing` — this should only re-run when the set of contacts
    // actually changes, not on every drafts-state update draftMissing itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.map(c => c.id).join(',')])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void (async () => {
      try {
        const res = await fetch('/api/admin/outbound/integrations')
        const data = await res.json()
        if (!data.success) return
        const sendingRow = (data.integrations as OutboundIntegrationRow[]).find(
          row => row.capability === 'sending' && row.is_active
        )
        setSendingProviderName(sendingRow?.provider_name ?? 'mock')
      } catch {
        setSendingProviderName('mock')
      }
    })()
  }, [])

  const isRealSendingProvider = sendingProviderName !== null && sendingProviderName !== 'mock'

  const readyToSend = useMemo(
    () => contacts.filter(c => c.email && drafts[c.id]?.email_draft && campaignContactStatus[c.id]?.status !== 'sent'),
    [contacts, drafts, campaignContactStatus]
  )
  const readyIds = useMemo(() => new Set(readyToSend.map(c => c.id)), [readyToSend])

  // Selection never holds an id that's no longer ready to send (e.g. it
  // just got marked 'sent' by a prior send) — pruned defensively rather
  // than trusted to stay in sync with readyIds on its own.
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => readyIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [readyIds])

  // Default the detail pane to the first contact, and fall back to another
  // one if the currently-active contact disappears from the list.
  useEffect(() => {
    setActiveContactId(prev => {
      if (prev && contacts.some(c => c.id === prev)) return prev
      return contacts[0]?.id ?? null
    })
  }, [contacts])

  function selectContact(contactId: string) {
    if (contactId !== activeContactId) {
      cancelEditing()
      setManualEmail('')
    }
    setActiveContactId(contactId)
  }

  function toggleSelected(contactId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => (prev.size === readyToSend.length ? new Set() : new Set(readyIds)))
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Outreach &amp; Send
            {isRealSendingProvider ? (
              <Badge variant="destructive" className="text-[10px]">
                Live: {sendingProviderName}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Demo mode</Badge>
            )}
            <InfoTooltip>
              Each draft is a real AI call and can take a minute or two per contact, this isn&apos;t stuck, it&apos;s
              thinking.{' '}
              {isRealSendingProvider
                ? `A real sending provider (${sendingProviderName}) is connected. Send Email / Send Selected will send real emails to real recipients.`
                : "No real email leaves the app yet, a real sending service hasn't been connected. Once one is, this same button sends for real."}
            </InfoTooltip>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Drafted automatically below. Edit, switch subject, regenerate, or send straight from here.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline">
            {readyCount} of {contacts.length} drafted
          </Badge>
          <Button
            size="lg"
            disabled={sendingSelected || selectedIds.size === 0}
            onClick={() => setPendingSend({ kind: 'selected', contactIds: [...selectedIds], count: selectedIds.size })}
          >
            {sendingSelected ? <Spinner className="size-3.5" /> : null}
            Send Selected ({selectedIds.size})
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-4">No contacts to draft for.</p>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col md:flex-row">
          {/* Left: compact contact list — click a row to preview its draft on the right */}
          <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-border">
            {readyToSend.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground/70 px-3 py-2 border-b border-border">
                <input
                  type="checkbox"
                  checked={selectedIds.size === readyToSend.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all ready contacts"
                />
                Select all ({readyToSend.length} ready)
              </label>
            )}
            <div className="max-h-[560px] overflow-y-auto divide-y divide-border">
              {contacts.map(contact => {
                const generated = drafts[contact.id]
                const outcome = campaignContactStatus[contact.id]
                const isReady = readyIds.has(contact.id)
                const isActive = activeContactId === contact.id
                const isDraftingThis = draftingIds.has(contact.id) && !generated?.email_draft

                return (
                  <div
                    key={contact.id}
                    className={`flex items-center gap-2 px-3 py-2 ${isActive ? 'bg-accent' : 'hover:bg-accent/40'}`}
                  >
                    {isReady && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleSelected(contact.id)}
                        aria-label={`Select ${contact.person_name}`}
                      />
                    )}
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
                          {outcome && (
                            <Badge variant={sendStatusBadgeVariant(outcome.status)} className="text-[9px] px-1 py-0">
                              {outcome.status}
                            </Badge>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70 truncate">
                          {contact.title_hint || contact.email || 'No email'}
                        </span>
                        {isDraftingThis && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <Spinner className="size-2.5" /> drafting…
                          </span>
                        )}
                        {!generated?.email_draft && !isDraftingThis && (
                          <span className="block text-[10px] text-muted-foreground/50">
                            {contact.email ? 'no draft' : 'no email — drafting skipped'}
                          </span>
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
              const outcome = campaignContactStatus[contact.id]
              const isSending = sendingContactId === contact.id
              const canSend = Boolean(contact.email && generated?.email_draft) && outcome?.status !== 'sent'
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
                        {outcome && <Badge variant={sendStatusBadgeVariant(outcome.status)}>{outcome.status}</Badge>}
                        {!contact.email && <Badge variant="outline">no email, will be skipped when sending</Badge>}
                      </div>
                      {outcome?.reason && <p className="text-xs text-muted-foreground/60 mt-0.5">{outcome.reason}</p>}
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canSend || isSending}
                        onClick={() => setPendingSend({ kind: 'one', contactId: contact.id, name: contact.person_name })}
                      >
                        {isSending ? <Spinner className="size-3.5" /> : null}
                        {outcome?.status === 'sent' ? 'Sent' : 'Send Email'}
                      </Button>
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
                            To: <span className="text-foreground">{contact.email ?? 'No email, will be skipped'}</span>
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
                    !isDrafting &&
                    (!contact.email ? (
                      <div className="rounded-md border border-dashed border-border bg-background/50 p-3 space-y-2">
                        <p className="text-xs text-muted-foreground/60">
                          No email on file for this contact, so drafting was skipped to avoid spending AI credits on
                          an email that can&apos;t be sent yet. Add one below to draft it.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={manualEmail}
                            onChange={e => setManualEmail(e.target.value)}
                            placeholder="name@company.com"
                            aria-label={`Email for ${contact.person_name}`}
                            className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
                          />
                          <Button
                            size="sm"
                            disabled={!manualEmail.trim()}
                            onClick={() => void draftForContact(contact, manualEmail.trim())}
                          >
                            Save &amp; Draft
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border bg-background/50 p-3 space-y-2">
                        <p className="text-xs text-muted-foreground/60">No draft yet for this contact.</p>
                        <Button size="sm" variant="outline" onClick={() => void draftForContact(contact)}>
                          Draft Email
                        </Button>
                      </div>
                    ))
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

      <ConfirmDialog
        open={pendingSend !== null}
        onOpenChange={open => { if (!open) setPendingSend(null) }}
        title={pendingSend?.kind === 'selected' ? `Send to ${pendingSend.count} contact${pendingSend.count === 1 ? '' : 's'}?` : 'Send this email?'}
        description={
          pendingSend?.kind === 'selected'
            ? `Sends the drafted email to the ${pendingSend.count} selected contact${pendingSend.count === 1 ? '' : 's'}. ${
                isRealSendingProvider
                  ? `This is a REAL send via ${sendingProviderName} — real emails will go out.`
                  : 'Mock sending only, no real email goes out yet.'
              }`
            : `Sends the drafted email to ${pendingSend?.kind === 'one' ? pendingSend.name : ''}. ${
                isRealSendingProvider
                  ? `This is a REAL send via ${sendingProviderName} — a real email will go out.`
                  : 'Mock sending only, no real email goes out yet.'
              }`
        }
        confirmLabel={pendingSend?.kind === 'selected' ? 'Send Selected' : 'Send'}
        loading={pendingSend?.kind === 'selected' ? sendingSelected : sendingContactId === (pendingSend?.kind === 'one' ? pendingSend.contactId : null)}
        onConfirm={() => {
          if (pendingSend?.kind === 'selected') {
            void sendSelectedContacts(pendingSend.contactIds).then(() => {
              setSelectedIds(new Set())
              setPendingSend(null)
            })
          } else if (pendingSend?.kind === 'one') {
            void sendOneContact(pendingSend.contactId).then(() => setPendingSend(null))
          }
        }}
      />
    </div>
  )
}
