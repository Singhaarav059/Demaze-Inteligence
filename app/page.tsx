import Link from 'next/link'

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'What you get', href: '#output' },
  { label: 'Research areas', href: '#research' },
]

const STATS = [
  { value: '< 60s', label: 'Per Research Brief' },
  { value: '3–5', label: 'Pain Points Surfaced' },
  { value: '3–5', label: 'Demaze Opportunities' },
  { value: '1', label: 'Ready-to-send Opener' },
]

const STEPS = [
  {
    number: '01',
    title: 'Paste any company URL',
    description: 'Drop in a company website — manufacturing plant, automotive OEM, tier-1 supplier, welding company. Any URL works.',
    color: 'from-blue-600 to-blue-400',
  },
  {
    number: '02',
    title: 'Agent researches the company',
    description: 'The agent scrapes their site, extracts operational signals, and infers business challenges from their industry and model — just like an SDR would.',
    color: 'from-violet-600 to-violet-400',
  },
  {
    number: '03',
    title: 'Get a research brief',
    description: 'Pain points, Demaze opportunities, who to contact, and a cold email opener — ready to use, specific to this company.',
    color: 'from-emerald-600 to-emerald-400',
  },
]

const RESEARCH_AREAS = [
  {
    label: '🏭',
    title: 'Company Overview',
    description: 'What they do, who they sell to, how many plants, where they operate. The context your SDR needs before hitting send.',
    accent: 'border-blue-800/60 bg-blue-950/20',
  },
  {
    label: '📡',
    title: 'Recent Signals',
    description: 'Expansions, automation investments, hiring surges, certifications, digital initiatives — recent activity that creates outreach urgency.',
    accent: 'border-violet-800/60 bg-violet-950/20',
  },
  {
    label: '⚙️',
    title: 'Business Challenges',
    description: 'Operational pain points specific to their business model — observed from their content or inferred from their industry. Always labeled.',
    accent: 'border-amber-800/60 bg-amber-950/20',
  },
  {
    label: '🎯',
    title: 'Demaze Opportunities',
    description: 'The 3–5 Demaze services most relevant to this company — matched to their signals, with a one-line rationale for each.',
    accent: 'border-emerald-800/60 bg-emerald-950/20',
  },
  {
    label: '👤',
    title: 'Who to Contact',
    description: '2–3 exact job titles appropriate for their industry, with a reason why each person cares about the top opportunity.',
    accent: 'border-rose-800/60 bg-rose-950/20',
  },
  {
    label: '✉️',
    title: 'Cold Email Opener',
    description: '2–3 sentences a rep can send verbatim. Starts with their strongest signal. No "I hope this finds you well."',
    accent: 'border-indigo-800/60 bg-indigo-950/20',
  },
]

const OUTPUTS = [
  'Company name, summary & business model',
  'Industry & sub-industry classification',
  'Headquarters & size estimate',
  'Recent activity & growth signals',
  'Business challenges (observed + inferred)',
  'Demaze opportunities with entry points',
  'Who to contact — exact job titles',
  'Reason each contact cares',
  'Cold email opening angle',
  'Lead with (service to pitch)',
  'Send to (single best contact)',
  'Why now (company-specific trigger)',
]

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col selection:bg-blue-500/30">

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center font-bold text-white text-xs">
                D
              </div>
              <span className="text-sm font-semibold tracking-tight text-white">Demaze AI</span>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              {NAV_LINKS.map((link) => (
                <a key={link.label} href={link.href} className="text-sm text-zinc-400 hover:text-white transition-colors">
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
          <Link
            href="/admin/intelligence-lab"
            className="text-sm font-medium bg-white text-zinc-950 hover:bg-zinc-100 px-4 py-2 rounded-lg transition-colors"
          >
            Open Agent
          </Link>
        </div>
      </header>

      <main className="flex-1">

        {/* Hero */}
        <section className="relative overflow-hidden pt-24 pb-20 px-6">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b from-blue-600/10 via-violet-600/5 to-transparent rounded-full blur-3xl" />
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(63 63 70 / 0.6) 1px, transparent 0)',
                backgroundSize: '32px 32px',
              }}
            />
          </div>

          <div className="relative max-w-4xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-400 border border-blue-500/30 bg-blue-500/10 rounded-full px-4 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Manufacturing &amp; Automotive · Outbound Research
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05]">
              Research any company.{' '}
              <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">
                Write better emails.
              </span>
            </h1>

            <p className="text-zinc-400 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto">
              Paste a company URL. The agent reads their site, finds their pain points,
              matches Demaze services, and writes your cold email opener — in under 60 seconds.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link
                href="/admin/intelligence-lab"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-zinc-950 hover:bg-zinc-100 font-semibold text-sm px-6 py-3 rounded-xl transition-colors"
              >
                Research a company
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/admin/run-history"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white text-sm px-6 py-3 rounded-xl transition-colors"
              >
                View past research
              </Link>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-zinc-800/60 bg-zinc-900/30">
          <div className="max-w-5xl mx-auto px-6 py-10">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center space-y-1">
                  <p className="text-3xl font-bold text-white tracking-tight">{stat.value}</p>
                  <p className="text-xs text-zinc-500 uppercase tracking-widest">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="py-24 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="text-center space-y-3 mb-16">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">How it works</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Three steps to a personalized brief</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {STEPS.map((step, i) => (
                <div key={step.number} className="relative group">
                  {i < STEPS.length - 1 && (
                    <div className="hidden sm:block absolute top-8 left-full w-6 h-px bg-zinc-700 z-10" />
                  )}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4 hover:border-zinc-700 transition-colors h-full">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center`}>
                      <span className="text-white font-bold text-sm">{step.number}</span>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-base font-semibold text-white">{step.title}</h3>
                      <p className="text-sm text-zinc-400 leading-relaxed">{step.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Research areas */}
        <section id="research" className="py-24 px-6 bg-zinc-900/20">
          <div className="max-w-5xl mx-auto">
            <div className="text-center space-y-3 mb-16">
              <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">What the agent researches</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Everything an SDR needs before hitting send
              </h2>
              <p className="text-zinc-400 text-base max-w-xl mx-auto">
                The agent mimics how a great SDR researches a company — then packages it in a brief that&apos;s ready to act on.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {RESEARCH_AREAS.map((area) => (
                <div
                  key={area.title}
                  className={`rounded-xl border p-5 space-y-3 hover:bg-zinc-800/20 transition-colors ${area.accent}`}
                >
                  <span className="text-2xl" role="img" aria-hidden>{area.label}</span>
                  <div className="space-y-1.5">
                    <h3 className="text-sm font-semibold text-white">{area.title}</h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">{area.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What you get */}
        <section id="output" className="py-24 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <div className="space-y-6">
                <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">Research brief</p>
                <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
                  Every field in the brief is built for one purpose
                </h2>
                <p className="text-zinc-400 text-base leading-relaxed">
                  Could this help a salesperson write a better personalized email?
                  Every output is evaluated against that question.
                  Inference is labeled. Guesses are flagged. No hallucinated scores.
                </p>
                <Link
                  href="/admin/intelligence-lab"
                  className="inline-flex items-center gap-2 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Try it on a company <span aria-hidden>→</span>
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OUTPUTS.map((output) => (
                  <div
                    key={output}
                    className="flex items-center gap-2.5 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800/80 rounded-lg px-3 py-2.5 hover:border-zinc-700 hover:text-zinc-300 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    {output}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* SDR trust section */}
        <section className="py-24 px-6 bg-zinc-900/20">
          <div className="max-w-5xl mx-auto">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 sm:p-12 space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                <div className="space-y-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-400 flex items-center justify-center text-white font-bold text-lg">
                    ✓
                  </div>
                  <h3 className="text-xl font-bold text-white">Inferred is not a dirty word</h3>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    A welding company&apos;s website rarely says &ldquo;we have quality control problems.&rdquo;
                    An experienced SDR infers it from their business model. So does this agent —
                    and it labels every inference so you know what&apos;s fact vs. deduction.
                  </p>
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-teal-950 text-teal-300 border-teal-800">observed</span>
                      <span className="text-zinc-400">Directly stated on their website</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-orange-950 text-orange-300 border-orange-800">inferred</span>
                      <span className="text-zinc-400">Deduced from business model or industry</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Built for manufacturing &amp; automotive</h3>
                  <div className="space-y-3">
                    {[
                      { industry: 'Welding / fabrication', challenge: 'Quality control, parameter drift, rework reduction' },
                      { industry: 'Automotive supplier', challenge: 'JIT scheduling, OEM audit readiness, quality compliance' },
                      { industry: 'Multi-plant manufacturer', challenge: 'Cross-facility visibility, production consistency' },
                      { industry: 'Heavy industry / forging', challenge: 'Predictive maintenance, energy optimization' },
                    ].map((item) => (
                      <div key={item.industry} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                        <p className="text-xs font-medium text-zinc-300">{item.industry}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{item.challenge}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-6">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Try it on your next prospect
            </h2>
            <p className="text-zinc-400 text-base">
              Paste any manufacturing or automotive company URL and get a full research brief — pain points, opportunities, and a ready-to-send opener — in under 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/admin/intelligence-lab"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-zinc-950 hover:bg-zinc-100 font-semibold text-sm px-8 py-3.5 rounded-xl transition-colors"
              >
                Open Research Agent <span aria-hidden>→</span>
              </Link>
              <Link
                href="/admin/run-history"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-white text-sm px-8 py-3.5 rounded-xl transition-colors"
              >
                Browse past research
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center font-bold text-white text-[10px]">
              D
            </div>
            <span className="text-xs font-medium text-zinc-400">Demaze Technologies</span>
          </div>
          <p className="text-xs text-zinc-700">
            Internal outbound research tool &mdash; not for public distribution
          </p>
        </div>
      </footer>

    </div>
  )
}
