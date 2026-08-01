'use client'

// ============================================================
// Landing-page icons — same thin-stroke inline-SVG convention as
// nav-icons.tsx (Linear-like 1.5px strokes, currentColor), scoped
// separately since these illustrate marketing/research-area concepts
// rather than app navigation. Replaces emoji on the public landing
// page, which rendered inconsistently across OS/browser and didn't
// match the rest of the page's custom-icon aesthetic.
// ============================================================

type IconProps = { className?: string }

const base = (className?: string) => ({
  className: className ?? 'size-6',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function FactoryIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="3" y="10" width="18" height="11" rx="1" />
      <path d="M3 10 8 6v4M8 10l5-4v4M13 10l5-4v4" />
      <path d="M7 21v-5M12 21v-5M17 21v-5" />
    </svg>
  )
}

export function SignalIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 19.5h.01" />
      <path d="M9 16.2a4.2 4.2 0 0 1 6 0" />
      <path d="M6 13a8.4 8.4 0 0 1 12 0" />
      <path d="M3 9.8a12.6 12.6 0 0 1 18 0" />
    </svg>
  )
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" />
    </svg>
  )
}

export function TargetIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 3c.5 3.6 2 5.1 5.5 5.5-3.5.4-5 1.9-5.5 5.5-.5-3.6-2-5.1-5.5-5.5C10 8.1 11.5 6.6 12 3Z" />
      <path d="M19 13.5c.2 1.5.8 2.1 2.2 2.3-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.3Z" />
    </svg>
  )
}
