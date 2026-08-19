// Plain constants split out of demaze-leads.ts so a client component that
// only needs DEMAZE_URL (app/admin/company-discovery/page.tsx) doesn't
// transitively pull in demaze-leads.ts's server-only search/discovery
// import chain into the browser bundle — that chain reaches
// lib/pipeline/research-metrics.ts's `node:async_hooks` import, which
// Turbopack's client chunking context cannot resolve at all (a hard build
// failure, not just a warning). Zero imports here on purpose.

export const DEMAZE_URL = 'https://www.demazetech.com/'
export const DEMAZE_DOMAIN = 'demazetech.com'
// Passed as excludeCompanyNames to discoverCompanies() for every segment, so
// Demaze never lists itself as its own lead — same isSelfName() word-overlap
// check every other discovery module already uses for this.
export const DEMAZE_EXCLUDE_NAMES = ['Demaze', 'Demaze Technologies', 'Demaze Tech', 'Demazetech']
