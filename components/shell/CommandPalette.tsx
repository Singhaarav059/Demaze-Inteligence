'use client'

// ============================================================
// CommandPalette — Cmd+K / Ctrl+K quick-jump
// ============================================================
// No routed detail views exist in this app to jump between (confirmed via
// exploration — every "detail" is an inline accordion, not a route), so
// this is deliberately just a fast way to reach any top-level destination:
// the 4 primary NAV entries plus the 4 pages pulled from main nav on
// 2026-07-18 (SECONDARY_NAV) that would otherwise only be reachable by
// typing a URL or opening the TopBar's "More" menu.
//
// Focus/keyboard handling mirrors MobileNav.tsx's manual (no-library)
// pattern: focus moves in on open, Escape closes, focus restores to
// whatever was focused before opening. There's no Tab-trap here though —
// unlike the drawer, the only real focusable element while open is the
// search input itself; result navigation is Up/Down/Enter on a listbox,
// same convention any command palette uses.
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV, SECONDARY_NAV } from './nav-config'

type PaletteItem = {
  href: string
  label: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
}

const ITEMS: PaletteItem[] = [...NAV, ...SECONDARY_NAV]

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ITEMS
    return ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q)
    )
  }, [query])

  // Read inside the keydown handler via refs, not as effect deps — the
  // handler effect below only needs to (re)run when `open` toggles. Making
  // it depend on `results`/`activeIndex` directly (as an earlier version
  // did) meant every keystroke tore down and re-ran the effect, and its
  // cleanup unconditionally called restoreFocusRef.current?.focus() —
  // yanking focus back to the trigger button on every single character
  // typed, not just on real close.
  const resultsRef = useRef(results)
  const activeIndexRef = useRef(activeIndex)
  useEffect(() => {
    resultsRef.current = results
    activeIndexRef.current = activeIndex
  }, [results, activeIndex])

  // Global Cmd+K / Ctrl+K toggle — always listening, not just while open.
  // Also listens for a plain custom event so the TopBar's visible "⌘K"
  // button (for anyone who doesn't know the shortcut exists) can open the
  // same palette without prop-drilling open state through the layout.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    function onOpenEvent() {
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('open-command-palette', onOpenEvent)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('open-command-palette', onOpenEvent)
    }
  }, [])

  function close() {
    setOpen(false)
    setQuery('')
    setActiveIndex(0)
  }

  function go(item: PaletteItem) {
    close()
    router.push(item.href)
  }

  // Focus in on open, restore on close — same discipline as MobileNav.tsx.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    inputRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, resultsRef.current.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = resultsRef.current[activeIndexRef.current]
        if (item) go(item)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command palette">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="absolute top-[18%] left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
            placeholder="Jump to…"
            aria-label="Jump to a page"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/70 sm:inline">
            Esc
          </kbd>
        </div>

        <ul id="command-palette-listbox" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching page.</li>
          )}
          {results.map((item, i) => {
            const Icon = item.icon
            const active = i === activeIndex
            return (
              <li
                key={item.href}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => go(item)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                  active ? 'bg-accent text-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex flex-col leading-tight">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-[11px] text-muted-foreground/70">{item.hint}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
