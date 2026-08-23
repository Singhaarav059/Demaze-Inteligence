import type { MetadataRoute } from 'next'

// Next.js's native manifest route convention - served at /manifest.webmanifest.
// Scoped to the admin product specifically (start_url + scope), per the
// 2026-08-04 mobile pass: the public landing page was deliberately left out
// of this app-like/installable treatment, only the internal admin tool.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Demaze Outbound Intelligence',
    short_name: 'Demaze',
    description: 'AI-powered company research, decision-maker discovery, and outreach - one guided flow.',
    start_url: '/admin/auto-gtm',
    scope: '/admin',
    display: 'standalone',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    orientation: 'portrait',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
