'use client'

// ============================================================
// Suppression List - /admin/outbound/suppression
// ============================================================
// Session 3 of the "Outreach Control Center" build. One list, one
// mechanism ("never send to this address again"), regardless of why -
// bounced/unsubscribed/manual are all the same underlying exclusion,
// enforced at the one real chokepoint every send already goes through
// (lib/outbound/sending/provider-factory.ts's sendEmail()), so an address
// added here is protected across every campaign, not just the one it came
// from.
//
// 'bounced' entries are added automatically - a real Gmail delivery-failure
// notice detected while checking replies (check-replies/route.ts) or right
// before sending a scheduled follow-up (process-followup.ts) adds the
// address here itself; there is no "mark as bounced" button on this page.
// 'unsubscribed'/'manual' are the two reasons an admin can add here by
// hand - e.g. a prospect replies "please remove me" and the reply itself
// isn't parsed for that (no NLP/keyword matching over reply content is
// planned - see the reply tracker's own scope notes once it exists), an
// SDR reads it and adds the address here manually.
// ============================================================

import { useState } from 'react'
import { Ban, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { GuideNote } from '@/components/ui/guide-note'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { useSuppressionList } from './useSuppressionList'

function reasonBadgeVariant(reason: string) {
  if (reason === 'bounced') return 'destructive' as const
  if (reason === 'unsubscribed') return 'secondary' as const
  return 'outline' as const
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function SuppressionListPage() {
  const { entries, loading, adding, removingId, addEntry, removeEntry } = useSuppressionList()

  const [email, setEmail] = useState('')
  const [reason, setReason] = useState<'unsubscribed' | 'manual'>('unsubscribed')
  const [detail, setDetail] = useState('')
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? entries.filter(e => e.email.toLowerCase().includes(search.trim().toLowerCase()))
    : entries

  async function handleAdd() {
    if (!email.trim()) return
    const ok = await addEntry(email.trim(), reason, detail.trim())
    if (ok) {
      setEmail('')
      setDetail('')
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Suppression List</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Bounced, unsubscribed, and manually excluded addresses - never sent to again.
        </p>
      </div>

      <GuideNote>
        <p>
          One list, one mechanism, regardless of why: bounces are added automatically when
          detected, unsubscribes and manual exclusions you add by hand below. An address here is
          protected across <strong>every</strong> campaign, not just the one it came from.
        </p>
      </GuideNote>

      <CollapsibleRow summary={<h2 className="text-sm font-semibold text-foreground">Add an Address</h2>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="suppress-email">Email</Label>
              <Input
                id="suppress-email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="suppress-reason">Reason</Label>
              <Select
                items={[
                  { value: 'unsubscribed', label: 'Unsubscribed' },
                  { value: 'manual', label: 'Manual' },
                ]}
                value={reason}
                onValueChange={value => setReason(value as 'unsubscribed' | 'manual')}
              >
                <SelectTrigger id="suppress-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unsubscribed">Unsubscribed</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="suppress-detail">Note (optional)</Label>
            <Input
              id="suppress-detail"
              placeholder="e.g. replied asking to be removed"
              value={detail}
              onChange={e => setDetail(e.target.value)}
            />
          </div>
          <Button size="sm" disabled={adding || !email.trim()} onClick={handleAdd}>
            {adding ? <Spinner className="size-3.5" /> : null}
            Add to Suppression List
          </Button>
      </CollapsibleRow>

      <Card className="border-border bg-card">
        <CardContent className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Suppressed ({entries.length})</h2>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <Input className="pl-8 h-8" placeholder="Filter by email…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Spinner className="size-4" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={Ban} title={entries.length === 0 ? 'No suppressed addresses yet' : 'No matches'} className="border-none py-6" />
          ) : (
            <div className="space-y-2">
              {filtered.map(entry => (
                <div key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground truncate">{entry.email}</span>
                      <Badge variant={reasonBadgeVariant(entry.reason)}>{entry.reason}</Badge>
                    </div>
                    {entry.detail && <p className="text-xs text-muted-foreground/70 mt-0.5">{entry.detail}</p>}
                    <p className="text-xs text-muted-foreground/50 mt-0.5">Added {formatDate(entry.created_at)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={removingId === entry.id}
                    onClick={() => removeEntry(entry.id, entry.email)}
                  >
                    {removingId === entry.id ? <Spinner className="size-3.5" /> : null}
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
