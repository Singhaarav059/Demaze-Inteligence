import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sparkline, type SparklinePoint } from '@/components/ui/sparkline'

// ============================================================
// MetricTile — compact metric display, extracted from the workspace
// overview page's inline MetricCard so Discover/Outbound/History can
// share one metric look instead of each inventing a card. Dense, not
// a giant padded card — a label row, a big number, an optional delta
// chip, an optional trend. trend/delta must be real computed data (see
// lib/analytics/daily-counts.ts); never pass a fabricated series/number.
// ============================================================
export function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  delta,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  sub?: string
  trend?: SparklinePoint[]
  /** week-over-week %-change from computeWindowDelta(); null/undefined = no chip rendered */
  delta?: number | null
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-card px-4 py-3', className)}>
      <div className="flex items-center gap-2 text-muted-foreground/70">
        <Icon className="size-3.5" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
        {delta != null && delta !== 0 && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-xs font-medium tabular-nums',
              delta > 0 ? 'text-signal-strong' : 'text-destructive'
            )}
          >
            {delta > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground/60">{sub}</div>}
      {trend && <Sparkline data={trend} label={`${label} trend`} className="mt-2" />}
    </div>
  )
}
