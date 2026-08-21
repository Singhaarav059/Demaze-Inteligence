// ============================================================
// Company Universe — provider registry
// ============================================================
// One place listing every implemented CompanyDataProvider — mirrors this
// repo's existing per-capability PROVIDERS map convention (e.g.
// lib/outbound/sending/provider-factory.ts's PROVIDERS record), except this
// registry is consumed as an array (every configured provider contributes
// in parallel) rather than resolved down to one active selection, since
// this is a multi-provider layer, not a single-active-provider capability.
// ============================================================

import { IndiaMcaProvider } from './india-mca'
import { CompaniesHouseProvider } from './companies-house'
import { GleifProvider } from './gleif'
import { OpenCorporatesProvider } from './opencorporates'
import { SecEdgarProvider } from './sec-edgar'
import type { CompanyDataProvider } from '../types'

export const ALL_PROVIDERS: CompanyDataProvider[] = [
  IndiaMcaProvider,
  CompaniesHouseProvider,
  GleifProvider,
  OpenCorporatesProvider,
  SecEdgarProvider,
]

export {
  IndiaMcaProvider,
  CompaniesHouseProvider,
  GleifProvider,
  OpenCorporatesProvider,
  SecEdgarProvider,
}
