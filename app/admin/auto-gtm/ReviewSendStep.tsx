'use client'

// ============================================================
// ReviewSendStep — Auto Flow's final "Review & Send" step
// ============================================================
// Fetches each contact's already-generated content on mount (persisted
// server-side by OutreachStep, so nothing needs to survive the step 4->5
// unmount) and shows the full picture — contact, email, phone, selected
// subject, full email body, full follow-up sequence — plus this step's
// actions: per-contact inline editing (subject/body/recipient email),
// Send Email (one contact), and checkbox multi-select + Send Selected
// (2026-07-29 redesign — replaces the old unconditional "Send All", see
// docs/CURRENT_TASK.md's queued Review & Send redesign items 1 and 3).
// Both send paths are built on useAutoGtmFlow's sendOneContact/
// sendSelectedContacts, which drive the existing sending infrastructure
// under the hood — "campaign" is never a word used in this UI.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { InfoTooltip } from '@/components/ui/tooltip'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'
import type { OutboundIntegrationRow } from '@/lib/outbound/settings/types'

// What's pending confirmation, if anything — a single piece of state covers
// both "Send Selected" and a per-contact "Send Email" so only one
// ConfirmDialog is ever rendered at a time (2026-07-19 fix: neither action
// had ANY confirmation before this — see CLAUDE.md's standing rule that
// sending real email always requires per-batch confirmation once real send
// infrastructure exists; building the confirm UX now means it's already in
// place when that happens, not bolted on later).
type PendingSend =
  | { kind: 'selected'; contactIds: string[]; count: number }
  | { kind: 'one'; contactId: string; name: string }
  | null

interface EmailDraft {
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
  selected_subject_line: string | null
  email_draft: EmailDraft | null
  followups: FollowupDraft[] | null
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

async function fetchGenerated(contactId: string): Promise<GeneratedContent | null> {
  try {
    const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`)
    const data = await res.json()
    return data.success ? data.generated : null
  } catch {
    return null
  }
}

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

export function ReviewSendStep({
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
  const [generatedByContact, setGeneratedByContact] = useState<Record<string, GeneratedContent | null>>({})
  const [loading, setLoading] = useState(true)
  const [pendingSend, setPendingSend] = useState<PendingSend>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingContactId, setEditingContactId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  // Was hardcoded 'Demo mode' regardless of the actually-active sending
  // provider — a real bug once a real vendor (e.g. Gmail) is connected, since
  // the confirm dialog's "Mock sending only, no real email goes out yet"
  // text would then be actively false at the exact moment someone clicks
  // Send. null while loading = treated as mock (safe default: don't imply
  // "real" before we've confirmed it).
  const [sendingProviderName, setSendingProviderName] = useState<string | null>(null)
  // Which contact's full draft is shown in the detail pane (right side of the
  // split view) — mirrors a master-detail layout (contact list left, full
  // email preview right) instead of the old one-card-per-contact stacked list.
  const [activeContactId, setActiveContactId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const entries = await Promise.all(
      contacts.map(async contact => [contact.id, await fetchGenerated(contact.id)] as const)
    )
    setGeneratedByContact(Object.fromEntries(entries))
    setLoading(false)
  }, [contacts])

  useEffect(() => {
    // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll()
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
    () =>
      contacts.filter(
        c => c.email && generatedByContact[c.id]?.email_draft && campaignContactStatus[c.id]?.status !== 'sent'
      ),
    [contacts, generatedByContact, campaignContactStatus]
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
    if (contactId !== activeContactId) cancelEditing()
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

  function startEditing(contact: OutboundContact) {
    const generated = generatedByContact[contact.id]
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
      const generated = generatedByContact[contact.id]
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
              setGeneratedByContact(prev => ({
                ...prev,
                [contact.id]: {
                  selected_subject_line: data.generated.selected_subject_line,
                  email_draft: data.generated.email_draft,
                  followups: prev[contact.id]?.followups ?? null,
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

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Review &amp; Send
            {isRealSendingProvider ? (
              <Badge variant="destructive" className="text-[10px]">
                Live: {sendingProviderName}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">Demo mode</Badge>
            )}
            <InfoTooltip>
              {isRealSendingProvider
                ? `A real sending provider (${sendingProviderName}) is connected. Send Email / Send Selected will send real emails to real recipients.`
                : "No real email leaves the app yet, a real sending service hasn't been connected. Once one is, this same button sends for real."}
            </InfoTooltip>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">Final read-through before sending.</p>
        </div>
        <Button
          size="lg"
          disabled={sendingSelected || selectedIds.size === 0}
          onClick={() => setPendingSend({ kind: 'selected', contactIds: [...selectedIds], count: selectedIds.size })}
        >
          {sendingSelected ? <Spinner className="size-3.5" /> : null}
          Send Selected ({selectedIds.size})
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading drafts…
        </div>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 py-4">No contacts to review.</p>
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
                const generated = generatedByContact[contact.id]
                const outcome = campaignContactStatus[contact.id]
                const isReady = readyIds.has(contact.id)
                const isActive = activeContactId === contact.id

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
                        {!generated?.email_draft && (
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

              const generated = generatedByContact[contact.id]
              const outcome = campaignContactStatus[contact.id]
              const isSending = sendingContactId === contact.id
              const canSend = Boolean(contact.email && generated?.email_draft) && outcome?.status !== 'sent'
              const isEditing = editingContactId === contact.id

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
                      </div>
                      {outcome?.reason && <p className="text-xs text-muted-foreground/60 mt-0.5">{outcome.reason}</p>}
                    </div>
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
                      <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                        <div className="text-xs text-muted-foreground/70">
                          To: <span className="text-foreground">{contact.email ?? 'No email, will be skipped'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground/70">
                          Subject: <span className="text-foreground font-medium">{generated.selected_subject_line}</span>
                        </div>
                        <p className="text-xs text-foreground whitespace-pre-wrap pt-2 border-t border-border/60">
                          {generated.email_draft.fullText}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => startEditing(contact)}>
                          Edit
                        </Button>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-muted-foreground/60">
                      No draft yet for this contact. Go back to Outreach to draft one.
                    </p>
                  )}

                  {generated?.followups && generated.followups.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground/70">Follow-up sequence:</p>
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
                  )}
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
