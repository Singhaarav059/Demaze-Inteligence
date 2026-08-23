'use client'

// ============================================================
// CollapsibleRow - a Card whose body collapses behind a clickable
// summary header, expanding on demand instead of always showing every
// field/control. Generalizes the chevron-toggle pattern already
// hand-rolled per-page in this app (followups/page.tsx's company-group
// toggle, warmup/page.tsx's per-mailbox Activity toggle,
// auto-gtm/OutreachStep.tsx's outreach-panel toggle) into one component.
// ============================================================

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { expandCollapse } from '@/lib/motion'
import { cn } from '@/lib/utils'

export function CollapsibleRow({
  summary,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
}: {
  // Always-visible header content - caller owns layout (title, badges,
  // key stat). Rendered inside a full-width button, so avoid nesting
  // interactive elements (buttons/links/inputs) inside it.
  summary: React.ReactNode
  // Body content - only mounted while open.
  children: React.ReactNode
  defaultOpen?: boolean
  // Uncontrolled by default (internal useState seeded from defaultOpen).
  // Pass both open/onOpenChange to control it from the parent instead.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  function toggle() {
    const next = !open
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <Card className={cn('border-border bg-card', className)}>
      <CardContent className="px-5 py-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center gap-3 text-left"
        >
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          <div className="min-w-0 flex-1">{summary}</div>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              variants={expandCollapse}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="overflow-hidden"
            >
              <div className="pt-3 mt-3 border-t border-border space-y-3">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}
