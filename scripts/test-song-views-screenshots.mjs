#!/usr/bin/env node
/**
 * Screenshots: Original-only song viewer (no Akkorde / LeadSheet tabs).
 */
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'app/dist')
const outDir = join(root, 'tmp/song-views')
const artifactDir = existsSync('/opt/cursor/artifacts') ? '/opt/cursor/artifacts' : join(root, 'tmp/artifacts')
mkdirSync(outDir, { recursive: true })
mkdirSync(artifactDir, { recursive: true })

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const TITLE = 'Bahnt einen Weg unserm Gott'
const mockUser = { id: 'view-test', name: 'View Test', role: 'admin', mustChangePassword: false, hasPhoto: false }
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const mockSong = {
  id: 'bahnt-1',
  title: TITLE,
  artist: 'PDF-Import',
  key: 'G',
  sourceKey: 'G',
  preferredKey: '',
  hasPdf: true,
  variantKeys: [],
  sortOrder: 1,
  bpm: 120,
  hasLeadSheet: false,
  snapshotStatus: 'none',
  sourceKeyVerified: false,
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

const MINI_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 78>>stream\nBT /F1 18 Tf 72 720 Td (Bahnt einen Weg unserm Gott) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000394 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n466\n%%EOF\n',
)

async function routeApi(request, route) {
  const url = request.url()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/api/songs/bahnt-1/pdf')) {
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: MINI_PDF })
  }
  if (url.includes('/api/songs/bahnt-1/pages')) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840"><rect width="100%" height="100%" fill="#fff"/><text x="36" y="72" font-size="28" font-family="sans-serif" fill="#172230">Bahnt einen Weg unserm Gott</text></svg>`
    return fulfillJson(route, { pages: [{ mime: 'image/svg+xml', dataUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` }] })
  }
  if (url.includes('/api/songs/bahnt-1/resolve-youtube')) {
    return fulfillJson(route, { ok: true, youtubeUrl: 'https://www.youtube.com/results?search_query=test' })
  }
  if (url.includes('/api/songs/bahnt-1/analyze-chords')) return fulfillJson(route, { error: 'gone', originalOnly: true }, 410)
  if (url.includes('/api/songs/bahnt-1/musicxml')) return fulfillJson(route, { error: 'gone', originalOnly: true }, 410)
  if (url.includes('/api/songs/bahnt-1/variants')) return fulfillJson(route, [])
  if (url.includes('/api/songs/bahnt-1/snapshot')) {
    return fulfillJson(route, { snapshotStatus: 'none', hasLeadSheet: false, bpm: 120 })
  }
  if (url.includes('/api/songs')) return fulfillJson(route, [mockSong])
  if (url.includes('/api/sets')) return fulfillJson(route, [])
  if (url.includes('/api/team')) return fulfillJson(route, [])
  if (url.includes('/api/bands')) return fulfillJson(route, [])
  if (url.includes('/api/appointments')) return fulfillJson(route, [])
  if (url.includes('/api/version')) return fulfillJson(route, { version: '1.1.0', releaseUrl: 'https://songbook.lyruma.de' })
  return fulfillJson(route, [])
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let filePath = join(dist, urlPath === '/' ? 'index.html' : urlPath)
      if (!filePath.startsWith(dist)) {
        res.writeHead(403); res.end(); return
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(dist, 'index.html')
      const ext = extname(filePath)
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
      res.end(readFileSync(filePath))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('app/dist missing — run: cd app && npm run build')
    process.exit(1)
  }
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    playwright = await import(pathToFileURL(join(root, 'app/node_modules/playwright/index.mjs')).href)
  }

  const server = await startStaticServer()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const browser = await playwright.chromium.launch()
  const saved = []

  const viewports = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 834, height: 1112 },
  ]

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: 'de-DE',
      serviceWorkers: 'block',
    })
    await context.addInitScript(() => { try { localStorage.setItem('songbook-locale', 'de') } catch {} })
    await context.route('**/api/**', async (route) => routeApi(route.request(), route))
    const page = await context.newPage()
    await page.goto(`${base}/#/songs/bahnt-1/editor`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    const original = page.getByRole('button', { name: 'ORIGINAL', exact: true })
    await original.waitFor({ timeout: 5000 })
    if (await page.getByRole('button', { name: 'AKKORDE', exact: true }).count()) {
      throw new Error('AKKORDE button must be removed')
    }
    if (await page.getByRole('button', { name: 'LEADSHEET', exact: true }).count()) {
      throw new Error('LEADSHEET button must be removed')
    }
    if (await page.getByText('Tonart ändern', { exact: true }).count()) {
      throw new Error('Tonart ändern must be removed from player UI')
    }
    for (const label of ['YouTube Probe', 'Stimmgerät']) {
      if (!(await page.getByRole('button', { name: label }).count())) {
        throw new Error(`missing button: ${label}`)
      }
    }

    const file = `bahnt_original_${vp.name}.png`
    const dest = join(outDir, file)
    await page.screenshot({ path: dest, fullPage: true })
    copyFileSync(dest, join(artifactDir, file))
    saved.push(file)
    console.log('wrote', file)
    await context.close()
  }

  await browser.close()
  server.close()
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ saved, title: TITLE, mode: 'original-only' }, null, 2))
  console.log('test-song-views-screenshots: saved', saved.join(', '))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
