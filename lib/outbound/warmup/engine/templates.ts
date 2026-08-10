// ============================================================
// Warmup content templates — no LLM call
// ============================================================
// Deliberately not calling getCompletion() (lib/ai/provider-factory.ts) —
// the user asked for this to be free and low-latency, and warmup content
// doesn't need to be clever, just varied enough to not look like the exact
// same email over and over. Short, generic, everyday-business register.
// Deliberately avoids the literal words "test"/"warmup"/"automated"
// anywhere — a spam classifier (and a human skimming their own inbox)
// would read those as exactly what they are, undermining the point.
// ============================================================

export interface WarmupContent {
  subject: string
  body: string
}

interface Template {
  subject: string
  body: string
}

const GREETINGS = ['Hi', 'Hey', 'Hello'] as const
const CLOSERS = ['Thanks', 'Best', 'Cheers', 'Talk soon'] as const
const FILLERS = [
  'Hope your week is going well.',
  'Hope things are going smoothly on your end.',
  'Hope you had a good weekend.',
  '',
] as const

// Each {greeting}/{closer}/{filler} slot is substituted at generation time —
// keeps the template count small while still giving real variation across
// sends, same "light randomization over a small pool" approach used
// elsewhere in this repo rather than a heavier content-generation system.
const TEMPLATES: Template[] = [
  {
    subject: 'Quick question',
    body: '{greeting},\n\n{filler}Quick one — do you have a few minutes this week to catch up?\n\n{closer}',
  },
  {
    subject: 'Following up',
    body: '{greeting},\n\n{filler}Just circling back on this — let me know if you get a chance to look.\n\n{closer}',
  },
  {
    subject: 'Checking in',
    body: '{greeting},\n\n{filler}Wanted to check in and see how things are going.\n\n{closer}',
  },
  {
    subject: 'Quick update',
    body: '{greeting},\n\n{filler}Just a quick update from my end — nothing urgent, will follow up properly soon.\n\n{closer}',
  },
  {
    subject: 'A quick note',
    body: '{greeting},\n\n{filler}Dropping a quick note — happy to jump on a call if useful.\n\n{closer}',
  },
  {
    subject: 'Circling back',
    body: '{greeting},\n\n{filler}Circling back on our last conversation — any updates on your end?\n\n{closer}',
  },
  {
    subject: 'Got a minute?',
    body: '{greeting},\n\n{filler}Got a minute sometime this week? Nothing major, just wanted to touch base.\n\n{closer}',
  },
  {
    subject: 'One more thing',
    body: '{greeting},\n\n{filler}One more thing I wanted to mention — let me know your thoughts when you can.\n\n{closer}',
  },
  {
    subject: 'Hope this finds you well',
    body: '{greeting},\n\n{filler}Wanted to reach out and see where things stand.\n\n{closer}',
  },
  {
    subject: 'Touching base',
    body: '{greeting},\n\n{filler}Touching base — no rush at all, whenever works for you.\n\n{closer}',
  },
]

const REPLY_TEMPLATES: Template[] = [
  { subject: '', body: 'Thanks, got it!' },
  { subject: '', body: 'Sounds good, appreciate it.' },
  { subject: '', body: 'Got your note — will follow up.' },
  { subject: '', body: 'Thanks for the update.' },
  { subject: '', body: 'Noted, thank you.' },
  { subject: '', body: 'Appreciate you reaching out.' },
]

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

function fillTemplate(t: Template, rng: () => number): WarmupContent {
  const body = t.body
    .replace('{greeting}', pick(GREETINGS, rng))
    .replace('{filler}', pick(FILLERS, rng))
    .replace('{closer}', pick(CLOSERS, rng))
  return { subject: t.subject, body }
}

export function pickWarmupTemplate(rng: () => number = Math.random): WarmupContent {
  return fillTemplate(pick(TEMPLATES, rng), rng)
}

export function pickWarmupReplyTemplate(rng: () => number = Math.random): WarmupContent {
  return fillTemplate(pick(REPLY_TEMPLATES, rng), rng)
}
