// ============================================================
// Company Universe — provider registry
// ============================================================
// One place listing every implemented CompanyDataProvider — mirrors this
// repo's existing per-capability PROVIDERS map convention (e.g.
// lib/outbound/sending/provider-factory.ts's PROVIDERS record), except this
// registry is consumed as an array (every configured provider contributes
// in parallel) rather than resolved down to one active selection, since
// this is a multi-provider layer, not a single-active-provider capability.
//
// Deliberately exactly 4 providers, no more. OpenCorporates was removed
// (2026-08-21, user directive): this layer's goal is a free-first structured
// company universe feeding the existing Demaze discovery/qualification/
// research pipeline, not a global company-database replacement, and
// OpenCorporates was the one provider here with unconfirmed commercial-use/
// paid-tier terms (see the removed docs/company-universe-sources.md entry).
// Do not re-add it or any other paid/commercial provider without an
// explicit, separate decision — same standing discipline this repo already
// applies to every other vendor choice (see CLAUDE.md).
// ============================================================

import { IndiaMcaProvider } from './india-mca'
import { CompaniesHouseProvider } from './companies-house'
import { GleifProvider } from './gleif'
import { SecEdgarProvider } from './sec-edgar'
import type { CompanyDataProvider } from '../types'

export const ALL_PROVIDERS: CompanyDataProvider[] = [
  IndiaMcaProvider,
  CompaniesHouseProvider,
  GleifProvider,
  SecEdgarProvider,
]

export {
  IndiaMcaProvider,
  CompaniesHouseProvider,
  GleifProvider,
  SecEdgarProvider,
}
