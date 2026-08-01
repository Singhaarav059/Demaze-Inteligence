'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/shell/BrandMark'
import { SmoothScroll } from '@/components/shell/SmoothScroll'
import { ScrollReveal } from '@/components/shell/ScrollReveal'
import { MotionConfigProvider } from '@/components/shell/MotionConfigProvider'
import { MagneticButton } from '@/components/shell/MagneticButton'
import { CursorGlow } from '@/components/shell/CursorGlow'
import { TiltCard } from '@/components/shell/TiltCard'
import { HowItWorksScrolly } from '@/components/shell/HowItWorksScrolly'
import { LandingMobileNav } from '@/components/shell/LandingMobileNav'
import { ScrollProgressBar } from '@/components/shell/ScrollProgressBar'
import { DiscoveryIcon } from '@/components/shell/nav-icons'
import { FactoryIcon, SignalIcon, GearIcon, TargetIcon, SparkleIcon } from '@/components/shell/landing-icons'

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'What you get', href: '#output' },
  { label: 'Research areas', href: '#research' },
]

const STATS = [
  { value: '< 60s', label: 'Per Research Brief' },
  { value: '3-5', label: 'Pain Points Surfaced' },
  { value: '3-5', label: 'AI Opportunities' },
  { value: '5', label: 'Fields Per Brief' },
]

const STEPS = [
  {
    number: '01',
    title: 'Paste any company URL',
    description: 'Drop in a company website, manufacturing plant, automotive OEM, tier-1 supplier, welding company. Any URL works.',
    color: 'from-chart-5 to-chart-5/70',
  },
  {
    number: '02',
    title: 'Agent researches the company',
    description: 'The agent scrapes their site, extracts operational signals, and infers business challenges from their industry and model, just like an SDR would.',
    color: 'from-chart-1 to-chart-1/70',
  },
  {
    number: '03',
    title: 'Get a research brief',
    description: 'Company description, pain points, AI opportunities, recent news, and a personalization summary, ready to use, specific to this company.',
    color: 'from-chart-2 to-chart-2/70',
  },
]

const RESEARCH_AREAS = [
  {
    icon: FactoryIcon,
    title: 'Company Overview',
    description: 'What they do, who they sell to, how many plants, where they operate. The context your SDR needs before hitting send.',
    accent: 'border-chart-5/40 bg-chart-5/10',
  },
  {
    icon: SignalIcon,
    title: 'Recent Signals',
    description: 'Expansions, automation investments, hiring surges, certifications, digital initiatives, recent activity that creates outreach urgency.',
    accent: 'border-chart-1/40 bg-chart-1/10',
  },
  {
    icon: GearIcon,
    title: 'Pain Points',
    description: 'Operational pain points specific to their business model, observed from their content or inferred from their industry. Always labeled.',
    accent: 'border-chart-3/40 bg-chart-3/10',
  },
  {
    icon: TargetIcon,
    title: 'AI Opportunities',
    description: 'The Demaze services most relevant to this company, matched to their signals, with a one-line rationale for each. Only real evidence, no forced fit.',
    accent: 'border-chart-2/40 bg-chart-2/10',
    featured: true,
  },
  {
    icon: SparkleIcon,
    title: 'Personalization Summary',
    description: 'A tailored outreach angle grounded in the company’s strongest signal, the specific "why now" a rep can lead with.',
    accent: 'border-chart-1/40 bg-chart-1/10',
    featured: true,
  },
  {
    icon: DiscoveryIcon,
    title: 'Evidence-backed',
    description: 'Every point is labeled observed vs. inferred and traced to a source, so reps trust what they read before they reach out.',
    accent: 'border-chart-4/40 bg-chart-4/10',
  },
]

const OUTPUT_GROUPS = [
  {
    label: 'Company profile',
    items: [
      'Company name, summary & business model',
      'Industry & sub-industry classification',
      'Headquarters & size estimate',
    ],
  },
  {
    label: 'Research findings',
    items: [
      'Recent news & growth signals',
      'Pain points (observed + inferred)',
      'AI opportunities with entry points',
    ],
  },
  {
    label: 'Ready to send',
    items: [
      'Personalization summary (outreach angle)',
      'Lead with (Demaze service to pitch)',
      'Why now (company-specific trigger)',
      'Evidence labeled observed vs. inferred',
    ],
  },
]

export default function Home() {
  const heroRef = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()

  // Scrollspy: highlight whichever section's anchor the user has scrolled
  // to, so the nav reflects where you are on the page (not just where you
  // can jump to). rootMargin carves a thin band near vertical-center of
  // the viewport — a section only counts "active" once it's genuinely in
  // the reading area, not the instant its top edge appears at the bottom.
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  useEffect(() => {
    const ids = NAV_LINKS.map((link) => link.href.slice(1))
    const elements = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActiveSectionId(topmost.target.id)
      },
      { rootMargin: '-40% 0px -50% 0px', threshold: 0 },
    )
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const glowY = useTransform(heroProgress, [0, 1], reducedMotion ? [0, 0] : [0, 160])
  const gridY = useTransform(heroProgress, [0, 1], reducedMotion ? [0, 0] : [0, -60])
  const heroContentY = useTransform(heroProgress, [0, 1], reducedMotion ? [0, 0] : [0, 80])
  const heroOpacity = useTransform(heroProgress, [0, 0.8], [1, 0])

  return (
    <MotionConfigProvider>
    <SmoothScroll>
    <div className="dark min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/30">

      <ScrollProgressBar />

      {/* Skip link — visually hidden until focused, so keyboard users don't
          have to tab through the header nav on every page load. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <BrandMark size="md" />
              <span className="text-sm font-semibold tracking-tight text-foreground">Demaze AI</span>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              {NAV_LINKS.map((link) => {
                const isActive = activeSectionId === link.href.slice(1)
                return (
                  <a
                    key={link.label}
                    href={link.href}
                    aria-current={isActive ? 'location' : undefined}
                    className={cn(
                      'text-sm transition-colors px-1 py-2',
                      isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {link.label}
                  </a>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <MagneticButton>
              <Link
                href="/admin/intelligence-lab"
                className="text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg transition-colors"
              >
                Open Agent
              </Link>
            </MagneticButton>
            <LandingMobileNav links={NAV_LINKS} />
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">

        {/* Hero */}
        <section ref={heroRef} className="relative overflow-hidden pt-24 pb-20 px-6">
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              style={{ y: glowY }}
              className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-primary/10 via-primary-hover/5 to-transparent rounded-full blur-3xl"
            />
            <motion.div
              style={{
                y: gridY,
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, color-mix(in oklab, var(--foreground) 40%, transparent) 1px, transparent 0)',
                backgroundSize: '32px 32px',
              }}
              className="absolute inset-0 opacity-40"
            />
          </div>

          <CursorGlow containerRef={heroRef} />

          <motion.div
            style={{ y: heroContentY, opacity: heroOpacity }}
            className="relative max-w-4xl mx-auto text-center space-y-8"
          >
            {/* Staged entrance on first load — badge, headline, subhead, CTAs
                reveal in sequence rather than the hero appearing fully-formed.
                `initial`/`animate` (mount-triggered, not scroll-triggered) is
                independent of this wrapper's own scroll-linked `opacity`
                above — each nested element's own opacity compounds with its
                ancestor's, no property conflict. MotionConfig's ancestor
                reducedMotion="user" (see MotionConfigProvider) collapses
                these to their end state instantly, no manual gating needed. */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center gap-2 text-xs font-medium text-primary border border-primary/30 bg-primary/10 rounded-full px-4 py-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Manufacturing &amp; Automotive · Outbound Research
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tighter leading-[1.05]"
            >
              Research any company.{' '}
              <span className="bg-gradient-to-r from-primary via-primary-hover to-primary bg-clip-text text-transparent">
                Personalize every outreach.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="text-muted-foreground text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto"
            >
              Paste a company URL. The agent reads their site, surfaces their pain points,
              matches Demaze services, and hands you a personalization summary, in under 60 seconds.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2"
            >
              <MagneticButton>
                <Link
                  href="/admin/intelligence-lab"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm px-6 py-3 rounded-xl transition-colors"
                >
                  Research a company
                  <span aria-hidden>→</span>
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link
                  href="/admin/run-history"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground text-sm px-6 py-3 rounded-xl transition-colors"
                >
                  View past research
                </Link>
              </MagneticButton>
            </motion.div>
          </motion.div>
        </section>

        {/* Stats */}
        <section className="border-y border-border bg-card/40">
          <div className="max-w-5xl mx-auto px-6 py-10">
            <p className="text-center text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
              What a research brief delivers
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
              {STATS.map((stat, i) => (
                <ScrollReveal key={stat.label} delay={i * 0.08} className="text-center space-y-1">
                  <p className="text-3xl font-bold text-foreground tracking-tight">{stat.value}</p>
                  <p className="text-xs text-muted-foreground uppercase tracking-widest">{stat.label}</p>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="relative py-24 sm:py-0">
          {/* Subtle ambient glow — same restrained "primary color, low
              opacity, blurred" treatment as the hero, reused here rather
              than a new decorative pattern, so long sections of flat
              background don't feel like an abrupt stack. Kept faint per
              this design system's own "accent used scarcely, never as a
              decorative fill" rule (see globals.css). */}
          <div
            aria-hidden
            className="absolute inset-0 -z-10 pointer-events-none overflow-hidden"
          >
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.06] rounded-full blur-3xl" />
          </div>
          <div className="max-w-5xl mx-auto px-6 sm:pt-24">
            <ScrollReveal className="text-center space-y-3 mb-16">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">How it works</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Three steps to a personalized brief</h2>
            </ScrollReveal>
          </div>

          <HowItWorksScrolly steps={STEPS as [typeof STEPS[0], typeof STEPS[1], typeof STEPS[2]]} />
        </section>

        {/* Research areas */}
        <section id="research" className="py-24 px-6 bg-card/40">
          <div className="max-w-5xl mx-auto">
            <ScrollReveal className="text-center space-y-3 mb-16">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">What the agent researches</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Everything an SDR needs before hitting send
              </h2>
              <p className="text-muted-foreground text-base max-w-xl mx-auto">
                The agent mimics how a great SDR researches a company, then packages it in a brief that&apos;s ready to act on.
              </p>
            </ScrollReveal>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {RESEARCH_AREAS.map((area, i) => (
                <ScrollReveal key={area.title} delay={i * 0.06} parallax={i % 2 === 0 ? 18 : -18}>
                  <TiltCard
                    className={cn(
                      'relative rounded-xl border p-5 space-y-3 hover:bg-accent/40 transition-colors',
                      area.accent,
                      area.featured && 'ring-1 ring-primary/30',
                    )}
                  >
                    {area.featured && (
                      <span className="absolute top-3 right-3 text-[9px] font-semibold uppercase tracking-widest text-primary/80">
                        Key output
                      </span>
                    )}
                    <area.icon className="size-6 text-foreground/80" />
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-semibold text-foreground">{area.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{area.description}</p>
                    </div>
                  </TiltCard>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </section>

        {/* What you get */}
        <section id="output" className="py-24 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <ScrollReveal className="space-y-6">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Research brief</p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
                  Every field in the brief is built for one purpose
                </h2>
                <p className="text-muted-foreground text-base leading-relaxed">
                  Could this help a salesperson write a better personalized email?
                  Every output is evaluated against that question.
                  Inference is labeled. Guesses are flagged. No hallucinated scores.
                </p>
                <Link
                  href="/admin/intelligence-lab"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Try it on a company <span aria-hidden>→</span>
                </Link>
              </ScrollReveal>

              <div className="space-y-5">
                {OUTPUT_GROUPS.map((group, gi) => (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80 mb-2">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.items.map((output, i) => (
                        <ScrollReveal
                          key={output}
                          delay={(gi * group.items.length + i) * 0.04}
                          className="flex items-center gap-2.5 text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2.5 hover:border-primary/50 hover:text-foreground/90 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                          {output}
                        </ScrollReveal>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SDR trust section */}
        <section className="py-24 px-6 bg-card/40">
          <div className="max-w-5xl mx-auto">
            <ScrollReveal className="rounded-2xl border border-border bg-card p-8 sm:p-12 space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center text-white font-bold text-lg">
                    ✓
                  </div>
                  <h3 className="text-xl font-bold text-foreground">Inferred is not a dirty word</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    A welding company&apos;s website rarely says &ldquo;we have quality control problems.&rdquo;
                    An experienced SDR infers it from their business model. So does this agent,
                    and it labels every inference so you know what&apos;s fact vs. deduction.
                  </p>
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-signal-strong/15 text-signal-strong border-signal-strong/40">observed</span>
                      <span className="text-muted-foreground">Directly stated on their website</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-signal-medium/15 text-signal-medium border-signal-medium/40">inferred</span>
                      <span className="text-muted-foreground">Deduced from business model or industry</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Built for manufacturing &amp; automotive</h3>
                  <div className="space-y-3">
                    {[
                      { industry: 'Welding / fabrication', challenge: 'Quality control, parameter drift, rework reduction' },
                      { industry: 'Automotive supplier', challenge: 'JIT scheduling, OEM audit readiness, quality compliance' },
                      { industry: 'Multi-plant manufacturer', challenge: 'Cross-facility visibility, production consistency' },
                      { industry: 'Heavy industry / forging', challenge: 'Predictive maintenance, energy optimization' },
                    ].map((item) => (
                      <div key={item.industry} className="rounded-lg border border-border bg-card px-4 py-3">
                        <p className="text-xs font-medium text-foreground/90">{item.industry}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.challenge}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* CTA */}
        <section className="relative py-24 px-6">
          <div aria-hidden className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-primary/[0.06] rounded-full blur-3xl" />
          </div>
          <ScrollReveal className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Try it on your next prospect
            </h2>
            <p className="text-muted-foreground text-base">
              Paste any manufacturing or automotive company URL and get a full research brief, pain points, AI opportunities, and a personalization summary, in under 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <MagneticButton>
                <Link
                  href="/admin/intelligence-lab"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-sm px-8 py-3.5 rounded-xl transition-colors"
                >
                  Open Research Agent <span aria-hidden>→</span>
                </Link>
              </MagneticButton>
              <MagneticButton>
                <Link
                  href="/admin/run-history"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground text-sm px-8 py-3.5 rounded-xl transition-colors"
                >
                  Browse past research
                </Link>
              </MagneticButton>
            </div>
          </ScrollReveal>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark size="xs" />
            <span className="text-xs font-medium text-muted-foreground">Demaze Technologies</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Internal outbound research tool, not for public distribution
          </p>
        </div>
      </footer>

    </div>
    </SmoothScroll>
    </MotionConfigProvider>
  )
}
