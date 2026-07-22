'use client'

// ============================================================
// ContactRow — single contact card with Find Email / Enrich /
// Outreach / Delete actions. Email validation was removed (2026-07-19,
// mock-only capability, no real vendor decision made) rather than left
// on mock data.
// ============================================================
// Extracted out of contacts/page.tsx so it can also be reused by the
// Auto Flow guided-flow page (app/admin/auto-gtm) for its Enrich
// and Prepare Outreach steps — this one component already covers both.
// ============================================================

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { GenerationPanel } from './GenerationPanel'
import type { OutboundContact } from './useOutboundContacts'

function emailConfidenceBadgeVariant(confidence: OutboundContact['email_confidence']) {
  if (confidence === 'high') return 'default' as const
  if (confidence === 'medium' || confidence === 'low') return 'secondary' as const
  return 'outline' as const
}

interface EnrichmentData {
  department?: string
  seniority?: string
  location?: string
  roleCategory?: string
  linkedinSummary?: string
  companySize?: string
  industry?: string
}

function EnrichmentPanel({ enrichment }: { enrichment: EnrichmentData }) {
  const fields: Array<[string, string | undefined]> = [
    ['Department', enrichment.department],
    ['Seniority', enrichment.seniority],
    ['Location', enrichment.location],
    ['Role category', enrichment.roleCategory],
    ['Company size', enrichment.companySize],
    ['Industry', enrichment.industry],
  ]
  return (
    <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-1.5">
      {fields
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="text-xs">
            <span className="text-muted-foreground/70">{label}: </span>
            <span className="text-foreground">{value}</span>
          </div>
        ))}
      {enrichment.linkedinSummary && (
        <p className="col-span-2 text-xs text-muted-foreground/80 mt-1">{enrichment.linkedinSummary}</p>
      )}
    </div>
  )
}

export function ContactRow({
  contact,
  pending,
  expanded,
  onToggleExpanded,
  onFindEmail,
  onEnrich,
  onDelete,
  showOutreach = true,
}: {
  contact: OutboundContact
  pending: 'find-email' | 'enrich' | 'delete' | undefined
  expanded: boolean
  onToggleExpanded: () => void
  onFindEmail: () => void
  onEnrich: () => void
  onDelete: () => void
  // Auto Flow hides this — outreach drafting has its own dedicated
  // Email step there instead of living inline per-row (default true, for
  // the standalone Contacts page).
  showOutreach?: boolean
}) {
  const enrichment = contact.enrichment as EnrichmentData | null
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <Card className="border-border bg-card">
      <CardContent className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate">{contact.person_name}</span>
              {contact.title_hint && (
                <span className="text-xs text-muted-foreground/70 truncate">{contact.title_hint}</span>
              )}
            </div>
            {contact.discovery_source === 'decision_maker_discovery' && (
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                via {contact.discovery_provider ?? 'unknown'} decision-maker discovery
                {contact.discovery_confidence ? `, ${contact.discovery_confidence} confidence` : ''}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {contact.email ? (
                <>
                  <span className="text-xs text-muted-foreground truncate">{contact.email}</span>
                  <Badge variant={emailConfidenceBadgeVariant(contact.email_confidence)}>
                    {contact.email_confidence}
                  </Badge>
                </>
              ) : contact.email_finder_status === 'not_found' ? (
                <Badge variant="outline">not found</Badge>
              ) : contact.email_finder_status === 'error' ? (
                <Badge variant="destructive">error</Badge>
              ) : (
                <span className="text-xs text-muted-foreground/50">No email looked up yet</span>
              )}
              {contact.enrichment_status !== 'pending' && (
                <Badge variant="secondary">{contact.enrichment_status}</Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" disabled={pending === 'find-email'} onClick={onFindEmail}>
              {pending === 'find-email' ? <Spinner className="size-3.5" /> : null}
              Find Email
            </Button>
            <Button variant="outline" size="sm" disabled={pending === 'enrich'} onClick={onEnrich}>
              {pending === 'enrich' ? <Spinner className="size-3.5" /> : null}
              Enrich
            </Button>
            {(showOutreach || enrichment) && (
              <Button variant="ghost" size="sm" onClick={onToggleExpanded}>
                {expanded ? 'Hide' : showOutreach ? 'Outreach' : 'Details'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={pending === 'delete'}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              {pending === 'delete' ? <Spinner className="size-3.5" /> : null}
              Delete
            </Button>
          </div>
        </div>
        {expanded && enrichment && <EnrichmentPanel enrichment={enrichment} />}
        {expanded && showOutreach && <GenerationPanel contactId={contact.id} />}
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${contact.person_name}?`}
        description="This can't be undone. It also removes any generated outreach draft and campaign send history for this contact."
        confirmLabel="Delete"
        destructive
        loading={pending === 'delete'}
        onConfirm={() => { onDelete(); setConfirmDelete(false) }}
      />
    </Card>
  )
}
