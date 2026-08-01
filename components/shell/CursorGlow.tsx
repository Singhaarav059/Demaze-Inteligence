'use client'

// ============================================================
// CursorGlow — spotlight that follows the cursor within a container
// ============================================================
// Purely decorative radial-gradient glow, absolutely positioned within
// `containerRef` (must be `position: relative`). Tracks mouse position
// relative to that container only — deliberately NOT `position: fixed` +
// window-level mousemove, which would drag the glow across sections the
// user has scrolled past. Pointer-fine + !reduced-motion only, same guard
// as MagneticButton — meaningless on touch, and reduced-motion users
// should see a static hero, not a moving glow.
// ============================================================

import { useEffect, useState, type RefObject } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'

export function CursorGlow({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const reducedMotion = useReducedMotion()
  const [pointerFine, setPointerFine] = useState(false)

  useEffect(() => {
    setPointerFine(window.matchMedia('(pointer: fine)').matches)
  }, [])

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 120, damping: 24, mass: 0.5 })
  const springY = useSpring(y, { stiffness: 120, damping: 24, mass: 0.5 })

  const active = pointerFine && !reducedMotion

  useEffect(() => {
    const el = containerRef.current
    if (!active || !el) return
    function handleMove(e: MouseEvent) {
      const rect = el!.getBoundingClientRect()
      x.set(e.clientX - rect.left)
      y.set(e.clientY - rect.top)
    }
    el.addEventListener('mousemove', handleMove)
    return () => el.removeEventListener('mousemove', handleMove)
  }, [active, containerRef, x, y])

  if (!active) return null

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute w-[500px] h-[500px] rounded-full -translate-x-1/2 -translate-y-1/2 z-0"
      style={{
        left: springX,
        top: springY,
        background:
          'radial-gradient(circle, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 70%)',
      }}
    />
  )
}
