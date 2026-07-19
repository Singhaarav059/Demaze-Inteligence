---
tags: [demaze, ui, export, code-review]
updated: 2026-07-13
---

# UI, Export & Code Review (most recent work)

← [[PROJECT_STATUS]]

> [!info] Scope of this note
> Covers the 5 most recent commits (mobile nav → brief export → full-analysis-detail export) plus the same-day recall-biased code review of that work (8 finder angles + a verification pass) and the fixes that came out of it. This is UI/export surface, separate from the backend pipeline tracked in [[Phase 1 - Pipeline Engineering]].

## Feature work
- [x] Mobile nav drawer + shared `nav-config.ts` (single source of truth for desktop Sidebar + mobile drawer) + fixed Inspector tab overflow on mobile
- [x] Admin pages redesigned: `intelligence-lab`, `batch-upload`, `run-history`; `ResearchCard.tsx` extracted into its own component and redesigned; landing page (`app/page.tsx`) restyled
- [x] `lib/text/humanize.ts` — strips AI-tell dashes/filler phrases from LLM narrative text for SDR-facing display (font/text polish pass)
- [x] Brief download: PDF (print-to-PDF via a hidden iframe) + Word (.doc via an HTML blob) — `lib/export/brief-html.ts` + `lib/export/download-brief.ts`
- [x] Export: full Analysis-tab detail included in the downloaded brief (`buildAnalysisAppendix`), not just the 5-field summary

## Code review — 10/10 findings fixed same day
Reviewed via 8 independent finder angles (line-by-line diff scan, removed-behavior audit, cross-file tracer, reuse/simplification/efficiency/altitude/conventions scans) + a 1-vote verification pass. All 10 candidates that survived verification were fixed:

- [x] **Inspector no longer humanizes verbatim evidence quotes** — `pp.evidence`/`sig.evidence`/`o.evidence` were being run through `humanizeText()`, silently rewriting scraped source text (e.g. turning an em dash into a comma inside a "verbatim" quote), while the export already had a rule against this. Split into `s()` (humanized display text) vs. `raw()` (verbatim quotes) in `page.tsx`
- [x] `humanize.ts` dash regex no longer eats unspaced numeric ranges — `\s*` → `\s+` around the em/en-dash match, so `30–50%` no longer becomes `30, 50%`
- [x] `humanize.ts` filler-phrase removal now re-capitalizes the sentence that follows a removed phrase, not just the very first character of the whole string
- [x] Exported brief no longer silently drops opportunities with a blank title — the export's `.filter((o) => o && o.title)` didn't match the on-screen `ResearchCard` behavior, which renders every opportunity regardless of title
- [x] `businessModel` field — was being collected into the export payload (`BriefInput.businessModel`) but never actually rendered anywhere in `buildBriefHtml` — now shown under Company Description, mirroring the on-screen conditional (skip if already present in the summary)
- [x] `kv()` HTML table-row helper hardened with a branded `Html` type (`type Html = string & { readonly __html: unique symbol }`) so a future raw/unescaped value literally can't type-check as a row — closes a latent HTML-injection risk that previously relied only on caller convention
- [x] `ResearchCard.tsx` company-name heading — restored the `truncate` class dropped during the redesign (was wrapping long company names instead of ellipsizing)
- [x] `TopBar.tsx` — no longer hardcodes its own `SECTIONS` route→label map; now derives from the same shared `NAV` config (`nav-config.ts`) that Sidebar/MobileNav already use, closing a drift risk
- [x] `download-brief.ts` — PDF and Word downloads of the *same* result now reuse one built HTML string (module-level memo keyed on object reference) instead of rebuilding the full appendix twice on a two-click path
- [x] **`buildAnalysisAppendix` / `AnalysisViewer` duplicated field-extraction** — the two were independently re-casting the same ~12 analysisResult sections. Resolved by extracting a new shared module, `lib/pipeline/analysis-sections.ts`, with typed getters (`getExecutiveBrief`, `getCompanyFit`, `getSignalClusters`, `getWhyDemaze`, etc.) for every top-level field both renderers need. Both files now import from it instead of hand-writing the cast twice.
  - Rendering itself (JSX vs. HTML string) is **still** two independent implementations, on purpose — one's interactive, one's a static export, and merging those is a bigger, riskier refactor than fits safely in one pass. See [[Left To Do]] for the residual risk this leaves open.

Verified after every fix: `tsc --noEmit` clean, all 52 existing tests green (`humanize.test.ts`, `brief-html.test.ts`, `enrichment-pdf.test.ts`, `batch-quota-pause.test.ts`).

## See also
- [[FRONTEND_REDESIGN]] — the original redesign plan these commits implemented
- [[Left To Do]] — the one item this review didn't fully close (appendix rendering duplication)
