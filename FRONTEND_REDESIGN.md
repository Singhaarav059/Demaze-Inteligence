# Frontend / UI Redesign — Session Record

**Started:** 2026-07-12. **Status:** Phases 1–3 + 5 applied; Phase 4 dispatched but
UNVERIFIED (see below). **No build/typecheck/dev-server run was possible in the
session that did this work** — all changes are code-only and must be verified live
(see "Verification checklist" at the bottom).

## Session 2 (2026-07-12, later) — polish pass, typechecked + tested
This session ran with a working shell, so everything below IS `tsc --noEmit`-clean
and `npm test`-green (39 tests, 12 new). Still needs a **dev-server restart** on
Windows to see live (cross-OS watcher gotcha).
- **Critical font bug fixed** — `app/globals.css` had `--font-sans: var(--font-sans)`
  (circular → undefined → the whole app rendered in serif/Times). Now
  `var(--font-geist-sans)`. This was THE reason the redesign "looked like just a
  layout change" — serif type made a good dark theme read as an unstyled document.
  One-line fix, biggest visual win of the two sessions.
- **AI-writing cleanup** — new `lib/text/humanize.ts` (`humanizeText`/`humanizeList`)
  strips the AI tells from narrative fields at the DISPLAY layer: spaced em/en
  dashes and " -- " connectors → commas (in-word hyphens like "multi-plant",
  "30-50%", "tier-1" are left alone), plus filler phrases ("I hope this finds you
  well", "Furthermore", leverage/utilize→use). Applied across `ResearchCard.tsx`.
  Covered by `tests/humanize.test.ts` (12 assertions). ALSO fixed at the source:
  `system-v2.ts` + `analyze-v2.ts` prompts now carry an explicit WRITING STYLE
  block forbidding em dashes and filler and asking for a human SDR voice. Two-layer
  defense (prompt-side + display-side) so old cached runs get cleaned too.
- **ResearchCard redesigned to fill width** — was `max-w-3xl` with a big empty right
  gutter (user complaint). Now full-width with a 2-col hero (description card
  `lg:col-span-2` + an "At a glance" facts rail on the right that holds
  industry/segment/HQ/size + pain-point/opportunity count tiles), Recent News in a
  2-col list, and a full-width Personalization Summary with the angle quote beside a
  Lead-with/Why-now rail.
- **intelligence-lab page** — default mode `lightweight` → **`full`**; container
  `max-w-5xl` → `max-w-6xl`; the **Inspector now renders ABOVE** the ResearchCard
  hero + summary strip (was at the bottom) per user request.
- **Landing page (`app/page.tsx`) fully tokenized** — Phase 5 had only cleaned its
  text; now migrated zinc/blue → `dark` tokens + indigo/violet `primary` (added
  `dark` to the root wrapper since the landing page has no `.dark` ancestor; white
  CTAs → `bg-primary`). Structure/copy untouched.

### Session 2 follow-ups — static-text em-dash sweep + full narrative coverage
The user reported em dashes still showing in two places the first humanize pass did
not reach. Both fixed:
- **Hardcoded UI copy** (NOT model output) — em/en dashes were literally typed into
  JSX strings on the homepage and admin pages. Cleaned with a one-off line-by-line
  transform across `app/page.tsx`, `intelligence-lab/page.tsx`, `batch-upload/page.tsx`,
  `ResearchCard.tsx`: spaced ` — `/` – `, `&mdash;`/`&ndash;`, and numeric `3–5`
  ranges → commas / `3-5`. **Deliberately preserved**: the standalone `'—'`
  empty-value placeholder glyph (`value ?? '—'`) — that is a normal "no data"
  convention, not a sentence dash, and replacing it would look worse. Comment
  separators (`// ── … ──`) were left alone (never rendered).
- **Executive Brief / Analysis tab / Intelligence tab** — these render LLM narrative
  directly and never went through `humanizeText`. Fixed by routing the Analysis
  viewer's `s()` display helper through `humanizeText` for non-empty values (cleans
  every narrative field in that tab at once; still returns `'—'` for empties), plus
  direct `humanizeText(...)` wraps on fields that bypass `s()`: Executive Brief
  bullets (what_we_observed / what_it_means / what_to_sell / why_now), Intelligence
  strategic-theme tagline/businessImpact/demazeAngle, whyNow headline/narrative, and
  Why-Demaze reason/business_implication strings. **Verbatim source quotes
  (`ev.quote`, `r.evidence`) were intentionally NOT humanized** — they are extracted
  from the company's own website, not AI-written, so cleaning them would corrupt real
  evidence.
- Coverage now spans all three result surfaces: ResearchCard hero, Analysis tab,
  Intelligence tab. `humanizeText` lives in `lib/text/humanize.ts` with
  `tests/humanize.test.ts` (12 assertions). Full suite: 39 tests green,
  `tsc --noEmit` clean.

### Session 2 follow-up — mobile responsiveness
User asked whether the whole site is mobile-compatible. Audit found the layout was
mostly responsive already (content drops `md:pl-60`, grids collapse to 1–2 cols,
landing page uses `sm:`/`md:` breakpoints) EXCEPT two gaps, both now fixed:
- **No mobile navigation** (the real gap) — `Sidebar` is `hidden md:flex`, and the
  TopBar showed only a brand mark below `md`, so Research/Batch/History were
  unreachable on a phone. Added `components/shell/MobileNav.tsx`: a hamburger
  (`md:hidden`) that opens a left slide-in drawer (backdrop, body-scroll-lock, closes
  on link click) with the same nav items + active state. Extracted the nav list into
  `components/shell/nav-config.ts` so `Sidebar` and `MobileNav` share ONE source of
  truth (don't re-add a second copy). New `MenuIcon`/`CloseIcon` in `nav-icons.tsx`.
  Wired `<MobileNav />` into `TopBar`'s left side. NOTE: intentionally NO
  route-change `useEffect(() => setOpen(false))` — the React `set-state-in-effect`
  lint rule flags it and every nav link already closes the drawer via `onClick`, so
  it's redundant.
- **7-tab Inspector TabsList overflow** — `inline-flex w-fit` with 7 triggers spilled
  past a phone viewport. Wrapped it in an `overflow-x-auto` container so it scrolls
  horizontally on narrow screens instead of breaking layout.
- Everything else checked (batch-upload, run-history, ComparisonPanel): no raw
  tables, no fixed-width grids, busy rows already use `flex-wrap`. `tsc` clean,
  `eslint` clean on touched shell files, 39 tests green. Live mobile screenshot NOT
  taken (dev server needs the Windows restart to reflect these edits first).

## Why this exists
The site was built as a testing harness. Once the pipeline worked, the user asked to
"redesign and restructure completely… rebuild pro." This file is the full record of
that redesign so a new session has complete continuity.

## Locked decisions (confirmed by the user, do not relitigate)
- **Audience:** Internal SDR tool (a polished product for Demaze salespeople to run
  company research). NOT a public marketing site, NOT a client-facing SaaS.
- **Scope:** Full pro redesign — new design system, not just a polish pass.
- **Branding:** "You decide" — no fixed brand assets given.
- **Visual direction:** **Refined dark (Linear-like)** — near-black cool surfaces,
  vivid **indigo/violet** accent, dense layout, left **sidebar** shell, engineer/debug
  surfaces tucked into a collapsible **Inspector**.

## Design system (Phase 1 — DONE)
File: `app/globals.css` (fully rewritten).
- Refined-dark `.dark` theme: `--background` near-black cool `oklch(0.165 0.006 285)`,
  `--surface`/`--elevated` layered, `--primary` indigo/violet `oklch(0.64 0.19 277)`.
- Light `:root` kept (used only by the public landing page).
- **First-class evidence-strength tokens** (map onto the STRONG/MEDIUM/WEAK/insufficient
  signal model): `--signal-strong` (green), `--signal-medium` (amber), `--signal-weak`,
  `--signal-none`. Exposed as Tailwind utilities via `@theme inline`
  (`--color-signal-*`) → usable as `text-signal-strong`, `bg-signal-medium/10`,
  `border-signal-strong/30`, etc.
- Also added `--surface`/`--elevated` tokens and thin Linear-style scrollbars for `.dark`.
- The admin app is now forced into `.dark` at the layout level (before this, `.dark`
  was defined but never enabled — the admin hardcoded a separate `zinc` palette).

## App shell (Phase 2 — DONE)
New files:
- `components/shell/nav-icons.tsx` — thin-stroke inline SVG icons (Research/Batch/History/
  Chevron/Dot). **Deliberately NOT using lucide-react**: it's a listed dep but its version
  (`^1.23.0`) looked non-standard and it wasn't actually used anywhere, so inline SVGs
  avoid a broken-import risk. If you later adopt an icon lib, verify it renders first.
- `components/shell/Sidebar.tsx` — fixed left sidebar (w-60), brand mark (indigo→violet
  gradient "D"), nav items with icon+hint, **wired active state via `usePathname`** (the
  old admin nav had this stubbed but never wired), env footer chip. Hidden `< md`.
- `components/shell/TopBar.tsx` — slim sticky context bar, breadcrumb derived from
  pathname, mobile brand mark, "Internal" chip.
Modified:
- `app/admin/layout.tsx` — replaced the old hardcoded-zinc top nav with
  `<div className="dark"> … <Sidebar/> + <TopBar/> + main (md:pl-60)`.

## Intelligence Lab (Phase 3 — DONE)
The 1,949-line monolith was NOT fully extracted (too risky without a build to verify).
Instead the **main component chrome was reframed and restyled**, and the heavy debug
sub-components were **left in place** (they render fine and now live inside the collapsed
Inspector, so their internal hardcoded `zinc` styling is acceptable / low-priority).

File: `app/admin/intelligence-lab/page.tsx`
- Added `import { cn }`.
- Header simplified (removed redundant batch/history links — sidebar owns nav now).
- URL input, mode toggle, scrape-status pills, action buttons, running/save/error banners
  all restyled zinc→tokens (buttons now use shadcn `<Button>` default/outline variants;
  status pills use `signal-*`/`primary`/`destructive` tokens).
- **Reframe:** the `ResearchCard` is now rendered as a **hero** directly under the summary
  strip (was previously just one of 8 equal tabs). The remaining tabs (Scraper, Content,
  Analysis, Intelligence, Debug, Sources, Compare) are wrapped in a native
  `<details>` **Inspector** (collapsed by default). The `research_card` tab trigger +
  content were removed. Default `activeTab` changed `'research_card'` → `'analysis'`, and
  the run() post-analysis tab switch changed to `'analysis'`.
- `StatCard`/`TimingRow`/`EmptyState` helpers restyled to tokens.
- NOTE: `ActiveTab` type still includes the now-unused `'research_card'` value — harmless.
- NOTE: `AnalysisViewer`, `IntelligencePanel`, `DebugPanel`, `SourcesPanel` (the ~1200
  lines of debug UI) still use hardcoded `zinc-*` classes internally. Intentional — they're
  inside the collapsed Inspector. Tokenizing them is optional future polish.

File: `app/admin/intelligence-lab/ResearchCard.tsx` (fully rewritten)
- Restyled onto tokens + `signal-*` colors (evidence-strength badge maps signalCount →
  strong/medium/weak).
- Section labels aligned to the **locked 5-field schema**: Company Description / Recent
  News / Pain Points / AI Opportunities / Personalization Summary (was "Business
  Challenges" / "Demaze Opportunities" / "Recent Activity" / "Outreach Angle").
- No data-contract change — reads the same `analysisResult` fields as before.

File: `app/admin/intelligence-lab/ComparisonPanel.tsx` (fully rewritten)
- Restyled to tokens. Comparison rows changed from **legacy scores** (`company_fit`,
  `automation_opportunity`, `why_now_score`, `outreach_priority_score` — all dead/removed
  from the schema, were rendering "—") to schema-aligned rows (company, industry,
  confidence, pain-point count, opportunity count, recent-news count, signals detected).

## Landing page content cleanup (Phase 5 — DONE, styling left as-is)
File: `app/page.tsx`
- Removed **every out-of-scope claim** that violated the locked scope boundary
  (email-generation / contact-finding are permanently out of scope):
  - STATS: "Ready-to-send Opener" → "Fields Per Brief".
  - STEPS[03]: dropped "who to contact, and a cold email opener".
  - RESEARCH_AREAS: replaced "Who to Contact" and "Cold Email Opener" cards with
    "Personalization Summary" and "Evidence-backed"; renamed "Business Challenges"→
    "Pain Points", "Demaze Opportunities"→"AI Opportunities".
  - OUTPUTS: removed "Who to contact", "Reason each contact cares", "Send to (single best
    contact)"; reworded opener/challenges lines to schema-aligned wording.
  - Hero: "Write better emails." → "Personalize every outreach."; subtext "writes your
    cold email opener" → "hands you a personalization summary".
  - CTA: "a ready-to-send opener" → "a personalization summary".
- **NOT done (optional):** the landing page is still visually on its old dark-`zinc` +
  `blue`/`violet` gradient styling (not migrated to the new tokens / indigo primary). It's
  the lowest-priority surface (public, not the internal tool). Full token restyle deferred.

## Phase 4 — Batch + History restyle (DISPATCHED, UNVERIFIED — CHECK THESE FILES)
Two subagents were launched to mechanically restyle these onto tokens with the same
zinc→token / green→signal-strong / amber→signal-medium / red→destructive / blue→primary
mapping used everywhere else:
- `app/admin/batch-upload/page.tsx`
- `app/admin/run-history/page.tsx`
**Their completion was NOT confirmed in-session.** A new session MUST:
1. Open both files and grep for stray `zinc-`, `emerald-`, `amber-`, `yellow-`, `red-`,
   `blue-`, `indigo-`, `violet-` classes (excluding intentional brand gradients like
   `from-indigo-500 to-violet-600`). If present → the restyle is incomplete; finish it
   using the mapping in this doc.
2. Confirm no logic/JSX/structure was changed — the agents were told visual-only.
If the files are still fully zinc, treat Phase 4 as NOT started and redo it.

## Errors / environment gotchas hit this session
- **Bash was blocked** by the environment's auto-mode classifier — could NOT run
  `npm run dev`, `tsc --noEmit`, `npm test`, `git`, or any shell. All work is code edits
  via the file tools only. **Nothing was build- or type-checked.**
- The `Agent` tool was intermittently "temporarily unavailable"; the continuation/
  messaging tooling (SendMessage) and `ToolSearch` were not usable, so background agents
  could only be awaited, not polled.
- Reaffirmed known gotcha (already in CLAUDE.md): the Windows Next.js dev server does NOT
  hot-reload edits made from a Linux shell — **restart `npm run dev`** before judging any
  change.

## Verification checklist for the next session (do this first)
1. `npm run dev` (restart — cross-OS watcher). Also run `npx tsc --noEmit`.
2. Load `/admin/intelligence-lab`, `/admin/batch-upload`, `/admin/run-history`, and `/`
   — confirm no console/build errors, sidebar active states work, Inspector expands.
3. Finish/verify Phase 4 (the two files above).
4. Run a cached-scrape analysis to confirm the hero `ResearchCard` renders and the
   Inspector still shows Scraper/Content/Analysis/etc.
5. Optional polish (deferred, not blocking): tokenize the landing page; tokenize the
   debug panels inside the Inspector; add a mobile sidebar drawer (`< md` has no nav
   today); remove the unused `'research_card'` `ActiveTab` value.

## Files touched (summary)
Created: `components/shell/nav-icons.tsx`, `components/shell/Sidebar.tsx`,
`components/shell/TopBar.tsx`, this file.
Modified: `app/globals.css`, `app/admin/layout.tsx`,
`app/admin/intelligence-lab/page.tsx`, `app/admin/intelligence-lab/ResearchCard.tsx`,
`app/admin/intelligence-lab/ComparisonPanel.tsx`, `app/page.tsx`.
Dispatched (verify): `app/admin/batch-upload/page.tsx`, `app/admin/run-history/page.tsx`.
