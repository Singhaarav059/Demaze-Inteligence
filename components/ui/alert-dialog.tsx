'use client'

// ============================================================
// AlertDialog — confirm-before-action dialog
// ============================================================
// Wraps @base-ui/react/alert-dialog, same "thin styled wrapper over a
// base-ui primitive" pattern as tooltip.tsx. Added 2026-07-19 (Track 4 of
// the production-polish pass) specifically to close a real gap: cost-
// incurring actions (Send Email/Send All in Auto Flow, Decision-Maker
// Discovery, delete actions) previously had either zero confirmation or a
// native window.confirm() with no visual consistency with the rest of the
// app. ConfirmDialog below is the primary export most call sites want — a
// single controlled component for the common "are you sure?" case, so
// callers don't have to compose the primitives themselves every time.
// ============================================================

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Spinner } from './spinner'

function AlertDialogRoot(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-backdrop"
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
        'transition-opacity duration-150',
        'data-[starting-style]:opacity-0 data-[ending-style]:opacity-0',
        className
      )}
      {...props}
    />
  )
}

function AlertDialogPopup({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Popup
      data-slot="alert-dialog-popup"
      className={cn(
        'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
        'rounded-xl border border-border bg-card p-5 shadow-xl',
        'transition-[transform,opacity] duration-150 ease-out',
        'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
        'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
        className
      )}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Popup>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('mt-2 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

// ── ConfirmDialog — the component almost every call site actually wants ──
// Fully controlled (open/onOpenChange) so it can be triggered from an
// existing button's onClick handler rather than requiring a dedicated
// <AlertDialog.Trigger> wrapper — most cost-incurring actions in this app
// already have their own button with its own loading/disabled state.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogPortal>
        <AlertDialogBackdrop />
        <AlertDialogPopup>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Close
              disabled={loading}
              className="group/button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-all hover:bg-muted disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
            >
              {cancelLabel}
            </AlertDialogPrimitive.Close>
            <Button
              size="default"
              variant={destructive ? 'destructive' : 'default'}
              disabled={loading}
              onClick={onConfirm}
            >
              {loading ? <Spinner className="size-3.5" /> : null}
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialogPortal>
    </AlertDialogRoot>
  )
}

export {
  AlertDialogRoot as AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
}
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger
export const AlertDialogClose = AlertDialogPrimitive.Close
