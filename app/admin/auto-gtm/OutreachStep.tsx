'use client'

// ============================================================
// OutreachStep — auto-drafted outreach email per contact, for Auto Flow's
// "Outreach" step
// ============================================================
// Explee-style simplification of GenerationPanel's three manual tabs
// (Subject Lines / Email / Follow-ups): instead of requiring a click per
// tab per contact, this runs all three generation calls automatically,
// picks the first (already relevance-ordered) subject line, and shows the
// finished draft directly. Alternate subject lines are clickable (switching
// regenerates the email + follow-ups from the new subject so everything
// stays consistent) and the full follow-up sequence is visible under
// "Details" — there is no Generate button anywhere in this step, only an
// optional "Regenerate" to redraft from scratch. Same generated_content row
// and API routes GenerationPanel already uses, no new backend needed.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { InfoTooltip } from '@/components/ui/tooltip'
import { expandCollapse } from '@/lib/motion'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'

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
  contact_id: string
  subject_lines: string[] | null
  selected_subject_line: string | null
  email_draft: EmailDraft | null
  followups: FollowupDraft[] | null
  status: 'draft' | 'approved' | 'sent'
}

function urgencyBadgeVariant(urgency: FollowupDraft['urgency']) {
  if (urgency === 'high') return 'destructive' as const
  if (urgency === 'medium') return 'secondary' as const
  return 'outline' as const
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

type DraftStage = 'subjects' | 'email' | 'followups'

// One automatic pass: subject lines -> auto-pick the first (already
// ordered by relevance, same assumption GenerationPanel's list implicitly
// makes) -> email from that subject -> follow-up sequence. Mirrors what a
// person would otherwise do across three manual tab clicks.
//
// Each of these 3 calls goes through the real AI provider chain
// (lib/ai/provider-factory.ts) and has been observed taking ~30-60s with
// the current active model (NVIDIA NIM nemotron-3-ultra-550b) — this is
// not instant, so onStage lets the caller show which of the 3 calls is in
// flight instead of one opaque "drafting" spinner for a minute or more.
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
// sequence from it, so what's shown always stays internally consistent
// (an alternate subject with the old body would read like a mismatch).
// Reuses the same PATCH + generate-email + generate-followups calls
// GenerationPanel's manual tabs already make, just chained automatically.
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

export function OutreachStep({ contacts }: { contacts: OutboundContact[] }) {
  const [drafts, setDrafts] = useState<Record<string, GeneratedContent | null>>({})
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [draftingStage, setDraftingStage] = useState<DraftStage | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedText, setEditedText] = useState('')

  const draftMissing = useCallback(async () => {
    for (const contact of contacts) {
      if (contact.id in drafts) continue
      setDraftingId(contact.id)
      setDraftingStage(null)
      try {
        const existing = await fetchGenerated(contact.id)
        const generated = existing?.email_draft ? existing : await autoDraft(contact.id, setDraftingStage)
        setDrafts(prev => ({ ...prev, [contact.id]: generated }))
      } catch {
        toast.error(`Could not draft an email for ${contact.person_name}`)
        setDrafts(prev => ({ ...prev, [contact.id]: null }))
      }
    }
    setDraftingId(null)
    setDraftingStage(null)
  }, [contacts, drafts])

  useEffect(() => {
    // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void draftMissing()
    // Deliberately keyed on the joined contact-id list, not `contacts`/
    // `draftMissing` — this should only re-run when the set of contacts
    // actually changes, not on every drafts-state update draftMissing itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.map(c => c.id).join(',')])

  async function regenerate(contactId: string) {
    setDraftingId(contactId)
    setDraftingStage(null)
    try {
      const generated = await autoDraft(contactId, setDraftingStage)
      setDrafts(prev => ({ ...prev, [contactId]: generated }))
    } catch {
      toast.error('Could not regenerate this email')
    } finally {
      setDraftingId(null)
      setDraftingStage(null)
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
    setEditedText(drafts[contact.id]?.email_draft?.fullText ?? '')
    setEditingId(contact.id)
  }

  async function saveEdit(contactId: string) {
    const current = drafts[contactId]?.email_draft
    if (!current) return
    const updatedDraft = { ...current, fullText: editedText }
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_draft: updatedDraft }),
      })
      const data = await res.json()
      if (data.success) {
        setDrafts(prev => ({ ...prev, [contactId]: data.generated }))
        setEditingId(null)
        toast.success('Email updated')
      }
    } catch {
      toast.error('Could not save the edit')
    }
  }

  const readyCount = contacts.filter(c => drafts[c.id]?.email_draft).length

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Outreach
            <InfoTooltip>
              Each draft is a real AI call and can take a minute or two per contact, this isn&apos;t
              stuck, it&apos;s thinking.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Drafted automatically below. Edit, switch subject, or regenerate anytime.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {readyCount} of {contacts.length} ready
        </Badge>
      </div>

      <div className="space-y-2">
        {contacts.map(contact => {
          const generated = drafts[contact.id]
          const isDrafting = draftingId === contact.id
          const isSwitching = switchingId === contact.id
          const isExpanded = expandedIds.has(contact.id)
          const isEditing = editingId === contact.id
          const otherSubjects = (generated?.subject_lines ?? []).filter(s => s !== generated?.selected_subject_line)

          return (
            <div key={contact.id} className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground">{contact.person_name}</span>
                  {contact.title_hint && (
                    <span className="text-xs text-muted-foreground/70 ml-2">{contact.title_hint}</span>
                  )}
                  {!contact.email && (
                    <Badge variant="outline" className="ml-2">
                      no email, will be skipped when sending
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {generated?.email_draft && (
                    <Button size="sm" variant="ghost" onClick={() => toggleExpanded(contact.id)}>
                      {isExpanded ? 'Hide' : 'Details'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" disabled={isDrafting || isSwitching} onClick={() => regenerate(contact.id)}>
                    {isDrafting ? <Spinner className="size-3.5" /> : null}
                    Regenerate
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

              {generated?.email_draft && !isEditing && !isSwitching && (
                <div className="rounded-md border border-border bg-background/50 p-3 space-y-2">
                  <p className="text-xs text-foreground whitespace-pre-wrap">
                    <span className="text-muted-foreground/70">Subject: </span>
                    {generated.selected_subject_line}
                    {'\n\n'}
                    {generated.email_draft.fullText}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => startEditing(contact)}>
                    Edit
                  </Button>
                </div>
              )}

              {isEditing && (
                <div className="space-y-2">
                  <textarea
                    aria-label="Edit email draft"
                    value={editedText}
                    onChange={e => setEditedText(e.target.value)}
                    rows={8}
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveEdit(contact.id)}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
