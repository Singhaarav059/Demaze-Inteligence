import { describe, it, expect } from 'vitest'
import { buildBriefHtml, buildAnalysisAppendix, escapeHtml, briefFileBase, type BriefInput } from '../lib/export/brief-html'

const base: BriefInput = {
  companyName: 'Bharat Forge Limited',
  industry: 'Manufacturing',
  subIndustry: 'Forging',
  headquarters: 'Pune, India',
  sizeEstimate: '~5000 employees',
  confidence: 'medium',
  signalCount: 3,
  summary: 'Bharat Forge is a large forging company.',
  recentNews: ['Expanding into aerospace', 'New AI initiative'],
  painPoints: ['Cross-plant visibility', 'Quality consistency'],
  opportunities: [
    { title: 'AI Quality Control', description: 'Detect weld defects.', entryPoint: 'Plant Ops' },
  ],
  openingAngle: 'Saw your aerospace expansion.',
  whatToSell: 'AI Quality Control',
  whyNow: 'Public AI mandate from leadership.',
  generatedAt: '2026-07-13 09:00',
}

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('A & B <c> "d" \'e\'')).toBe('A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;')
  })
  it('returns empty for nullish', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('briefFileBase', () => {
  it('slugifies the company name', () => {
    expect(briefFileBase('Bharat Forge Limited')).toBe('bharat-forge-limited-research-brief')
  })
  it('falls back when empty', () => {
    expect(briefFileBase('')).toBe('company-research-brief')
  })
})

describe('buildBriefHtml', () => {
  const html = buildBriefHtml(base)

  it('produces a full HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
  })

  it('includes the company name and all five sections', () => {
    expect(html).toContain('Bharat Forge Limited')
    expect(html).toContain('Company Description')
    expect(html).toContain('Recent News')
    expect(html).toContain('Pain Points')
    expect(html).toContain('AI Opportunities')
    expect(html).toContain('Personalization Summary')
  })

  it('renders list content and opportunity fields', () => {
    expect(html).toContain('Cross-plant visibility')
    expect(html).toContain('AI Quality Control')
    expect(html).toContain('Plant Ops')
    expect(html).toContain('Saw your aerospace expansion.')
  })

  it('escapes injected markup in company data', () => {
    const evil = buildBriefHtml({ ...base, companyName: 'Acme <script>alert(1)</script>' })
    expect(evil).not.toContain('<script>alert(1)</script>')
    expect(evil).toContain('&lt;script&gt;')
  })

  it('omits empty sections gracefully', () => {
    const minimal = buildBriefHtml({ companyName: 'X Co' })
    expect(minimal).toContain('X Co')
    expect(minimal).not.toContain('Personalization Summary')
    expect(minimal).not.toContain('Recent News')
  })
})

describe('buildAnalysisAppendix', () => {
  it('returns empty when there is no analysis or signals', () => {
    expect(buildAnalysisAppendix({})).toBe('')
    // An analysis object with no populated sections yields no appendix.
    expect(buildAnalysisAppendix({ analysis: {}, signals: [] })).toBe('')
  })

  it('renders the executive brief, business model, and evidence bank', () => {
    const html = buildAnalysisAppendix({
      analysis: {
        executive_brief: {
          what_we_observed: ['Three plants in India — verified'],
          what_it_means: ['Cross-plant visibility gap'],
          what_to_sell: 'AI Quality Control',
          why_now: 'AI mandate from leadership',
          overall_confidence: 'medium',
        },
        business_model_analysis: {
          model_type: 'Manufacturer',
          core_operational_activities: ['Forging', 'Machining'],
        },
        signal_clusters: [
          { theme: 'Multi-plant ops', description: 'Several facilities', confidence: 'high', tier: 1, signals_present: ['facility_count'] },
        ],
      },
      signals: [
        {
          type: 'facility_count',
          strength: 'strong',
          validated: true,
          evidence: [{ quote: 'We operate 6 plants — across India', source_url: 'https://x.com/about', evidence_strength: 'high', source_tier: 'tier1', subject: 'company_operations' }],
        },
      ],
    })
    expect(html).toContain('Analysis Detail')
    expect(html).toContain('Executive Brief')
    expect(html).toContain('AI Quality Control')
    expect(html).toContain('Business Model Analysis')
    expect(html).toContain('Forging')
    expect(html).toContain('Evidence Bank')
    // Verbatim source quote kept intact (dash NOT converted — it is not AI text)
    expect(html).toContain('We operate 6 plants — across India')
  })

  it('humanizes AI narrative but escapes injected markup', () => {
    const html = buildAnalysisAppendix({
      analysis: {
        executive_brief: { what_to_sell: 'Foo — bar <b>x</b>', what_we_observed: [], what_it_means: [] },
      },
    })
    // em dash in AI narrative -> comma; markup escaped
    expect(html).toContain('Foo, bar')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('is appended to buildBriefHtml when extras are passed', () => {
    const html = buildBriefHtml({ companyName: 'X Co' }, { analysis: { signals: [{ type: 't', category: 'c', strength: 'strong', evidence: 'q' }] } })
    expect(html).toContain('Analysis Detail')
    expect(html).toContain('Signals')
  })
})
