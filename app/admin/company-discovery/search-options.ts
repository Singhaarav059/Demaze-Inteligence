// ============================================================
// Company Discovery - structured search filter options
// ============================================================
// Pure constants/mappers for the search form. Explee is the only discovery
// source behind this page (see lib/enrichment/sources/explee-client.ts) -
// nothing here exposes that; every option maps to a real, verified field on
// Explee's PublicCompaniesFilters (checked directly against Explee's own
// OpenAPI schema before adding any of these).
// ============================================================

// The 3 sectors Demaze is actively targeting (CLAUDE.md's confirmed target
// industries + the sector playbook) - not a generic industry list.
export const SECTOR_OPTIONS = ['Manufacturing', 'Automotive', 'E-commerce'] as const
export type SectorOption = (typeof SECTOR_OPTIONS)[number]

const SECTOR_DEFINITIONS: Record<SectorOption, string> = {
  Manufacturing: 'manufacturing company',
  Automotive: 'automotive company',
  'E-commerce': 'e-commerce company',
}

export function sectorDefinition(sector: SectorOption): string {
  return SECTOR_DEFINITIONS[sector]
}

export interface RangeOption {
  key: string
  label: string
  min?: number
  max?: number
}

// Maps to Explee's `size: {min, max}` (estimated employee count).
export const EMPLOYEE_RANGES: RangeOption[] = [
  { key: '1-10', label: '1-10 employees', min: 1, max: 10 },
  { key: '11-50', label: '11-50 employees', min: 11, max: 50 },
  { key: '51-200', label: '51-200 employees', min: 51, max: 200 },
  { key: '201-500', label: '201-500 employees', min: 201, max: 500 },
  { key: '501-1000', label: '501-1,000 employees', min: 501, max: 1000 },
  { key: '1001-5000', label: '1,001-5,000 employees', min: 1001, max: 5000 },
  { key: '5001-10000', label: '5,001-10,000 employees', min: 5001, max: 10000 },
  { key: '10001+', label: '10,001+ employees', min: 10001, max: undefined },
]

// Maps to Explee's `revenue_annual: {min, max}` (estimated annual revenue,
// USD). Boundaries are non-overlapping and inclusive on both ends.
export const REVENUE_RANGES: RangeOption[] = [
  { key: 'under-1m', label: 'Under $1M', min: undefined, max: 999_999 },
  { key: '1m-10m', label: '$1M–$10M', min: 1_000_000, max: 9_999_999 },
  { key: '10m-50m', label: '$10M–$50M', min: 10_000_000, max: 49_999_999 },
  { key: '50m-100m', label: '$50M–$100M', min: 50_000_000, max: 99_999_999 },
  { key: '100m-500m', label: '$100M–$500M', min: 100_000_000, max: 499_999_999 },
  { key: '500m-1b', label: '$500M–$1B', min: 500_000_000, max: 999_999_999 },
  { key: '1b+', label: '$1B+', min: 1_000_000_000, max: undefined },
]

// Primary HQ picks (spec: keep the main screen to 3 broad choices, not a
// country list). Each maps to a curated set of real ISO 3166-1 alpha-2
// codes - Explee's own geo_include format - so "Europe"/"America" are a
// Demaze-defined grouping over real, verified country codes, not invented
// geography. Individual countries live in "More locations" below.
export interface RegionOption {
  key: string
  label: string
  countries: string[]
}

export const REGION_OPTIONS: RegionOption[] = [
  { key: 'india', label: 'India', countries: ['IN'] },
  {
    key: 'europe', label: 'Europe',
    countries: ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'CH', 'BE', 'PL', 'IE', 'AT', 'DK', 'NO', 'FI', 'PT', 'GR', 'CZ', 'RO', 'HU'],
  },
  { key: 'america', label: 'America', countries: ['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO'] },
]

// ISO 3166-1 alpha-2 codes only (a stable, essentially-static list) -
// labels come from the native Intl.DisplayNames API, not hand-typed.
// `Intl.supportedValuesOf('region')` looks like the more "native" way to
// get this list, but real engines (V8/Node - confirmed live, not assumed)
// throw `RangeError: Invalid key : region`; "region" was dropped from
// supportedValuesOf's key set before shipping, so it isn't usable.
const ISO_3166_1_ALPHA_2 = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const

export interface CountryOption {
  code: string
  label: string
}

let cachedCountries: CountryOption[] | null = null
export function allCountryOptions(): CountryOption[] {
  if (cachedCountries) return cachedCountries
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
  cachedCountries = ISO_3166_1_ALPHA_2
    .map(code => ({ code, label: displayNames.of(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return cachedCountries
}

export function countryLabel(code: string): string {
  return allCountryOptions().find(c => c.code === code)?.label ?? code
}

// Maps directly to Explee's is_* boolean filters - verified names.
export const COMPANY_TYPE_FILTERS: { key: string; label: string }[] = [
  { key: 'isB2b', label: 'B2B' },
  { key: 'isTech', label: 'Technology' },
  { key: 'isSaas', label: 'SaaS' },
  { key: 'isStartup', label: 'Startup' },
  { key: 'isDigital', label: 'Digital' },
  { key: 'isAi', label: 'AI' },
  { key: 'isMerchant', label: 'Merchant' },
]

// Maps directly to Explee's has_* boolean filters - verified names.
export const PRESENCE_FILTERS: { key: string; label: string }[] = [
  { key: 'hasLinkedinPage', label: 'Has LinkedIn page' },
  { key: 'hasEmployeesOnLinkedin', label: 'Has employees on LinkedIn' },
  { key: 'hasPublicEmails', label: 'Has public emails' },
  { key: 'hasCompanyPhone', label: 'Has company phone' },
]

const compactUsd = new Intl.NumberFormat('en-US', { notation: 'compact', style: 'currency', currency: 'USD', maximumFractionDigits: 1 })
export function formatRevenue(value: number): string {
  return compactUsd.format(value)
}
