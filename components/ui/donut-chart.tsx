// ============================================================
// DonutChart - compact categorical-distribution donut + legend
// ============================================================
// Same "no charting dependency" precedent as sparkline.tsx/bar-trend.tsx:
// plain inline SVG (stacked stroke-dasharray arcs), no library. Renders
// nothing when every slice is 0 - callers should omit the surrounding panel
// entirely in that case rather than show an empty ring.
// ============================================================

import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface DonutSlice {
  label: string
  value: number
  /** a CSS color, e.g. 'var(--signal-strong)' */
  colorVar: string
  /** Navigates there on click; omit for a plain, non-interactive legend row. */
  href?: string
}

export function DonutChart({
  slices,
  size = 96,
  thickness = 14,
  className,
}: {
  slices: DonutSlice[]
  size?: number
  thickness?: number
  className?: string
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return null

  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
        />
        {slices.filter(s => s.value > 0).map((s, i) => {
          const fraction = s.value / total
          const dash = fraction * circumference
          const dashArray = `${dash} ${circumference - dash}`
          const dashOffset = -offset
          offset += dash
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.colorVar}
              strokeWidth={thickness}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              strokeLinecap={slices.length === 1 ? 'butt' : 'round'}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </circle>
          )
        })}
      </svg>
      <ul className="space-y-1 text-xs">
        {slices.filter(s => s.value > 0).map((s, i) => {
          const row = (
            <>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.colorVar }} />
              <span className="text-foreground">{s.label}</span>
              <span className="tabular-nums text-muted-foreground/70">{Math.round((s.value / total) * 100)}%</span>
            </>
          )
          return (
            <li key={i}>
              {s.href ? (
                <Link href={s.href} className="flex items-center gap-1.5 text-muted-foreground rounded transition-colors hover:text-foreground">
                  {row}
                </Link>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">{row}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
