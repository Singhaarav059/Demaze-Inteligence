// ============================================================
// BrandMark - the real Demaze chevron mark, single source of truth.
// Was a generic gradient "D" chip built for this app before a real brand
// asset was available; replaced 2026-08-23 with the actual logo mark
// (public/brand/demaze-mark.png), pulled directly from demazetech.com at
// the user's own request, so the admin tool matches the real Demaze brand
// instead of an invented placeholder.
// ============================================================

import Image from 'next/image'
import { cn } from '@/lib/utils'

const SIZE = {
  xs: 20,
  sm: 24,
  md: 28,
} as const

export function BrandMark({
  size = 'md',
  glow = false,
  className,
}: {
  size?: keyof typeof SIZE
  /** Subtle drop shadow - used only where the mark sits on its own (Sidebar). */
  glow?: boolean
  className?: string
}) {
  const px = SIZE[size]
  return (
    <Image
      src="/brand/demaze-mark.png"
      alt="Demaze"
      width={px}
      height={px}
      priority
      className={cn('shrink-0 object-contain', glow && 'drop-shadow-[0_0_6px_var(--primary)]', className)}
    />
  )
}
