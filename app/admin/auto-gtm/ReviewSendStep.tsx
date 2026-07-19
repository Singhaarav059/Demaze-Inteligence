'use client'

// ============================================================
// ReviewSendStep — Auto Flow's final "Review & Send" step
// ============================================================
// Fetches each contact's already-generated content on mount (persisted
// server-side by OutreachStep, so nothing needs to survive the step 4->5
// unmount) and shows the full picture — contact, email, phone, selected
// subject, full email body, full follow-up sequence — plus the only two
// actions this step exposes: Send Email (one contact) and Send All. Both
// are built on useAutoGtmFlow's sendOneContact/sendAllContacts, which
// drive the existing (mock-only) sending infrastructure under the hood —
// "campaign" is never a word used in this UI.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { InfoTooltip } from '@/components/ui/tooltip'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'

// What's pending confirmation, if anything — a single piece of state covers
// both "Send All" and a per-contact "Send Email" so only one ConfirmDialog
// is ever rendered at a time (2026-07-19 fix: neither action had ANY
// confirmation before this — see CLAUDE.md's standing rule that sending
// real email always requires per-batch confirmation once real send
// infrastructure exists; building the confirm UX now means it's already in
// place when that happens, not bolted on later).
type PendingSend = { kind: 'all'; count: number } | { kind: 'one'; contactId: string; name: string } | null

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

export function ReviewSendStep({
  contacts,
  campaignContactStatus,
  sendingContactId,
  sendingAll,
  sendOneContact,
  sendAllContacts,
}: {
  contacts: OutboundContact[]
  campaignContactStatus: Record<string, SendOutcomeDetail>
  sendingContactId: string | null
  sendingAll: boolean
  sendOneContact: (contactId: string) => Promise<void>
  sendAllContacts: () => Promise<void>
}) {
  const [generatedByContact, setGeneratedByContact] = useState<Record<string, GeneratedContent | null>>({})
  const [loading, setLoading] = useState(true)
  const [pendingSend, setPendingSend] = useState<PendingSend>(null)

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

  const readyToSend = contacts.filter(
    c => c.email && generatedByContact[c.id]?.email_draft && campaignContactStatus[c.id]?.status !== 'sent'
  )

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Review &amp; Send
            <Badge variant="secondary" className="text-[10px]">Demo mode</Badge>
            <InfoTooltip>
              No real email leaves the app yet, a real sending service (like Smartlead or Instantly)
              hasn&apos;t been connected. Once one is, this same button sends for real.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">Final read-through before sending.</p>
        </div>
        <Button
          size="lg"
          disabled={sendingAll || readyToSend.length === 0}
          onClick={() => setPendingSend({ kind: 'all', count: readyToSend.length })}
        >
          {sendingAll ? <Spinner className="size-3.5" /> : null}
          Send All ({readyToSend.length})
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Spinner className="size-4" /> Loading drafts…
        </div>
      ) : (
        <div className="space-y-3">
          {contacts.map(contact => {
            const generated = generatedByContact[contact.id]
            const outcome = campaignContactStatus[contact.id]
            const isSending = sendingContactId === contact.id
            const canSend = Boolean(contact.email && generated?.email_draft) && outcome?.status !== 'sent'

            return (
              <div key={contact.id} className="rounded-lg border border-border bg-card px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{contact.person_name}</span>
                      {contact.title_hint && (
                        <span className="text-xs text-muted-foreground/70">{contact.title_hint}</span>
                      )}
                      {outcome && <Badge variant={sendStatusBadgeVariant(outcome.status)}>{outcome.status}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground/70 mt-0.5">
                      {contact.email ?? 'No email, will be skipped'} · Phone: Not Available
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
                  <div className="rounded-md border border-border bg-background/50 p-3 space-y-1">
                    <p className="text-xs text-foreground whitespace-pre-wrap">
                      <span className="text-muted-foreground/70">Subject: </span>
                      {generated.selected_subject_line}
                      {'\n\n'}
                      {generated.email_draft.fullText}
                    </p>
                  </div>
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
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingSend !== null}
        onOpenChange={open => { if (!open) setPendingSend(null) }}
        title={pendingSend?.kind === 'all' ? `Send to ${pendingSend.count} contact${pendingSend.count === 1 ? '' : 's'}?` : 'Send this email?'}
        description={
          pendingSend?.kind === 'all'
            ? `Sends the drafted email to all ${pendingSend.count} ready contacts. Mock sending only, no real email goes out yet.`
            : `Sends the drafted email to ${pendingSend?.kind === 'one' ? pendingSend.name : ''}. Mock sending only, no real email goes out yet.`
        }
        confirmLabel={pendingSend?.kind === 'all' ? 'Send All' : 'Send'}
        loading={pendingSend?.kind === 'all' ? sendingAll : sendingContactId === (pendingSend?.kind === 'one' ? pendingSend.contactId : null)}
        onConfirm={() => {
          if (pendingSend?.kind === 'all') void sendAllContacts().then(() => setPendingSend(null))
          else if (pendingSend?.kind === 'one') void sendOneContact(pendingSend.contactId).then(() => setPendingSend(null))
        }}
      />
    </div>
  )
}
