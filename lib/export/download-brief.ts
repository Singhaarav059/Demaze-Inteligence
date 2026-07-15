'use client'

// ============================================================
// Brief download triggers (client-only — touch window/document).
// PDF  -> render the HTML in a hidden iframe and invoke print()
//         (the browser's "Save as PDF" produces the file).
// Word -> download the same HTML as a .doc blob; Word opens
//         HTML-based .doc files and keeps the formatting.
// ============================================================

import { buildBriefHtml, briefFileBase, type BriefInput, type BriefExtras } from './brief-html'

function withTimestamp(input: BriefInput): BriefInput {
  if (input.generatedAt) return input
  let stamp = ''
  try {
    stamp = new Date().toLocaleString()
  } catch {
    stamp = ''
  }
  return { ...input, generatedAt: stamp }
}

// Downloading PDF then Word for the same result calls this twice with the
// same (input, extras) references — reuse the built HTML instead of
// re-running the full appendix assembly a second time.
let lastInput: BriefInput | undefined
let lastExtras: BriefExtras | undefined
let lastHtml: string | undefined

function getBriefHtml(input: BriefInput, extras?: BriefExtras): string {
  if (lastHtml !== undefined && lastInput === input && lastExtras === extras) return lastHtml
  lastHtml = buildBriefHtml(withTimestamp(input), extras)
  lastInput = input
  lastExtras = extras
  return lastHtml
}

/** Open the brief in a hidden iframe and trigger the print dialog. */
export function downloadBriefPdf(input: BriefInput, extras?: BriefExtras): void {
  const html = getBriefHtml(input, extras)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  })
  document.body.appendChild(iframe)

  const cleanup = () => {
    // Give the print dialog time to grab the document before removal.
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1000)
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.focus()
    win.print()
    cleanup()
  }

  const doc = iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    return
  }
  doc.open()
  doc.write(html)
  doc.close()
}

/** Download the brief as a Word-openable .doc file. */
export function downloadBriefWord(input: BriefInput, extras?: BriefExtras): void {
  const html = getBriefHtml(input, extras)
  const blob = new Blob(['﻿', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${briefFileBase(input.companyName)}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
