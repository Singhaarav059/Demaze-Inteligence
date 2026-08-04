// One-off icon generator — not part of the app's runtime or build. Renders
// the PWA app icons (public/icons/) as an SVG matching BrandMark's exact
// gradient ("D" chip on primary→primary-hover) rasterized to PNG via
// sharp, which is already a project dependency (Next.js image
// optimization). Colors are converted from the theme's OKLCH values
// (app/globals.css --primary / --primary-hover) to sRGB hex via the
// standard OKLab reference conversion, so the icon matches the real brand
// color exactly rather than an eyeballed approximation. Re-run manually
// (`node scripts/generate-app-icons.mjs`) if the theme's primary color
// ever changes.

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

function iconSvg(size, { maskableSafeArea = false } = {}) {
  // Maskable icons need real content kept within an ~80% "safe zone" circle
  // (Android can crop to a circle/squircle/etc.) — shrink the chip and
  // center it rather than filling edge-to-edge for those variants.
  const pad = maskableSafeArea ? size * 0.1 : 0
  const inner = size - pad * 2
  const radius = maskableSafeArea ? inner * 0.22 : size * 0.22
  const fontSize = inner * 0.52
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
  <text x="${size / 2}" y="${size / 2}" font-family="Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">D</text>
</svg>`.trim()
}

const targets = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'maskable-icon-512.png', size: 512, maskableSafeArea: true },
]

for (const t of targets) {
  const svg = iconSvg(t.size, { maskableSafeArea: t.maskableSafeArea })
  await sharp(Buffer.from(svg)).png().toFile(join(outDir, t.name))
  console.log(`[icons] wrote ${t.name}`)
}
