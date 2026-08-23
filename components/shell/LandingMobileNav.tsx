'use client'

// ============================================================
// LandingMobileNav - hamburger + slide-in drawer for the public
// landing page's in-page section links, < md screens only.
// ============================================================
// The landing page header hides its anchor nav below md (the primary
// "Open Agent" CTA stays visible at all sizes), so this is the only way
// a mobile visitor can jump to "How it works" / "What you get" /
// "Research areas" without manually scrolling. Mirrors MobileNav.tsx's
// accessible-drawer pattern (focus trap, Escape, focus restore, portal to
// body) rather than a new one-off - same discipline, much smaller drawer
// content (plain anchor links, no route/active-state logic needed since
// there's no client-side routing between sections).
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MenuIcon, CloseIcon } from './nav-icons'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])'

export function LandingMobileNav({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const drawer = drawerRef.current
    const trigger = triggerRef.current
    const firstFocusable = drawer?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    firstFocusable?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      if (e.key !== 'Tab' || !drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <MenuIcon className="size-5" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Section navigation">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <aside ref={drawerRef} className="absolute inset-x-0 top-0 flex flex-col border-b border-border bg-background shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-border px-6">
              <span className="text-sm font-semibold tracking-tight text-foreground">Jump to</span>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
            <nav className="space-y-1 px-4 py-4" aria-label="Page sections">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </aside>
        </div>,
        document.body
      )}
    </div>
  )
}
