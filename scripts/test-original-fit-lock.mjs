#!/usr/bin/env node
/**
 * Original sheet is fitted and locked on phone, tablet, and desktop.
 * Single page: fully inside the frame, drag/wheel does not pan it.
 * Multi-page: vertical scroll only, one page at a time.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const media = readFileSync(join(root, 'app/src/AuthorizedMedia.jsx'), 'utf8')
const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
const css = readFileSync(join(root, 'app/src/extra.css'), 'utf8')
const meta = readFileSync(join(root, 'app/src/appMeta.js'), 'utf8')

assert(/const usePages = Boolean\(preferPageImages && songId\)/.test(media), 'page images must be used on every device')
assert(!/usePages = preferPageImages && songId && isLikelyIosNative/.test(media), 'page images must not be iOS-only')
assert(media.includes('is-single') && media.includes('is-multi'), 'single vs multi page classes')
assert(media.includes("event.preventDefault()"), 'single-page gestures are cancelled')
assert(media.includes('draggable={false}'), 'page images are not draggable')
assert(!app.includes('view=FitH'), 'FitH lets the PDF plugin pan a wide page')
assert(app.includes('view=Fit'), 'PDF fallback uses fit-page')
assert(app.includes('preferPageImages'), 'editor and set stage request page images')
assert(css.includes('object-fit:contain') || css.includes('object-fit: contain'), 'pages scale with object-fit contain')
assert(css.includes('.pdf-stage .original-pages.stage-fill.is-single'), 'set stage locks a single page')
assert(css.includes('.pdf-stage .original-pages.stage-fill.is-multi'), 'set stage scrolls multi-page vertically')
assert(css.includes('touch-action:none') || css.includes('touch-action: none'), 'single-page touch pan is disabled')
assert(meta.includes("APP_VERSION = '1.1.3'"), 'patch version 1.1.3')
console.log('ok: source fit-lock')

function pageSvg(label, width = 600, height = 840) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/><rect x="24" y="24" width="${width - 48}" height="${height - 48}" fill="none" stroke="#172230" stroke-width="4"/><text x="40" y="80" font-size="32" font-family="sans-serif" fill="#172230">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const dist = join(root, 'app/dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.log('skip browser: app/dist missing')
  process.exit(0)
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}

let pageCount = 1
const mockUser = { id: 'view-test', name: 'View Test', role: 'admin', mustChangePassword: false, hasPhoto: false }
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const mockSong = {
  id: 'bahnt-1',
  title: 'Bahnt einen Weg unserm Gott',
  artist: 'PDF-Import',
  key: 'G',
  sourceKey: 'G',
  preferredKey: '',
  hasPdf: true,
  variantKeys: [],
  sortOrder: 1,
  bpm: 72,
  hasLeadSheet: false,
  snapshotStatus: 'none',
  sourceKeyVerified: false,
}
const mockSet = {
  id: 'set-1',
  title: 'Probe',
  date: '2026-09-22',
  songIds: ['bahnt-1'],
  leaders: {},
  songKeys: {},
  isProtected: true,
  band: '',
  theme: '',
  venue: '',
  eventTime: '',
  arrivalTime: '',
  techNotes: '',
  technicianId: '',
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function routeApi(request, route) {
  const url = request.url()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/api/songs/bahnt-1/pdf')) {
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.1\n') })
  }
  if (url.includes('/api/songs/bahnt-1/pages')) {
    const pages = Array.from({ length: pageCount }, (_, index) => ({
      mime: 'image/svg+xml',
      dataUrl: pageSvg(`Seite ${index + 1}`),
    }))
    return fulfillJson(route, { pages })
  }
  if (url.includes('/api/songs/bahnt-1/resolve-youtube')) {
    return fulfillJson(route, { ok: true, youtubeUrl: 'https://www.youtube.com/results?search_query=test' })
  }
  if (url.includes('/api/songs')) return fulfillJson(route, [mockSong])
  if (url.includes('/api/sets')) return fulfillJson(route, [mockSet])
  if (url.includes('/api/team')) return fulfillJson(route, [])
  if (url.includes('/api/bands')) return fulfillJson(route, [])
  if (url.includes('/api/appointments')) return fulfillJson(route, [])
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
      if (!existsSync(filePath)) filePath = join(dist, 'index.html')
      const ext = extname(filePath)
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
      res.end(readFileSync(filePath))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function measure(page, frameSel, imageSel) {
  return page.evaluate(({ frameSel, imageSel }) => {
    const frame = document.querySelector(frameSel)
    const img = document.querySelector(imageSel)
    const pages = frame.querySelector('.original-pages') || frame
    const fr = frame.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    const fit = Math.min(fr.width / img.naturalWidth, fr.height / img.naturalHeight)
    return {
      className: pages.className,
      frameOverflow: getComputedStyle(frame).overflow,
      pagesOverflowX: getComputedStyle(pages).overflowX,
      pagesOverflowY: getComputedStyle(pages).overflowY,
      touch: getComputedStyle(pages).touchAction,
      objectFit: getComputedStyle(img).objectFit,
      inside: ir.left >= fr.left - 1 && ir.top >= fr.top - 1 && ir.right <= fr.right + 1 && ir.bottom <= fr.bottom + 1,
      drawnW: img.naturalWidth * fit,
      drawnH: img.naturalHeight * fit,
      frameW: fr.width,
      frameH: fr.height,
      scrollTop: pages.scrollTop,
      scrollLeft: pages.scrollLeft,
      winX: window.scrollX,
      winY: window.scrollY,
      iframe: Boolean(frame.querySelector('iframe, embed')),
    }
  }, { frameSel, imageSel })
}

async function drag(page, frameSel) {
  const box = await page.locator(frameSel).boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 140, y - 180, { steps: 12 })
  await page.mouse.up()
  await page.mouse.wheel(80, 160)
}

async function main() {
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
  const viewports = [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 834, height: 1112 },
    { name: 'desktop', width: 1440, height: 900 },
  ]

  try {
    for (const vp of viewports) {
      pageCount = 1
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        locale: 'de-DE',
        hasTouch: true,
        serviceWorkers: 'block',
      })
      await context.addInitScript(() => { try { localStorage.setItem('songbook-locale', 'de') } catch {} })
      await context.route('**/api/**', async (route) => routeApi(route.request(), route))
      const page = await context.newPage()
      await page.goto(`${base}/#/songs/bahnt-1/editor`, { waitUntil: 'networkidle' })
      const img = page.locator('.original-pdf-sheet .original-page-image')
      await img.waitFor({ timeout: 8000 })
      await page.waitForFunction(() => document.querySelector('.original-page-image')?.naturalWidth > 0)
      await drag(page, '.original-pdf-sheet')
      const single = await measure(page, '.original-pdf-sheet', '.original-page-image')
      assert(single.className.includes('is-single'), `${vp.name} single class`)
      assert(!single.iframe, `${vp.name} must not embed a pannable PDF`)
      assert(single.objectFit === 'contain', `${vp.name} object-fit contain`)
      assert(single.inside, `${vp.name} page element stays inside the sheet`)
      assert(single.drawnW <= single.frameW + 1 && single.drawnH <= single.frameH + 1, `${vp.name} bitmap fits the frame`)
      assert(single.scrollTop === 0 && single.scrollLeft === 0, `${vp.name} sheet did not pan`)
      assert(single.winX === 0, `${vp.name} no horizontal page scroll`)
      assert(Math.abs(single.winY) < 2, `${vp.name} drag/wheel did not scroll the page (${single.winY})`)
      const doc = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }))
      assert(doc.sw <= doc.cw + 1, `${vp.name} no horizontal overflow`)
      console.log('ok: editor single', vp.name, JSON.stringify({ frame: [Math.round(single.frameW), Math.round(single.frameH)], drawn: [Math.round(single.drawnW), Math.round(single.drawnH)] }))
      await context.close()
    }

    pageCount = 2
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      locale: 'de-DE',
      hasTouch: true,
      serviceWorkers: 'block',
    })
    await context.addInitScript(() => { try { localStorage.setItem('songbook-locale', 'de') } catch {} })
    await context.route('**/api/**', async (route) => routeApi(route.request(), route))
    const page = await context.newPage()
    await page.goto(`${base}/#/songs/bahnt-1/editor`, { waitUntil: 'networkidle' })
    await page.locator('.original-pages.is-multi .original-page-image').first().waitFor({ timeout: 8000 })
    const before = await page.evaluate(() => {
      const el = document.querySelector('.original-pages.is-multi')
      return { top: el.scrollTop, left: el.scrollLeft, height: el.clientHeight, scroll: el.scrollHeight }
    })
    assert(before.scroll > before.height + 8, 'multi-page sheet is taller than the frame')
    const box = await page.locator('.original-pages.is-multi').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 400)
    await page.mouse.wheel(200, 0)
    const after = await page.evaluate(() => {
      const el = document.querySelector('.original-pages.is-multi')
      const style = getComputedStyle(el)
      return { top: el.scrollTop, left: el.scrollLeft, snap: style.scrollSnapType, overflowX: style.overflowX }
    })
    assert(after.top > 0, 'multi-page vertical scroll works')
    assert(after.left === 0, 'multi-page does not scroll sideways')
    assert(after.overflowX === 'hidden', 'multi-page overflow-x hidden')
    assert(after.snap.includes('y'), 'multi-page snaps vertically')
    console.log('ok: editor multi', JSON.stringify(after))
    await context.close()

    pageCount = 1
    const stageContext = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      locale: 'de-DE',
      hasTouch: true,
      serviceWorkers: 'block',
    })
    await stageContext.addInitScript(() => { try { localStorage.setItem('songbook-locale', 'de') } catch {} })
    await stageContext.route('**/api/**', async (route) => routeApi(route.request(), route))
    const stagePage = await stageContext.newPage()
    await stagePage.goto(`${base}/#/sets/set-1`, { waitUntil: 'networkidle' })
    await stagePage.getByRole('button', { name: 'Set starten' }).click()
    await stagePage.locator('.pdf-stage .original-page-image').waitFor({ timeout: 8000 })
    await stagePage.waitForFunction(() => document.querySelector('.pdf-stage .original-page-image')?.naturalWidth > 0)
    await drag(stagePage, '.pdf-stage')
    const stage = await measure(stagePage, '.pdf-stage', '.pdf-stage .original-page-image')
    assert(stage.className.includes('is-single'), 'stage single class')
    assert(!stage.iframe, 'stage must not embed a pannable PDF')
    assert(stage.objectFit === 'contain', 'stage object-fit contain')
    assert(stage.inside, 'stage page stays inside the frame')
    assert(stage.drawnW <= stage.frameW + 1 && stage.drawnH <= stage.frameH + 1, 'stage bitmap fits')
    assert(stage.scrollTop === 0 && stage.scrollLeft === 0, 'stage did not pan')
    console.log('ok: set stage', JSON.stringify({ frame: [Math.round(stage.frameW), Math.round(stage.frameH)], drawn: [Math.round(stage.drawnW), Math.round(stage.drawnH)] }))
    await stageContext.close()
  } finally {
    await browser.close()
    server.close()
  }
  console.log('ok: original fit-lock')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
