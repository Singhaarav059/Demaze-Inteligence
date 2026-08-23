'use client'

// ============================================================
// TiltCard - subtle cursor-driven 3D tilt on hover
// ============================================================
// Wraps card content and rotates it a few degrees toward the cursor on
// hover, springing flat on leave - same "give it presence, not gimmick"
// restraint as MagneticButton (max rotation kept small). Pointer-fine +
// !reduced-motion only, identical guard to MagneticButton/CursorGlow -
// meaningless on touch, and reduced-motion users get a static card.
// ============================================================

import { useRef, useState, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'

const MAX_TILT_DEG = 6

export function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [pointerFine, setPointerFine] = useState(false)

  useEffect(() => {
    setPointerFine(window.matchMedia('(pointer: fine)').matches)
  }, [])

  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const springRotateX = useSpring(rotateX, { stiffness: 200, damping: 20, mass: 0.5 })
  const springRotateY = useSpring(rotateY, { stiffness: 200, damping: 20, mass: 0.5 })

  const active = pointerFine && !reducedMotion

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!active || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width - 0.5
    const relY = (e.clientY - rect.top) / rect.height - 0.5
    rotateY.set(relX * MAX_TILT_DEG * 2)
    rotateX.set(relY * -MAX_TILT_DEG * 2)
  }

  function handleMouseLeave() {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={active ? { rotateX: springRotateX, rotateY: springRotateY, transformPerspective: 600 } : undefined}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </motion.div>
  )
}
