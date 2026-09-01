'use client'

// ============================================================
// ContactInfoRow - read-only contact-info status card for Auto Flow's
// Contact Information step
// ============================================================
// Deliberately has zero action buttons for the discovery itself (no Find
// Email / Enrich / Validate) - email/LinkedIn lookup happens automatically
// via ContactInfoStep's effect before this ever renders a result, this
// component only displays whatever the contact row currently holds. The one
// action here (Remove) is an undo/escape hatch, not a trigger for more
// automation.
// ============================================================

import { ExternalLink, Mail, Phone, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { OutboundContact } from '@/app/admin/outbound/contacts/useOutboundContacts'

function emailConfidenceBadgeVariant(confidence: OutboundContact['email_confidence']) {
  if (confidence === 'verified' || confidence === 'high') return 'default' as const
  if (confidence === 'medium' || confidence === 'low') return 'secondary' as const
  return 'outline' as const
}

function StatusLine({ icon: Icon, children, found }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; found: boolean | null }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className={cn('size-3.5 shrink-0', found === true ? 'text-signal-strong' : 'text-muted-foreground/40')} />
      <span className={found === true ? 'text-foreground' : 'text-muted-foreground/70'}>{children}</span>
      {found === false && <XCircle className="size-3 shrink-0 text-muted-foreground/40" />}
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
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={contact.person_name} size="sm" />
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

      <div className="grid grid-cols-1 gap-1.5 border-t border-border/60 pt-2.5 sm:grid-cols-3">
        {lookingUpEmail ? (
          <div className="flex items-center gap-1.5">
            <Spinner className="size-3" />
            <Skeleton className="h-3 w-24" />
            <span className="sr-only">Looking up email…</span>
          </div>
        ) : contact.email ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusLine icon={Mail} found>Email Found</StatusLine>
            <Badge variant={emailConfidenceBadgeVariant(contact.email_confidence)} className="text-[10px]">
              {contact.email_confidence}
            </Badge>
            {contact.email_confidence === 'low' && (
              <span className="text-[10px] text-signal-medium">Needs verification - consider double-checking before sending.</span>
            )}
          </div>
        ) : contact.email_finder_status === 'error' ? (
          <StatusLine icon={Mail} found={false}>Email lookup failed</StatusLine>
        ) : (
          <StatusLine icon={Mail} found={false}>Email Not Found</StatusLine>
        )}

        <StatusLine icon={Phone} found={null}>Phone Not Available</StatusLine>

        <StatusLine icon={ExternalLink} found={Boolean(contact.linkedin_url)}>
          {contact.linkedin_url ? 'LinkedIn Found' : 'LinkedIn Not Found'}
        </StatusLine>
      </div>

      {contact.email && (
        <p className="text-xs text-muted-foreground/70 truncate pl-[2.625rem]">{contact.email}</p>
      )}
    </div>
  )
}
