// ============================================================
// Company Discovery — structured search filter options
// ============================================================
// Pure constants/mappers for the search form. Explee is the only discovery
// source behind this page (see lib/enrichment/sources/explee-client.ts) —
// nothing here exposes that; it just turns a Demaze-native filter choice
// (a sector name, a country chip, an employee-range label) into the
// `definition`/`geo_include`/`size` shape the existing
// /api/admin/explee-discovery route already accepts, unchanged.
// ============================================================

// The 3 sectors Demaze is actively targeting (CLAUDE.md's confirmed target
// industries + the sector playbook) — not a generic industry list.
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

export interface EmployeeRange {
  key: string
  label: string
  min?: number
  max?: number
}

export const EMPLOYEE_RANGES: EmployeeRange[] = [
  { key: '1-10', label: '1-10 employees', min: 1, max: 10 },
  { key: '11-50', label: '11-50 employees', min: 11, max: 50 },
  { key: '51-200', label: '51-200 employees', min: 51, max: 200 },
  { key: '201-500', label: '201-500 employees', min: 201, max: 500 },
  { key: '501-1000', label: '501-1,000 employees', min: 501, max: 1000 },
  { key: '1001-5000', label: '1,001-5,000 employees', min: 1001, max: 5000 },
  { key: '5000+', label: '5,000+ employees', min: 5001, max: undefined },
]

// Curated common-HQ countries (ISO 3166-1 alpha-2 — Explee's geo_include
// filter takes these codes directly). Not exhaustive; kept short enough to
// render as toggle chips instead of a long searchable dropdown.
export const COUNTRY_OPTIONS: { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'IN', label: 'India' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'FR', label: 'France' },
  { code: 'IT', label: 'Italy' },
  { code: 'ES', label: 'Spain' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'SE', label: 'Sweden' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'JP', label: 'Japan' },
  { code: 'CN', label: 'China' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'United Arab Emirates' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
]
