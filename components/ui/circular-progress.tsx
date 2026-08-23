// ============================================================
// CircularProgress - compact radial progress ring + centered %
// ============================================================
// Same "no charting dependency" precedent as sparkline.tsx/bar-trend.tsx/
// donut-chart.tsx: plain inline SVG. Used for a real, driven percentage
// (e.g. "N of M researched") - never a fake/animated-for-looks value.
// ============================================================

import { cn } from '@/lib/utils'

export function CircularProgress({
  value,
  size = 40,
  thickness = 4,
  colorVar = 'var(--primary)',
  className,
}: {
  /** 0-100 */
  value: number
  size?: number
  thickness?: number
  colorVar?: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (pct / 100) * circumference

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% complete`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colorVar}
          strokeWidth={thickness}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tabular-nums text-foreground">
        {pct}%
      </span>
    </div>
  )
}
