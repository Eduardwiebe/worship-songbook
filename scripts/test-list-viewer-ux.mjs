#!/usr/bin/env node
/**
 * Mobile checks for song-list layout, original-viewer exit, and set Leiter.
 */
import { createServer } from 'node:http'
import { mkdirSync, existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'app/dist')
const artifactDir = existsSync('/opt/cursor/artifacts') ? '/opt/cursor/artifacts' : join(root, 'tmp/artifacts')
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
  '.webmanifest': 'application/manifest+json',
}

const mockUser = { id: 'ux-test', name: 'Eduard', role: 'admin', mustChangePassword: false, hasPhoto: false }
const mockOnboarding = { step: 0, completed: true, manualRestart: false, mode: '', data: {} }
const songs = [
  {
    id: 'song-28',
    title: '28 Jesus, zu dir kann ich so kommen, wie ich bin',
    artist: 'Importierte PDF',
    fileName: '28-jesus.pdf',
    fileSize: Math.round(0.87 * 1024 * 1024),
    key: 'D',
    bpm: 92,
    hasPdf: true,
    hasCover: false,
    sortOrder: 0,
  },
  {
    id: 'song-32',
    title: '32. wo ich auch stehe.',
    artist: 'Importierte PDF',
    fileName: '32.pdf',
    fileSize: Math.round(0.19 * 1024 * 1024),
    key: 'G',
    bpm: 76,
    hasPdf: true,
    hasCover: false,
    sortOrder: 1,
  },
]
const team = [
  { id: 'member-eduard', name: 'Eduard Wiebe', initials: 'EW', roles: ['Gesang'], isLeader: true, isOrganizer: true, isDesigner: false, isTechnician: false, hasPhoto: false },
  { id: 'member-anna', name: 'Anna Berger', initials: 'AB', roles: ['Piano / Keys'], isLeader: false, isOrganizer: false, isDesigner: false, isTechnician: false, hasPhoto: false },
]
let sets = [{
  id: 'set-probe',
  title: 'Probe',
  date: '2026-09-27',
  songIds: ['song-28', 'song-32'],
  leaders: {},
  songKeys: {},
  eventTime: '19:00',
  arrivalTime: '',
  band: 'Band',
  theme: '',
  venue: '',
  techNotes: '',
  technicianId: '',
  isProtected: false,
}]
const savedBodies = []

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function pageSvg(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="100%" height="100%" fill="#f4f1ea"/><text x="48" y="90" font-size="32" font-family="sans-serif" fill="#172230">${label}</text></svg>`
  return { mime: 'image/svg+xml', dataUrl: `data:image/svg+xml,${encodeURIComponent(svg)}` }
}

async function routeApi(route) {
  const request = route.request()
  const url = request.url()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) return fulfillJson(route, { user: mockUser })
  if (url.includes('/api/onboarding')) return fulfillJson(route, mockOnboarding)
  if (url.includes('/api/songs/') && url.includes('/pages')) {
    return fulfillJson(route, { pages: [pageSvg('Seite 1'), pageSvg('Seite 2')] })
  }
  if (url.includes('/api/songs/') && url.includes('/resolve-cover')) return fulfillJson(route, { hasCover: false })
  if (url.includes('/api/songs/') && url.includes('/resolve-youtube')) return fulfillJson(route, { youtubeUrl: '' })
  if (url.includes('/api/songs')) return fulfillJson(route, songs)
  if (url.includes('/api/sets/')) {
    if (request.method() === 'PUT') {
      const body = request.postDataJSON()
      savedBodies.push(body)
      sets = sets.map((set) => set.id === body.id ? { ...set, ...body } : set)
      return fulfillJson(route, body)
    }
    return fulfillJson(route, sets[0])
  }
  if (url.includes('/api/sets')) return fulfillJson(route, sets)
  if (url.includes('/api/team')) return fulfillJson(route, team)
  if (url.includes('/api/bands')) return fulfillJson(route, [])
  if (url.includes('/api/appointments')) return fulfillJson(route, [])
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('app/dist missing')
    process.exit(1)
  }
  const playwright = await import(pathToFileURL(join(root, 'app/node_modules/playwright/index.mjs')).href)
  const server = await startStaticServer()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const browser = await playwright.chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('songbook-locale', 'de')
    localStorage.setItem('songbook-theme', 'light')
  })
  await page.route('**/api/**', routeApi)

  const failures = []
  try {
    await page.goto(`${base}/#/songs`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.song-row')
    const layout = await page.evaluate(() => {
      const row = document.querySelector('.song-row')
      const title = row.querySelector('.song-main strong')
      const sub = row.querySelector('.song-main span')
      const icon = row.querySelector('.song-icon')
      const actions = row.querySelector('.song-actions')
      const titleBox = title.getBoundingClientRect()
      const iconBox = icon.getBoundingClientRect()
      const actionsBox = actions.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const style = getComputedStyle(title)
      const lineHeight = parseFloat(style.lineHeight) || 16
      return {
        columns: getComputedStyle(row).gridTemplateColumns,
        titleWidth: Math.round(titleBox.width),
        rowWidth: Math.round(rowBox.width),
        gapAfterIcon: Math.round(titleBox.left - iconBox.right),
        actionsLeft: Math.round(actionsBox.left),
        titleRight: Math.round(titleBox.right),
        lines: titleBox.height / lineHeight,
        clamp: style.webkitLineClamp || style.lineClamp,
        title: title.textContent,
        subtitle: sub.textContent,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        actionCount: actions.querySelectorAll('button').length,
      }
    })
    console.log('layout', layout)
    assert(layout.titleWidth >= 120, `title column too narrow: ${layout.titleWidth}px`)
    assert(layout.gapAfterIcon <= 24, `empty gap after thumbnail: ${layout.gapAfterIcon}px`)
    assert(layout.actionsLeft >= layout.titleRight - 4, 'actions are not to the right of the title')
    assert(layout.lines <= 2.35, `title uses too many lines: ${layout.lines}`)
    assert(layout.scrollWidth <= layout.clientWidth + 1, `page overflows: ${layout.scrollWidth} > ${layout.clientWidth}`)
    assert(layout.actionCount >= 3, `missing row actions: ${layout.actionCount}`)
    assert(layout.subtitle.includes('0.87'), `subtitle missing file size: ${layout.subtitle}`)
    await page.screenshot({ path: join(artifactDir, 'song-list-mobile.png'), fullPage: false })

    await page.locator('.song-row').first().locator('button[title="PDF öffnen"]').click()
    await page.waitForSelector('.original-viewer')
    await page.waitForFunction(() => (document.querySelector('.original-viewer-count')?.textContent || '').includes('von'))
    const chrome = await page.evaluate(() => ({
      back: document.querySelector('.original-viewer-back')?.textContent?.trim() || '',
      close: Boolean(document.querySelector('.original-viewer-close')),
      count: document.querySelector('.original-viewer-count')?.textContent?.trim() || '',
      backBox: document.querySelector('.original-viewer-back')?.getBoundingClientRect().toJSON(),
      closeBox: document.querySelector('.original-viewer-close')?.getBoundingClientRect().toJSON(),
      navHidden: getComputedStyle(document.querySelector('.mobile-nav')).display === 'none',
    }))
    console.log('viewer', chrome)
    assert(chrome.back.includes('Zurück'), `back label missing: ${chrome.back}`)
    assert(chrome.close, 'close button missing')
    assert(chrome.count.includes('1 von 2'), `page pill missing: ${chrome.count}`)
    assert(chrome.backBox.top >= 0 && chrome.backBox.bottom <= 844, 'back button off screen')
    assert(chrome.closeBox.right <= 390 + 1, 'close button off screen')
    assert(chrome.navHidden, 'mobile nav still covers the viewer')
    await page.screenshot({ path: join(artifactDir, 'original-viewer.png'), fullPage: false })

    await page.locator('.original-viewer-close').click()
    await page.waitForSelector('.original-viewer', { state: 'detached' })
    await page.waitForSelector('.song-row')
    const stillThere = await page.locator('.song-main strong').first().textContent()
    assert(stillThere.includes('Jesus'), 'song list lost after close')

    await page.locator('.song-row').first().locator('button[title="PDF öffnen"]').click()
    await page.waitForSelector('.original-viewer')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.original-viewer', { state: 'detached' })

    await page.locator('.song-row').first().locator('button[title="PDF öffnen"]').click()
    await page.waitForSelector('.original-viewer')
    await page.goBack()
    await page.waitForSelector('.original-viewer', { state: 'detached' })
    await page.waitForSelector('.song-row')

    await page.goto(`${base}/#/sets/set-probe`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.leader-select')
    const lead = await page.evaluate(() => {
      const label = document.querySelector('.leader-select-label')?.textContent?.trim()
      const select = document.querySelector('.leader-select select')
      const box = select.getBoundingClientRect()
      return {
        label,
        options: [...select.options].map((option) => option.textContent),
        width: Math.round(box.width),
        top: Math.round(box.top),
      }
    })
    console.log('lead', lead)
    assert(lead.label === 'Leiter', `leader label: ${lead.label}`)
    assert(lead.options.some((option) => option.includes('Eduard Wiebe')), 'band member missing from Leiter list')
    assert(lead.options.some((option) => option.includes('Anna Berger')), 'second member missing')
    assert(lead.width >= 140, `Leiter select too narrow: ${lead.width}px`)
    await page.locator('.leader-select select').first().selectOption('member-eduard')
    await page.waitForTimeout(200)
    const saved = savedBodies.at(-1)
    console.log('saved leaders', saved?.leaders)
    assert(saved?.leaders?.['song-28'] === 'member-eduard', `leader was not saved: ${JSON.stringify(saved?.leaders)}`)
    const shown = await page.locator('.leader-select select').first().inputValue()
    assert(shown === 'member-eduard', `select did not keep the member: ${shown}`)
    await page.screenshot({ path: join(artifactDir, 'set-leiter.png'), fullPage: true })
    console.log('UX checks passed')
  } catch (error) {
    failures.push(error)
    await page.screenshot({ path: join(artifactDir, 'ux-failure.png'), fullPage: true }).catch(() => {})
    console.error(error)
  } finally {
    await context.close()
    await browser.close()
    server.close()
  }
  if (failures.length) process.exit(1)
}

main()
