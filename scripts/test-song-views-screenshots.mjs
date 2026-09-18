#!/usr/bin/env node
/**
 * Screenshots: Bahnt einen Weg unserm Gott — ORIGINAL / AKKORDE / LEADSHEET
 * at phone and tablet sizes.
 */
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractEditorChordModel, extractEditorChordAnchors } from '../lib/editorKey.mjs'
import { buildLeadSheetMusicXml } from '../lib/musicxmlLeadSheet.mjs'

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
const CHORD_TEXT = `${TITLE}

[Strophe 1]
G          C
Bahnt einen Weg unserm Gott
G
Ehre sei Gott

[Refrain]
D          G
unserm Gott die Ehre`
const MUSICXML = buildLeadSheetMusicXml({
  title: TITLE,
  key: 'G',
  notes: [
    { id: 'n1', measure: 1, onset: 0, staff: 1, step: 'G', octave: 4, duration: 1, x: 90, y: 160, lyric: 'ei' },
    { id: 'n2', measure: 1, onset: 1, staff: 1, step: 'A', octave: 4, duration: 1, x: 160, y: 155, lyric: 'nen' },
    { id: 'n3', measure: 1, onset: 2, staff: 1, step: 'B', octave: 4, duration: 1, x: 250, y: 150, lyric: 'Weg' },
    { id: 'n4', measure: 1, onset: 3, staff: 1, step: 'D', octave: 5, duration: 1, x: 310, y: 145, lyric: 'un' },
  ],
  chords: [{ text: 'G', x: 90, measure: 1 }, { text: 'C', x: 250, measure: 1 }],
  lyricTokens: [
    { text: 'ei', bbox: [80, 220, 105, 250] },
    { text: 'nen', bbox: [150, 220, 200, 250] },
    { text: 'Weg', bbox: [230, 220, 280, 250] },
    { text: 'un', bbox: [300, 220, 330, 250] },
  ],
})

const mockUser = { id: 'view-test', name: 'View Test', role: 'admin', mustChangePassword: false, hasPhoto: false }
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const mockSong = {
  id: 'bahnt-1',
  title: TITLE,
  artist: 'PDF-Import',
  key: 'G',
  sourceKey: 'G',
  preferredKey: 'G',
  hasPdf: true,
  variantKeys: ['G'],
  sortOrder: 1,
  bpm: null,
  hasLeadSheet: true,
  snapshotStatus: 'verified',
  sourceKeyVerified: true,
}

const originalText = CHORD_TEXT
const snapshot = {
  id: 'snap-1',
  songId: 'bahnt-1',
  sourceKey: 'G',
  originalText,
  originalChordModel: extractEditorChordModel(originalText),
  originalAnchorData: extractEditorChordAnchors(originalText),
  originalAnchors: extractEditorChordAnchors(originalText),
  status: 'verified',
  snapshotStatus: 'verified',
}

const MINI_PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 78>>stream\nBT /F1 18 Tf 72 720 Td (Bahnt einen Weg unserm Gott) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000266 00000 n \n0000000394 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n466\n%%EOF\n',
)

function fulfillJson(route, data, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
}

function routeApi(request, route) {
  const url = request.url()
  const method = request.method()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/api/songs/bahnt-1/musicxml')) {
    return route.fulfill({ status: 200, contentType: 'application/xml', body: MUSICXML })
  }
  if (url.includes('/api/songs/bahnt-1/pdf')) {
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: MINI_PDF })
  }
  if (url.includes('/api/songs/bahnt-1/snapshot')) {
    return fulfillJson(route, {
      snapshotStatus: 'verified',
      snapshot,
      text: originalText,
      key: 'G',
      sourceKey: 'G',
      originalKey: 'G',
      sourceKeyVerified: true,
      hasLeadSheet: true,
      bpm: null,
    })
  }
  if (url.includes('/api/songs/bahnt-1/variants')) {
    if (method === 'GET') return fulfillJson(route, [{ targetKey: 'G', sourceKey: 'G', overlayText: originalText }])
    return fulfillJson(route, { targetKey: 'G' }, 201)
  }
  if (url.includes('/api/songs/bahnt-1/analyze-chords')) return fulfillJson(route, { snapshotStatus: 'verified', snapshot })
  if (url.match(/\/api\/songs\/bahnt-1(\?|$)/) && method === 'PATCH') return fulfillJson(route, mockSong)
  if (url.includes('/api/songs')) return fulfillJson(route, [mockSong])
  if (url.includes('/api/sets')) return fulfillJson(route, [])
  if (url.includes('/api/team')) return fulfillJson(route, [])
  if (url.includes('/api/bands')) return fulfillJson(route, [])
  if (url.includes('/api/appointments')) return fulfillJson(route, [])
  return fulfillJson(route, [])
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      let path = join(dist, url.pathname === '/' ? 'index.html' : url.pathname)
      try {
        if (statSync(path).isDirectory()) path = join(path, 'index.html')
      } catch {
        path = join(dist, 'index.html')
      }
      try {
        const body = readFileSync(path)
        res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
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
  const views = [
    { name: 'original', label: 'ORIGINAL' },
    { name: 'chords', label: 'AKKORDE' },
    { name: 'leadsheet', label: 'LEADSHEET' },
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
    for (const view of views) {
      const button = page.getByRole('button', { name: view.label, exact: true })
      await button.click()
      await page.waitForTimeout(view.name === 'leadsheet' ? 1800 : 400)
      if (view.name === 'chords') {
        const body = await page.locator('.chart-sheet, .editor-paper').first().innerText()
        if (/ei nen|un serm|Eh re/i.test(body)) {
          throw new Error(`syllables still split in chord view (${vp.name}): ${body.slice(0, 200)}`)
        }
        if (!/einen/.test(body) || !/unserm/.test(body)) {
          throw new Error(`missing rehydrated words in chord view (${vp.name}): ${body.slice(0, 200)}`)
        }
        if (/CCLI|SongSelect/i.test(body)) {
          throw new Error(`metadata leaked into chord view (${vp.name})`)
        }
      }
      if (view.name === 'leadsheet') {
        await page.waitForTimeout(2500)
        const missing = page.locator('.leadsheet-status')
        const svg = page.locator('.osmd-host svg')
        const missingVisible = await missing.isVisible().catch(() => false)
        if (missingVisible) {
          throw new Error(`leadsheet missing (${vp.name}): ${await missing.innerText()}`)
        }
        await svg.first().waitFor({ timeout: 8000 })
        await svg.first().scrollIntoViewIfNeeded()
        await page.waitForTimeout(300)
        const box = await svg.first().boundingBox()
        if (!box || box.height < 40) {
          throw new Error(`leadsheet svg too small (${vp.name}): ${JSON.stringify(box)}`)
        }
      }
      const file = `bahnt_${view.name}_${vp.name}.png`
      const dest = join(outDir, file)
      await page.screenshot({ path: dest, fullPage: true })
      copyFileSync(dest, join(artifactDir, file))
      saved.push(file)
      console.log('wrote', file)
    }
    await context.close()
  }

  await browser.close()
  server.close()
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ saved, title: TITLE }, null, 2))
  console.log('test-song-views-screenshots: saved', saved.join(', '))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
