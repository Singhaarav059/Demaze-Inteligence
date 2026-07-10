import { buildCompanyProfile } from './lib/pipeline/evidence-extractor'

interface TestCase {
  name: string
  step: string
  content: string
  expect: Partial<{
    manufacturer: boolean
    industrial_vendor: boolean
    retailer: boolean
    pharma_biotech: boolean
    financial_institution: boolean
    healthcare_provider: boolean
    software_saas: boolean
    primary_type: string
  }>
}

const CASES: TestCase[] = [
  {
    name: 'Bharat Forge — forging manufacturer',
    step: 'Steps 5+6: retailer suppressed (consumer goods + automotive), manufacturer detected (leader in forgings)',
    content: `
      Bharat Forge is a global leader in forgings.
      We manufacture critical components for passenger vehicles, commercial vehicles.
      Our manufacturing facilities in Pune, Satara and Baramati are equipped with modern forging equipment.
      Consumer goods segment includes passenger cars and utility vehicles.
      Bharat Forge manufactures and exports forgings and machined components for automotive, oil and gas.
    `,
    expect: { manufacturer: true, retailer: false, primary_type: 'manufacturer' },
  },
  {
    name: 'B2B manufacturer with NDA clause',
    step: 'Step 2: NDA removed from pharma — must NOT become pharma_biotech',
    content: `
      We are a precision component manufacturer serving aerospace and defence.
      All customer engagements are covered by an NDA. We sign an NDA before sharing technical drawings.
      Our machining operations span 3 production facilities.
    `,
    expect: { pharma_biotech: false, manufacturer: true },
  },
  {
    name: 'Electronics manufacturer with EMI specs',
    step: 'Step 3: EMI removed from financial — must NOT become financial_institution',
    content: `
      We manufacture PCBs and electronic assemblies for industrial automation.
      All products comply with EMI and EMC standards. EMI shielding is a key feature of our enclosures.
      Our production facility operates 24/7 with 500 employees.
    `,
    expect: { financial_institution: false, manufacturer: true },
  },
  {
    name: 'Automotive OEM supplier — consumer goods vocab',
    step: 'Step 5: automotive anti-flag suppresses consumer goods trigger',
    content: `
      We supply forged components to global OEMs across commercial and consumer goods segments.
      Automotive stamping company serving Tier 1 suppliers.
      Our casting operations produce 50,000 tonnes per year.
    `,
    expect: { retailer: false, manufacturer: true },
  },
  {
    name: 'Industrial machine diagnostics platform',
    step: 'Step 4: bare diagnostic blocked — no pathology/imaging co-occurrence',
    content: `
      We provide diagnostic software for industrial machines and predictive diagnostics for factory equipment.
      Our diagnostic tool monitors CNC machine health in real time.
      Vehicle diagnostics platform for fleet management. Industrial automation solutions provider.
    `,
    expect: { healthcare_provider: false },
  },
  {
    name: 'Real hospital / healthcare provider',
    step: 'Step 4 regression: pathology + imaging still fires healthcare correctly',
    content: `
      Apollo Hospitals is a leading healthcare provider with 72 hospitals across India.
      We offer world-class diagnostic centers and pathology labs.
      Our diagnostic imaging facilities include MRI and CT scanners. Radiology department.
    `,
    expect: { healthcare_provider: true },
  },
  {
    name: 'HDFC Bank',
    step: 'Step 3 regression: loan/deposit/credit card still fires financial_institution',
    content: `
      HDFC Bank is India's largest private sector bank.
      We offer personal loans, home loans, credit cards, and fixed deposits.
      Our retail banking network spans 7,000+ branches.
    `,
    expect: { financial_institution: true },
  },
  {
    name: 'Pharma company with clinical trials',
    step: 'Step 2 regression: clinical_trial/fda/anda still fire pharma_biotech',
    content: `
      We are a leading pharmaceutical company. Our pipeline includes clinical trials in oncology.
      USFDA approved manufacturing facility. Three ANDA filings in FY25.
    `,
    expect: { pharma_biotech: true },
  },
  {
    name: 'Ador Welding — welding manufacturer',
    step: 'Step 6: welding company + our welding operations = manufacturer',
    content: `
      Ador Welding is a welding company with manufacturing plants across India.
      We manufacture welding consumables and welding equipment for industrial use.
      Our welding operations serve 5,000+ customers in manufacturing industries.
      Leader in welding solutions for the manufacturing sector.
    `,
    expect: { industrial_vendor: true, manufacturer: true },
  },
  {
    name: 'Zoho — SaaS (no false manufacturer)',
    step: 'Step 6 regression: SaaS company must not gain manufacturer flag',
    content: `
      Zoho offers a suite of over 55 cloud software products for businesses.
      Our SaaS platform serves 80 million users globally.
      Subscription-based software with monthly and annual plans.
      Cloud platform for CRM, ERP, and collaboration tools.
    `,
    expect: { software_saas: true, manufacturer: false },
  },
]

const C = { reset:'\x1b[0m', bold:'\x1b[1m', green:'\x1b[32m', red:'\x1b[31m', dim:'\x1b[2m', cyan:'\x1b[36m' }
let totalPass = 0, totalFail = 0

console.log(`\n${C.bold}buildCompanyProfile() — Steps 2–6 Unit Test${C.reset}`)
console.log('═'.repeat(72))

for (const tc of CASES) {
  const profile = buildCompanyProfile(tc.content)
  const ct = profile.company_type
  const checks: string[] = []
  let caseFailed = false

  for (const [field, expected] of Object.entries(tc.expect)) {
    const actual = field === 'primary_type'
      ? profile.primary_type
      : ct[field as keyof typeof ct]
    const pass = actual === expected
    if (pass) { checks.push(`  ${C.green}✓${C.reset} ${field} = ${String(actual)}`); totalPass++ }
    else { checks.push(`  ${C.red}✗${C.reset} ${field}: expected ${String(expected)}, got ${String(actual)}`); totalFail++; caseFailed = true }
  }

  const icon = caseFailed ? `${C.red}FAIL${C.reset}` : `${C.green}PASS${C.reset}`
  const trueFlags = Object.entries(ct).filter(([,v]) => v).map(([k]) => k)
  console.log(`\n${C.bold}${tc.name}${C.reset}  [${icon}]`)
  console.log(`  ${C.dim}${tc.step}${C.reset}`)
  for (const c of checks) console.log(c)
  console.log(`  ${C.dim}flags=[${trueFlags.join(', ') || 'none'}] primary=${profile.primary_type}${C.reset}`)
}

console.log(`\n${'═'.repeat(72)}`)
const overall = totalFail === 0 ? `${C.green}${C.bold}ALL PASS${C.reset}` : `${C.red}${C.bold}${totalFail} FAILED${C.reset}`
console.log(`${C.bold}RESULT: ${overall}  (${totalPass} checks passed, ${totalFail} failed)${C.reset}\n`)

process.exit(totalFail > 0 ? 1 : 0)
