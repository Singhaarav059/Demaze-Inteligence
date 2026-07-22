// ============================================================
// BrandMark — the indigo/violet "D" chip, single source of truth.
// Was copy-pasted identically across Sidebar, TopBar, MobileNav,
// and the public landing page header/footer; consolidated here so
// the brand gradient only ever needs to change in one place.
// ============================================================

import { cn } from '@/lib/utils'

const SIZE = {
  xs: { box: 'size-5', radius: 'rounded-md', text: 'text-[10px]' },
  sm: { box: 'size-6', radius: 'rounded-md', text: 'text-xs' },
  md: { box: 'size-7', radius: 'rounded-lg', text: 'text-sm' },
} as const

export function BrandMark({
  size = 'md',
  glow = false,
  className,
}: {
  size?: keyof typeof SIZE
  /** Subtle drop shadow — used only where the mark sits on its own (Sidebar). */
  glow?: boolean
  className?: string
}) {
  const s = SIZE[size]
  return (
    <span
      className={cn(
        'grid place-items-center bg-gradient-to-br from-primary to-primary-hover font-semibold text-white',
        s.box,
        s.radius,
        s.text,
        glow && 'shadow-sm shadow-primary/40',
        className,
      )}
    >
      D
    </span>
  )
}
