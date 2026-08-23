'use client'

// ============================================================
// MagneticButton - cursor-attraction wrapper for the public landing page
// ============================================================
// Wraps a Link/button and nudges it a few px toward the cursor on hover,
// springing back on leave. Pointer-fine + !reduced-motion only (a magnetic
// pull has no meaning on touch, and reduced-motion users get the plain
// element via the same discipline as ScrollReveal/SmoothScroll elsewhere
// in this codebase). Never intercepts clicks - only the wrapper's
// transform moves, the child element's own hit target is untouched.
// ============================================================

import { useRef, useState, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'

const PULL_STRENGTH = 0.35
const MAX_OFFSET = 14

export function MagneticButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [pointerFine, setPointerFine] = useState(false)

  useEffect(() => {
    setPointerFine(window.matchMedia('(pointer: fine)').matches)
  }, [])

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 250, damping: 18, mass: 0.4 })
  const springY = useSpring(y, { stiffness: 250, damping: 18, mass: 0.4 })

  const active = pointerFine && !reducedMotion

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!active || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const relX = e.clientX - (rect.left + rect.width / 2)
    const relY = e.clientY - (rect.top + rect.height / 2)
    x.set(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, relX * PULL_STRENGTH)))
    y.set(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, relY * PULL_STRENGTH)))
  }

  function handleMouseLeave() {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={active ? { x: springX, y: springY } : undefined}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </motion.div>
  )
}
