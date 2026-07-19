'use client'

// ============================================================
// GenerationPanel — Subject Lines / Email / Follow-ups for one contact
// ============================================================
// Self-contained: fetches its own outbound_generated_content row on mount,
// and owns the generate/approve/edit/regenerate actions for this contact.
// Kept out of useOutboundContacts.ts since this state is genuinely scoped
// to "one contact's panel is open", not the whole contacts list.
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

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

export function GenerationPanel({ contactId }: { contactId: string }) {
  const [generated, setGenerated] = useState<GeneratedContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'subjects' | 'email' | 'followups' | null>(null)
  const [editingEmail, setEditingEmail] = useState(false)
  const [editedFullText, setEditedFullText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`)
      const data = await res.json()
      if (data.success) setGenerated(data.generated)
    } catch {
      toast.error('Could not load generated content')
    } finally {
      setLoading(false)
    }
  }, [contactId])

  useEffect(() => {
    // Intentional fetch-on-dependency-change, not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function handleGenerateSubjects() {
    setBusy('subjects')
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-subject-lines`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to generate subject lines')
        return
      }
      setGenerated(data.generated)
      toast.success('Subject lines generated')
    } catch {
      toast.error('Could not reach the generation API')
    } finally {
      setBusy(null)
    }
  }

  async function handleSelectSubject(subject: string) {
    setGenerated(prev => (prev ? { ...prev, selected_subject_line: subject } : prev))
    try {
      await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_subject_line: subject }),
      })
    } catch {
      // non-fatal — selection stays local even if the save fails
    }
  }

  async function handleGenerateEmail() {
    if (!generated?.selected_subject_line) {
      toast.error('Pick a subject line first')
      return
    }
    setBusy('email')
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectLine: generated.selected_subject_line }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to generate email')
        return
      }
      setGenerated(data.generated)
      toast.success('Email generated')
    } catch {
      toast.error('Could not reach the generation API')
    } finally {
      setBusy(null)
    }
  }

  async function handleApprove() {
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      const data = await res.json()
      if (data.success) {
        setGenerated(data.generated)
        toast.success('Email approved')
      }
    } catch {
      toast.error('Could not reach the generation API')
    }
  }

  function startEditing() {
    setEditedFullText(generated?.email_draft?.fullText ?? '')
    setEditingEmail(true)
  }

  async function saveEdit() {
    if (!generated?.email_draft) return
    const updatedDraft = { ...generated.email_draft, fullText: editedFullText }
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generated-content`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_draft: updatedDraft }),
      })
      const data = await res.json()
      if (data.success) {
        setGenerated(data.generated)
        setEditingEmail(false)
        toast.success('Email updated')
      }
    } catch {
      toast.error('Could not reach the generation API')
    }
  }

  async function handleGenerateFollowups() {
    setBusy('followups')
    try {
      const res = await fetch(`/api/admin/outbound/contacts/${contactId}/generate-followups`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error ?? 'Failed to generate follow-ups')
        return
      }
      setGenerated(data.generated)
      toast.success('Follow-up sequence generated')
    } catch {
      toast.error('Could not reach the generation API')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Spinner className="size-3.5" /> Loading generated content…
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <Tabs defaultValue="subjects">
        <TabsList>
          <TabsTrigger value="subjects">Subject Lines</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="subjects" className="pt-3 space-y-2">
          <Button size="sm" variant="outline" disabled={busy === 'subjects'} onClick={handleGenerateSubjects}>
            {busy === 'subjects' ? <Spinner className="size-3.5" /> : null}
            {generated?.subject_lines?.length ? 'Regenerate' : 'Generate'} Subject Lines
          </Button>
          {generated?.subject_lines && generated.subject_lines.length > 0 && (
            <ul className="space-y-1">
              {generated.subject_lines.map(subject => (
                <li key={subject}>
                  <button
                    type="button"
                    onClick={() => handleSelectSubject(subject)}
                    className={`w-full text-left text-xs rounded-md px-2 py-1.5 border transition-colors ${
                      generated.selected_subject_line === subject
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {subject}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="email" className="pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'email' || !generated?.selected_subject_line}
              onClick={handleGenerateEmail}
            >
              {busy === 'email' ? <Spinner className="size-3.5" /> : null}
              {generated?.email_draft ? 'Regenerate' : 'Generate'} Email
            </Button>
            {!generated?.selected_subject_line && (
              <span className="text-xs text-muted-foreground/60">Select a subject line first</span>
            )}
          </div>

          {generated?.email_draft && (
            <div className="rounded-lg border border-border bg-background/50 p-3 space-y-2">
              {editingEmail ? (
                <>
                  <textarea
                    aria-label="Edit email draft"
                    value={editedFullText}
                    onChange={e => setEditedFullText(e.target.value)}
                    rows={8}
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveEdit}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingEmail(false)}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{generated.email_draft.fullText}</p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={startEditing}>Edit</Button>
                    <Button size="sm" disabled={generated.status === 'approved'} onClick={handleApprove}>
                      {generated.status === 'approved' ? 'Approved' : 'Approve'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="followups" className="pt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy === 'followups' || !generated?.email_draft}
              onClick={handleGenerateFollowups}
            >
              {busy === 'followups' ? <Spinner className="size-3.5" /> : null}
              {generated?.followups?.length ? 'Regenerate' : 'Generate'} Follow-ups
            </Button>
            {!generated?.email_draft && (
              <span className="text-xs text-muted-foreground/60">Generate the email first</span>
            )}
          </div>

          {generated?.followups && generated.followups.length > 0 && (
            <div className="space-y-2">
              {generated.followups.map(f => (
                <div key={f.sequence} className="rounded-lg border border-border bg-background/50 p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">Follow-up {f.sequence}: {f.angle}</span>
                    <Badge variant={urgencyBadgeVariant(f.urgency)}>{f.urgency}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/70">Subject: {f.subject}</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{f.body}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
