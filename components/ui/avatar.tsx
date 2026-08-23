// ============================================================
// Avatar - deterministic-colored initials circle
// ============================================================
// No photo/avatar URL field exists anywhere in the data model (decision-
// maker candidates, contacts, discovered companies) - this is initials-only
// by design, not a "for now" stand-in for a photo prop.
// ============================================================

import { cn } from '@/lib/utils'

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const SIZE_CLASSES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
} as const

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

export function Avatar({
  name,
  size = 'sm',
  className,
  ringColorVar,
}: {
  name: string
  size?: keyof typeof SIZE_CLASSES
  className?: string
  /** Opt-in ring (e.g. a fit-strength color) so a list of avatars is
   *  scannable by that signal instead of by hash-derived, meaningless color. */
  ringColorVar?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        SIZE_CLASSES[size],
        className
      )}
      style={{
        backgroundColor: colorFor(name),
        boxShadow: ringColorVar ? `0 0 0 2px ${ringColorVar}` : undefined,
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </div>
  )
}
