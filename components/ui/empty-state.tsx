import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Reusable icon + message + optional CTA block. Added to replace 5 ad hoc
// empty states (some bare text, one — CompanyMatchList — rendering nothing
// at all) with one consistent pattern.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center',
        className
      )}
    >
      <Icon className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-xs text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
