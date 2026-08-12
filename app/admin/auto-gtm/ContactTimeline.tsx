'use client'

// ============================================================
// ContactTimeline — per-contact expandable event history (step 6)
// ============================================================
// "Everything about one contact" — the counterpart to CampaignDashboard.tsx
// ("everything about one segment across all contacts"). Both render the
// exact same already-fetched campaign_events, just sliced differently, via
// the shared describeEvent()/formatTimestamp() from EventLabels.ts.
//
// Deliberately does NOT show a "Delivered" event — Gmail's API gives no
// separate delivery confirmation beyond accepted-for-send, and inventing
// one would violate this app's "don't fake tracking" rule (see CLAUDE.md).
// "Sent" is the strongest real confirmed signal shown.
// ============================================================

import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Clock } from 'lucide-react'
import { describeEvent, formatTimestamp, type CampaignEvent } from './EventLabels'

export function ContactTimeline({
  personName,
  events,
  open,
  onOpenChange,
}: {
  personName: string
  events: CampaignEvent[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))

  return (
    <CollapsibleRow
      open={open}
      onOpenChange={onOpenChange}
      className="border-none bg-transparent"
      summary={<span className="text-xs text-muted-foreground/70">Activity timeline</span>}
    >
      {sorted.length === 0 ? (
        <EmptyState icon={Clock} title="No recorded activity yet" className="border-none py-3" />
      ) : (
        <ol className="space-y-2">
          {sorted.map(e => (
            <li key={e.id} className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground/60 shrink-0 tabular-nums">{formatTimestamp(e.occurred_at)}</span>
              <span className="text-foreground">— {describeEvent(e)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only">{personName}&apos;s activity timeline, {sorted.length} event(s).</p>
    </CollapsibleRow>
  )
}
