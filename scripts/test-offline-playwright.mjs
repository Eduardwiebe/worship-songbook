#!/usr/bin/env node
/**
 * Warm the Songbook Band PWA online, then go offline (Playwright ≈ DevTools offline).
 *
 * Proves:
 * - service worker serves the app shell after a reload with no network
 * - page images for a song that is not in any set are cached with the library
 * - the eye opens that sheet in the in-app viewer (Zurück/X) while offline
 * - a song whose pages never cached shows the German miss message
 * - sets (including Leiter initials) and team stay readable
 *
 * iPad / Add to Home Screen (manual, not run here):
 * 1. On the iPad, open https://songbook.lyruma.de in Safari and log in.
 * 2. Open Songs once (the app prepares an offline copy) and open one song with the eye.
 * 3. Share → Zum Home-Bildschirm. Launch Songbook Band from the icon.
 * 4. Turn on Airplane Mode. Home, Songs, Sets, Team, and any prepared sheet
 *    (including songs that are not in a set) must still show via the eye.
 * 5. A song whose pages were never stored shows
 *    „Noch nicht offline verfügbar — einmal online öffnen“.
 * 6. YouTube Probe, uploading, team edits, and new sets stay disabled / need internet.
 * 7. Re-login needs the network. The last successful session is reused offline
 *    (web cookie lasts 30 days; it is not refreshed while offline).
 */
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'app/dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
}

const mockUser = {
  id: 'offline-user',
  name: 'Eduard',
  role: 'admin',
  mustChangePassword: false,
  hasPhoto: false,
}
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const songA = {
  id: 'song-a',
  title: 'Großer Gott',
  artist: 'Gemeinde',
  key: 'G',
  hasPdf: true,
  fileSize: 1200,
  fileName: 'grosser-gott.pdf',
  bpm: 72,
}
const songB = {
  id: 'song-b',
  title: 'Nie geöffnet',
  artist: 'Gemeinde',
  key: 'D',
  hasPdf: true,
  fileSize: 800,
  fileName: 'nie.pdf',
}
const songC = {
  id: 'song-c',
  title: 'Stilles Gebet',
  artist: 'Gemeinde',
  key: 'C',
  hasPdf: true,
  fileSize: 900,
  fileName: 'stilles-gebet.pdf',
  bpm: 64,
}
const mockSongs = [songA, songB, songC]
const mockTeam = [{
  id: 'member-ew',
  name: 'Eduard Wiebe',
  initials: 'EW',
  roles: ['Leitung'],
  isLeader: true,
  hasPhoto: false,
}]
const mockSets = [{
  id: 'set-sunday',
  title: 'Sonntag Gottesdienst',
  date: '2026-10-04',
  songIds: ['song-a'],
  leaders: { 'song-a': 'member-ew' },
  songKeys: {},
  venue: 'Kirche',
  band: 'Band',
  theme: '',
  eventTime: '10:00',
  arrivalTime: '',
  techNotes: '',
  technicianId: '',
  isProtected: false,
}]

function pageDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#fff"/><text x="2" y="20" font-size="8" fill="#111">Noten</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function fulfillJson(route, data, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
}

function routeApi(url, route) {
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/api/songs/song-a/pages') || url.includes('/api/songs/song-c/pages')) {
    return fulfillJson(route, { pages: [{ mime: 'image/svg+xml', dataUrl: pageDataUrl() }] })
  }
  if (url.includes('/api/songs/song-b/pages')) {
    return fulfillJson(route, { error: 'Seiten nicht da' }, 500)
  }
  if (url.includes('/api/songs/song-a/pdf')) {
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.1\n') })
  }
  if (url.includes('/resolve-youtube')) return fulfillJson(route, { youtubeUrl: '' })
  if (url.includes('/resolve-cover')) return fulfillJson(route, { hasCover: false })
  if (url.includes('/api/songs')) return fulfillJson(route, mockSongs)
  if (url.includes('/api/sets')) return fulfillJson(route, mockSets)
  if (url.includes('/api/team')) return fulfillJson(route, mockTeam)
  if (url.includes('/api/bands')) return fulfillJson(route, [{ id: 'band-1', name: 'Gemeindeband', active: true }])
  if (url.includes('/api/appointments')) return fulfillJson(route, [])
  return fulfillJson(route, [])
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{"error":"api is not served by the static host"}')
        return
      }
      let path = join(dist, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname))
      if (!path.startsWith(dist)) {
        res.writeHead(403)
        res.end()
        return
      }
      try {
        if (statSync(path).isDirectory()) path = join(path, 'index.html')
      } catch {
        path = join(dist, 'index.html')
      }
      try {
        const body = readFileSync(path)
        res.writeHead(200, {
          'content-type': MIME[extname(path)] || 'application/octet-stream',
          'cache-control': 'no-cache',
        })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function readMedia(page, key) {
  return page.evaluate(async (mediaKey) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('songbook-offline-v1')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const row = await new Promise((resolve) => {
      const get = db.transaction('media', 'readonly').objectStore('media').get(mediaKey)
      get.onsuccess = () => resolve(get.result || null)
      get.onerror = () => resolve(null)
    })
    db.close()
    if (!row) return null
    return {
      pages: row.pages?.length || 0,
      bytes: row.buffer?.byteLength || 0,
    }
  }, key)
}

async function hasCachedPages(page, songId) {
  const row = await readMedia(page, `pages:${songId}`)
  return Boolean(row?.pages)
}

async function hasCachedPdf(page, songId) {
  const row = await readMedia(page, `pdf:${songId}`)
  return Boolean(row?.bytes)
}

async function openEye(page, title) {
  const row = page.locator('.song-row', { hasText: title })
  await row.locator('button[title="PDF öffnen"]').click()
  await page.locator('.original-viewer').waitFor({ timeout: 8000 })
}

async function assertSheet(page) {
  const img = page.locator('.original-viewer .original-page-image')
  await img.waitFor({ timeout: 8000 })
  const drawn = await img.evaluate((el) => ({
    width: el.naturalWidth || el.clientWidth || 0,
    src: el.getAttribute('src') || '',
  }))
  if (!drawn.src || drawn.width < 1) throw new Error(`sheet did not draw: ${JSON.stringify(drawn)}`)
  const miss = await page.getByText('Noch nicht offline verfügbar — einmal online öffnen').count()
  if (miss) throw new Error('cached sheet showed the offline miss message')
  await page.locator('.original-viewer-back', { hasText: 'Zurück' }).waitFor()
  await page.locator('.original-viewer-close').waitFor()
}

async function closeViewer(page) {
  await page.locator('.original-viewer-close').click()
  await page.locator('.original-viewer').waitFor({ state: 'detached' })
}

async function main() {
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'sw.js'))) {
    console.error('app/dist missing service worker — run: cd app && npm run build')
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
  const context = await browser.newContext({
    viewport: { width: 834, height: 1112 },
    locale: 'de-DE',
    hasTouch: true,
    serviceWorkers: 'allow',
  })
  await context.addInitScript(() => {
    try { localStorage.setItem('songbook-locale', 'de') } catch { /* ignore */ }
  })
  await context.route('**/api/**', async (route) => routeApi(route.request().url(), route))
  const page = await context.newPage()
  const popups = []
  page.on('popup', (popup) => popups.push(popup.url()))

  try {
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) throw new Error('no service worker')
      await navigator.serviceWorker.ready
    })
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller))
    if (!controlled) {
      await page.reload({ waitUntil: 'networkidle' })
    }
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 })
    await page.getByText('Großer Gott').first().waitFor({ timeout: 15000 })
    await page.waitForFunction(async () => {
      const open = indexedDB.open('songbook-offline-v1')
      const db = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      const read = (key) => new Promise((resolve) => {
        const get = db.transaction('media', 'readonly').objectStore('media').get(key)
        get.onsuccess = () => resolve(get.result || null)
        get.onerror = () => resolve(null)
      })
      const [setSong, librarySong, missed] = await Promise.all([
        read('pages:song-a'),
        read('pages:song-c'),
        read('pages:song-b'),
      ])
      db.close()
      return Boolean(setSong?.pages?.length && librarySong?.pages?.length && !missed?.pages?.length)
    }, null, { timeout: 30000 })
    if (!(await hasCachedPages(page, 'song-a'))) throw new Error('set song pages were not cached while online')
    if (!(await hasCachedPages(page, 'song-c'))) throw new Error('library song outside every set was not cached while online')
    if (await hasCachedPages(page, 'song-b')) throw new Error('song-b pages must stay uncached')
    if (!(await hasCachedPdf(page, 'song-a'))) throw new Error('set song PDF was not cached')
    if (await hasCachedPdf(page, 'song-c')) throw new Error('non-set raw PDF should stay uncached')

    await page.goto(`${base}/#/songs`, { waitUntil: 'networkidle' })
    await openEye(page, 'Stilles Gebet')
    await assertSheet(page)
    if (!page.url().includes('#/songs') || page.url().includes('/editor')) {
      throw new Error(`eye left the song list: ${page.url()}`)
    }
    if (popups.length) throw new Error(`eye opened a popup: ${popups.join(', ')}`)
    await closeViewer(page)

    await context.unroute('**/api/**')
    await context.route('**/api/**', (route) => route.abort('internetdisconnected'))
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.getByRole('status').filter({ hasText: 'Offline — gespeicherte Songs und Sets sind verfügbar' }).waitFor({ timeout: 15000 })
    await page.getByText('Stilles Gebet').first().waitFor({ timeout: 15000 })

    await openEye(page, 'Stilles Gebet')
    await assertSheet(page)
    if (popups.length) throw new Error(`offline eye opened a popup: ${popups.join(', ')}`)
    await closeViewer(page)

    await openEye(page, 'Großer Gott')
    await assertSheet(page)
    await closeViewer(page)

    await openEye(page, 'Nie geöffnet')
    await page.getByText('Noch nicht offline verfügbar — einmal online öffnen').waitFor({ timeout: 8000 })
    await closeViewer(page)

    await page.goto(`${base}/#/songs/song-b/editor`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Noch nicht offline verfügbar — einmal online öffnen').waitFor({ timeout: 8000 })

    await page.goto(`${base}/#/sets`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Sonntag Gottesdienst').waitFor()
    await page.goto(`${base}/#/sets/set-sunday`, { waitUntil: 'domcontentloaded' })
    await page.locator('.leader-select b', { hasText: 'EW' }).waitFor()

    await page.goto(`${base}/#/team`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: /Eduard Wiebe/ }).waitFor()

    await page.getByRole('button', { name: 'Teammitglied hinzufügen' }).click()
    await page.getByRole('status').filter({ hasText: 'brauchen Internet' }).waitFor()

    console.log('ok: offline shell, library sheet via eye, miss message, set leaders, team')
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
