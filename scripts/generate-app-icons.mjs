// One-off icon generator — not part of the app's runtime or build. Renders
// the PWA app icons (public/icons/) as a gradient backdrop (primary→
// primary-hover) with the real Demaze logo mark (public/brand/
// demaze-mark.png, the same asset BrandMark.tsx renders) composited on top
// via sharp, which is already a project dependency (Next.js image
// optimization). Colors are converted from the theme's OKLCH values
// (app/globals.css --primary / --primary-hover) to sRGB hex via the
// standard OKLab reference conversion, so the backdrop matches the real
// brand color exactly rather than an eyeballed approximation. Re-run
// manually (`node scripts/generate-app-icons.mjs`) if the theme's primary
// color ever changes, or if public/brand/demaze-mark.png is replaced.
//
// Previously drew an SVG "D" glyph instead of a real logo (no brand asset
// was available yet) - replaced 2026-08-23 once the real mark was pulled
// from demazetech.com, same swap BrandMark.tsx itself got.

import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

function oklchToHex(L, C, H) {
  const hRad = (H * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

  const toSrgb = (c) => {
    const clamped = Math.min(1, Math.max(0, c))
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  }

  const toHex = (c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, '0')
  return `#${toHex(rLin)}${toHex(gLin)}${toHex(bLin)}`
}

const primary = oklchToHex(0.64, 0.19, 277)
const primaryHover = oklchToHex(0.72, 0.16, 277)
console.log(`[icons] primary=${primary} primaryHover=${primaryHover}`)

function backdropSvg(size, { maskableSafeArea = false } = {}) {
  // Maskable icons need real content kept within an ~80% "safe zone" circle
  // (Android can crop to a circle/squircle/etc.) — a plain full-bleed fill
  // behind it, rather than the rounded gradient chip the other variants use.
  const pad = maskableSafeArea ? size * 0.1 : 0
  const inner = size - pad * 2
  const radius = maskableSafeArea ? inner * 0.22 : size * 0.22
  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${primary}"/>
      <stop offset="100%" stop-color="${primaryHover}"/>
    </linearGradient>
  </defs>
  ${maskableSafeArea ? `<rect width="${size}" height="${size}" fill="${primary}"/>` : ''}
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${radius}" fill="url(#g)"/>
</svg>`.trim()
}

const markPath = join(__dirname, '..', 'public', 'brand', 'demaze-mark.png')

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'maskable-icon-512.png', size: 512, maskableSafeArea: true },
]

for (const t of targets) {
  const backdrop = backdropSvg(t.size, { maskableSafeArea: t.maskableSafeArea })
  // Mark sized to ~55% of the icon (same rough proportion the old "D"
  // glyph's fontSize used). Recolored to solid white via a 'dest-in'
  // composite (a solid white square, masked down to the mark's own alpha
  // shape) so it reads clearly against the primary-color backdrop instead
  // of blending into it - the source mark is itself a blue gradient, close
  // in hue to the backdrop.
  const markSize = Math.round(t.size * 0.55)
  const markAlpha = await sharp(markPath)
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()
  const whiteMark = await sharp({
    create: { width: markSize, height: markSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: markAlpha, blend: 'dest-in' }])
    .png()
    .toBuffer()
  await sharp(Buffer.from(backdrop))
    .composite([{ input: whiteMark, gravity: 'center' }])
    .png()
    .toFile(join(outDir, t.name))
  console.log(`[icons] wrote ${t.name}`)
}
