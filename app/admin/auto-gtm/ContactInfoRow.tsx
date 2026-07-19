'use client'

// ============================================================
// ContactInfoRow — read-only contact-info status card for Auto Flow's
// Contact Information step
// ============================================================
// Deliberately has zero action buttons for the discovery itself (no Find
// Email / Enrich / Validate) — email/LinkedIn lookup happens automatically
// via ContactInfoStep's effect before this ever renders a result, this
// component only displays whatever the contact row currently holds. The one
// action here (Remove) is an undo/escape hatch, not a trigger for more
// automation.
// ============================================================

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'

function emailConfidenceBadgeVariant(confidence: OutboundContact['email_confidence']) {
  if (confidence === 'high') return 'default' as const
  if (confidence === 'medium' || confidence === 'low') return 'secondary' as const
  return 'outline' as const
}

function StatusLine({ children, found }: { children: React.ReactNode; found: boolean | null }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={found === true ? 'text-signal-strong' : 'text-muted-foreground/50'}>
        {found === true ? '✓' : found === false ? '✕' : ''}
      </span>
      <span className={found === true ? 'text-foreground' : 'text-muted-foreground/70'}>{children}</span>
    </div>
  )
}

export function ContactInfoRow({
  contact,
  lookingUpEmail,
  removing,
  onRemove,
}: {
  contact: OutboundContact
  lookingUpEmail: boolean
  removing: boolean
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{contact.person_name}</span>
            {contact.title_hint && (
              <span className="text-xs text-muted-foreground/70 truncate">{contact.title_hint}</span>
            )}
          </div>
          {contact.discovery_source === 'decision_maker_discovery' && contact.discovery_confidence && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">{contact.discovery_confidence} confidence match</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={removing}
          onClick={onRemove}
          className="text-muted-foreground/60 hover:text-destructive shrink-0"
        >
          {removing ? <Spinner className="size-3.5" /> : null}
          Remove
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1">
        {lookingUpEmail ? (
          <div className="flex items-center gap-1.5">
            <Spinner className="size-3" />
            <Skeleton className="h-3 w-24" />
            <span className="sr-only">Looking up email…</span>
          </div>
        ) : contact.email ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusLine found>Email Found</StatusLine>
            <Badge variant={emailConfidenceBadgeVariant(contact.email_confidence)} className="text-[10px]">
              {contact.email_confidence}
            </Badge>
          </div>
        ) : contact.email_finder_status === 'error' ? (
          <StatusLine found={false}>Email lookup failed</StatusLine>
        ) : (
          <StatusLine found={false}>Email Not Found</StatusLine>
        )}

        <StatusLine found={null}>Phone Not Available</StatusLine>

        <StatusLine found={Boolean(contact.linkedin_url)}>
          {contact.linkedin_url ? 'LinkedIn Found' : 'LinkedIn Not Found'}
        </StatusLine>
      </div>

      {contact.email && (
        <p className="text-xs text-muted-foreground/70 truncate">{contact.email}</p>
      )}
    </div>
  )
}
