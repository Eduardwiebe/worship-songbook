#!/usr/bin/env node
/**
 * Rehearsal UX: wake lock while a set is open, autoscroll actually moves
 * the original sheet, and Aufnahme can start/stop into a downloadable file.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AUTOSCROLL_PX_PER_SEC,
  advanceSheetScroll,
  autoscrollScale,
  measureAutoscrollLayout,
} from '../app/src/sheetAutoscroll.js'
import {
  formatElapsed,
  pickRecordingFormat,
  recordingErrorKey,
  rehearsalFileName,
  sanitizeFilePart,
} from '../app/src/rehearsalRecorder.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'app/dist')

function assertSource() {
  const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
  const media = readFileSync(join(root, 'app/src/AuthorizedMedia.jsx'), 'utf8')
  const css = readFileSync(join(root, 'app/src/extra.css'), 'utf8')
  assert.match(app, /useScreenWakeLock\(true\)/)
  assert.match(app, /useSheetAutoscroll\(autoScroll/)
  assert.match(app, /<RehearsalAufnahme/)
  assert.match(media, /useScreenWakeLock\(true\)/)
  assert.match(media, /is-autoscrolling/)
  assert.match(css, /is-autoscrolling/)
  assert.doesNotMatch(app, /scrollTop \+= 1/)
  assert.doesNotMatch(app, /original-pages\.is-multi'\)/)
}

function assertScrollMath() {
  const fitted = { scrollTop: 0, scrollHeight: 400, clientHeight: 400 }
  const stuck = advanceSheetScroll(fitted, 12)
  assert.equal(stuck.done, true)
  assert.equal(stuck.scrollTop, 0)

  const sheet = { scrollTop: 0, scrollHeight: 900, clientHeight: 400 }
  const step = advanceSheetScroll(sheet, 14)
  assert.equal(step.scrollTop, 14)
  assert.equal(step.done, false)
  const end = advanceSheetScroll(sheet, 10_000)
  assert.equal(end.scrollTop, 500)
  assert.equal(end.done, true)

  assert.equal(autoscrollScale(2000, 800), 1)
  const zoom = autoscrollScale(700, 800)
  assert.ok(zoom > 1)
  const layout = measureAutoscrollLayout(400, 800, [1.4])
  assert.ok(layout.heights[0] > 800)
  assert.ok(layout.width >= 400)

  const wide = measureAutoscrollLayout(390, 500, [1100 / 800, 1100 / 800])
  assert.equal(wide.scale, 1)
  assert.ok(wide.heights[0] + wide.heights[1] > 500)

  // Singing pace: 1px/280ms, four times slower than the old 1px/70ms default.
  const previousPxPerSec = 1000 / 70
  assert.equal(AUTOSCROLL_PX_PER_SEC, 1000 / 280)
  assert.ok(AUTOSCROLL_PX_PER_SEC < previousPxPerSec / 2)
}

function assertRecordingNames() {
  assert.equal(sanitizeFilePart('  Band Probe / Nacht '), 'Band-Probe-Nacht')
  const name = rehearsalFileName({
    band: 'Band',
    title: 'Probe',
    at: new Date(2026, 8, 27, 9, 15),
    ext: 'm4a',
  })
  assert.equal(name, 'Band-Probe-2026-09-27-0915.m4a')
  assert.equal(formatElapsed(65000), '1:05')
  assert.equal(recordingErrorKey({ name: 'NotAllowedError' }), 'sets.recordMicDenied')
  assert.equal(recordingErrorKey({ name: 'NotFoundError' }), 'sets.recordMicUnsupported')
  const safari = pickRecordingFormat((type) => type === 'audio/mp4')
  assert.equal(safari.ext, 'm4a')
  assert.equal(safari.mime, 'audio/mp4')
  const chrome = pickRecordingFormat((type) => type === 'audio/webm;codecs=opus')
  assert.equal(chrome.ext, 'webm')
  const wav = pickRecordingFormat(() => false)
  assert.equal(wav.ext, 'webm')
  assert.equal(wav.via, 'media-recorder')
  assert.equal(pickRecordingFormat().via, typeof MediaRecorder === 'undefined' ? 'wav' : 'media-recorder')
}

assertSource()
assertScrollMath()
assertRecordingNames()
console.log('ok: rehearsal unit checks')

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

function pageSvg(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1400"><rect width="100%" height="100%" fill="#f7f4ee"/><text x="40" y="120" font-size="42" font-family="sans-serif" fill="#172230">${label}</text><text x="40" y="700" font-size="28" font-family="sans-serif" fill="#334">Mitte</text><text x="40" y="1280" font-size="28" font-family="sans-serif" fill="#334">Ende</text></svg>`
  return { mime: 'image/svg+xml', dataUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` }
}

const mockUser = { id: 'ux', name: 'Eduard', role: 'admin', mustChangePassword: false, hasPhoto: false }
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const songs = [{
  id: 'song-1',
  title: 'Gross ist der Herr',
  artist: 'Import',
  key: 'D',
  bpm: 92,
  hasPdf: true,
  hasCover: false,
  sortOrder: 0,
}]
const sets = [{
  id: 'set-probe',
  title: 'Probe',
  date: '2026-09-27',
  songIds: ['song-1'],
  leaders: {},
  songKeys: {},
  band: 'Band',
  theme: '',
  venue: '',
  eventTime: '19:00',
  arrivalTime: '',
  techNotes: '',
  technicianId: '',
  isProtected: true,
}]

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function routeApi(route) {
  const url = route.request().url()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/pages')) return fulfillJson(route, { pages: [pageSvg('Seite 1')] })
  if (url.includes('/resolve-youtube') || url.includes('/resolve-cover')) return fulfillJson(route, {})
  if (url.includes('/api/songs')) return fulfillJson(route, songs)
  if (url.includes('/api/sets')) return fulfillJson(route, sets)
  if (url.includes('/api/version')) return fulfillJson(route, { version: '1.1.4' })
  return fulfillJson(route, [])
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
      let filePath = join(dist, urlPath === '/' ? 'index.html' : urlPath)
      if (!filePath.startsWith(dist)) { res.writeHead(403); res.end(); return }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = join(dist, 'index.html')
      const ext = extname(filePath)
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(readFileSync(filePath))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function installBrowserFakes() {
  window.__wake = []
  window.__wakeReleased = 0
  window.__micCalls = 0
  let denyMic = Boolean(window.__forceDenyMic)
  window.__denyMic = (value) => { denyMic = value }
  const sentinel = {
    released: false,
    release: async () => { sentinel.released = true; window.__wakeReleased += 1 },
    addEventListener() {},
  }
  const wakeLock = {
    request: async (type) => {
      window.__wake.push(type)
      if (window.__wakeFail) {
        const error = new Error('denied')
        error.name = 'NotAllowedError'
        throw error
      }
      return sentinel
    },
  }
  try {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeLock })
  } catch {
    navigator.wakeLock = wakeLock
  }
  class FakeRecorder extends EventTarget {
    constructor() {
      super()
      this.state = 'inactive'
      this.mimeType = 'audio/mp4'
    }
    start() { this.state = 'recording' }
    pause() { this.state = 'paused' }
    resume() { this.state = 'recording' }
    requestData() {}
    stop() {
      this.state = 'inactive'
      const dataEvent = new Event('dataavailable')
      dataEvent.data = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' })
      this.dispatchEvent(dataEvent)
      this.dispatchEvent(new Event('stop'))
    }
    static isTypeSupported(type) { return type === 'audio/mp4' }
  }
  window.MediaRecorder = FakeRecorder
  const mediaDevices = {
    getUserMedia: async () => {
      window.__micCalls += 1
      if (denyMic) {
        const error = new Error('denied')
        error.name = 'NotAllowedError'
        throw error
      }
      return { getTracks: () => [{ stop() {} }] }
    },
  }
  try {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices })
  } catch {
    navigator.mediaDevices = mediaDevices
  }
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) {
    console.log('skip browser: app/dist missing')
    return
  }
  const playwright = await import(pathToFileURL(join(root, 'app/node_modules/playwright/index.mjs')).href)
  const server = await startStaticServer()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const browser = await playwright.chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    acceptDownloads: true,
  })
  await context.addInitScript(installBrowserFakes)
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('songbook-locale', 'de')
  })
  await page.route('**/api/**', routeApi)

  const deniedContext = await browser.newContext({
    viewport: { width: 834, height: 1112 },
    serviceWorkers: 'block',
  })
  await deniedContext.addInitScript(() => {
    window.__wakeFail = true
    window.__forceDenyMic = true
  })
  await deniedContext.addInitScript(installBrowserFakes)
  const denied = await deniedContext.newPage()
  await denied.addInitScript(() => {
    localStorage.setItem('songbook-locale', 'de')
  })
  await denied.route('**/api/**', routeApi)

  try {
    await page.goto(`${base}/#/sets/set-probe`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Set starten' }).click()
    await page.locator('.run-mode .original-page-image').waitFor({ timeout: 8000 })
    await page.waitForFunction(() => document.querySelector('.run-mode .original-page-image')?.naturalWidth > 0)
    const beforeWake = await page.evaluate(() => window.__wake.slice())
    assert.ok(beforeWake.includes('screen'), `wake lock was not requested: ${beforeWake.join(',')}`)
    const micBefore = await page.evaluate(() => window.__micCalls)
    assert.equal(micBefore, 0, 'microphone was requested before Aufnahme')

    const before = await page.evaluate(() => {
      const pages = document.querySelector('.run-mode .original-pages')
      return { top: pages.scrollTop, height: pages.scrollHeight, client: pages.clientHeight }
    })
    await page.locator('.scroll-tool button').click()
    await page.waitForFunction(() => {
      const pages = document.querySelector('.run-mode .original-pages')
      return pages && pages.classList.contains('is-autoscrolling') && pages.scrollTop > 8
    }, null, { timeout: 4000 })
    const after = await page.evaluate(() => {
      const pages = document.querySelector('.run-mode .original-pages')
      return {
        top: pages.scrollTop,
        snap: getComputedStyle(pages).scrollSnapType,
        overflowY: getComputedStyle(pages).overflowY,
        autoscrolling: pages.classList.contains('is-autoscrolling'),
      }
    })
    console.log('autoscroll', { before, after })
    assert.ok(after.top > before.top + 8, `sheet did not move: ${before.top} -> ${after.top}`)
    assert.equal(after.autoscrolling, true)
    assert.match(after.overflowY, /auto|scroll/)

    const still = await page.evaluate(() => window.__wake.includes('screen'))
    assert.equal(still, true, 'recording setup must not drop the wake lock')

    await page.getByRole('button', { name: 'Aufnahme starten' }).click()
    await page.locator('.record-tool.is-recording').waitFor()
    const recording = await page.evaluate(() => ({
      mic: window.__micCalls,
      time: document.querySelector('.record-time')?.textContent || '',
      dot: Boolean(document.querySelector('.record-dot')),
    }))
    assert.equal(recording.mic, 1)
    assert.equal(recording.dot, true)
    assert.match(recording.time, /\d+:\d\d/)
    const movedWhileRecording = await page.evaluate(() => document.querySelector('.run-mode .original-pages').scrollTop)
    await page.waitForFunction((start) => document.querySelector('.run-mode .original-pages').scrollTop > start + 4, movedWhileRecording, { timeout: 3000 })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Aufnahme stoppen' }).click(),
    ])
    assert.match(download.suggestedFilename(), /^Band-Probe-\d{4}-\d{2}-\d{2}-\d{4}\.m4a$/)
    await page.locator('.record-tool[data-state="idle"]').waitFor()
    const stored = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('songbook-rehearsal-recordings')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction('recordings', 'readonly')
        const req = tx.objectStore('recordings').getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      return rows.map((row) => ({ name: row.name, size: row.blob?.size || 0, mime: row.mime }))
    })
    console.log('stored', stored)
    assert.equal(stored.length, 1)
    assert.ok(stored[0].size > 0)
    assert.match(stored[0].name, /\.m4a$/)

    const releasedBeforeClose = await page.evaluate(() => window.__wakeReleased)
    await page.getByRole('button', { name: 'Schließen' }).click()
    await page.waitForSelector('.run-mode', { state: 'detached' })
    await page.waitForFunction((previous) => window.__wakeReleased > previous, releasedBeforeClose)
    console.log('browser rehearsal checks passed')

    await denied.goto(`${base}/#/sets/set-probe`, { waitUntil: 'networkidle' })
    await denied.getByRole('button', { name: 'Set starten' }).click()
    await denied.locator('.wake-lock-hint').waitFor({ timeout: 4000 })
    const hint = await denied.locator('.wake-lock-hint').innerText()
    assert.match(hint, /nicht wach/)
    await denied.locator('.run-mode').waitFor()
    await denied.getByRole('button', { name: 'Aufnahme starten' }).click()
    await denied.locator('.record-error').waitFor()
    const message = await denied.locator('.record-error').innerText()
    assert.match(message, /Mikrofonzugriff verweigert/)
    console.log('denied-path checks passed')
  } finally {
    await context.close()
    await deniedContext.close()
    await browser.close()
    server.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
