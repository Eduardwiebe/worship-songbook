#!/usr/bin/env node
/**
 * Playwright overflow audit — scrollWidth must equal clientWidth on main pages.
 * Requires: npm run build && npx playwright install chromium
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'app/dist')
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

const VIEWPORTS = [
  [320, 690], [360, 740], [375, 812], [390, 844], [393, 852], [402, 874],
  [414, 896], [430, 932], [768, 1024], [810, 1080], [820, 1180], [834, 1194],
  [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
]

const ROUTES = ['/', '/songs', '/bands', '/team', '/sets', '/termine', '/einstellungen']

const mockUser = {
  id: 'overflow-test',
  name: 'Overflow Test',
  role: 'admin',
  mustChangePassword: false,
  hasPhoto: false,
}

const mockOnboarding = {
  step: 0,
  completed: true,
  manualRestart: false,
  mode: '',
  data: {},
}

const mockSongs = Array.from({ length: 6 }, (_, i) => ({
  id: `song-${i}`,
  title: `Jesus, Herr, ich denke an dein Opfer (${i + 1})`,
  artist: 'Gescannter Import',
  key: 'D',
  sourceKey: 'D',
  preferredKey: 'D',
  hasPdf: true,
  variantKeys: ['D'],
  sortOrder: i,
}))

const mockSets = Array.from({ length: 4 }, (_, i) => ({
  id: `set-${i}`,
  title: `Sonntag Morgengottesdienst ${i + 1}`,
  theme: 'Fundament der Gnade',
  date: '2026-09-07',
  venue: ' Gemeindehaus Mitte',
  songIds: ['song-0', 'song-1'],
}))

const mockTeam = Array.from({ length: 5 }, (_, i) => ({
  id: `member-${i}`,
  name: `Teammitglied ${i + 1}`,
  initials: `T${i + 1}`,
  roles: ['vocals'],
  isLeader: i === 0,
  isOrganizer: false,
}))

const mockBands = [{
  id: 'band-1',
  name: 'Worship Team Gemeinde',
  active: true,
  description: 'Band',
}]

async function fulfillJson(route, data) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
}

function routeApi(url, route) {
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) {
    return fulfillJson(route, { user: mockUser })
  }
  if (url.includes('/api/onboarding')) {
    return fulfillJson(route, mockOnboarding)
  }
  if (url.includes('/api/songs')) {
    return fulfillJson(route, mockSongs)
  }
  if (url.includes('/api/sets')) {
    return fulfillJson(route, mockSets)
  }
  if (url.includes('/api/team')) {
    return fulfillJson(route, mockTeam)
  }
  if (url.includes('/api/bands') || url.includes('/api/band')) {
    return fulfillJson(route, mockBands)
  }
  if (url.includes('/api/appointments')) {
    return fulfillJson(route, [])
  }
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

function auditOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const sw = document.documentElement.scrollWidth
    const offenders = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 && r.height < 1) continue
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          className: String(el.className || '').slice(0, 80),
          right: Math.round(r.right),
          left: Math.round(r.left),
          width: Math.round(r.width),
        })
      }
    }
    offenders.sort((a, b) => b.right - a.right)
    return { vw, sw, offenders: offenders.slice(0, 8) }
  })
}

async function main() {
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    try {
      playwright = await import(pathToFileURL(join(root, 'app/node_modules/playwright/index.mjs')).href)
    } catch {
      console.error('playwright not installed — run: cd app && npm i -D playwright && npx playwright install chromium')
      process.exit(1)
    }
  }

  const server = await startStaticServer()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`

  const browser = await playwright.chromium.launch()
  const context = await browser.newContext()
  await context.route('**/api/**', async (route) => routeApi(route.request().url(), route))

  const page = await context.newPage()
  let failures = []

  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height })
    for (const route of ROUTES) {
      await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(300)
      const { vw, sw, offenders } = await auditOverflow(page)
      if (sw > vw + 1) {
        failures.push({ width, height, route, vw, sw, offenders })
        console.error(`FAIL ${width}x${height} ${route} scrollWidth=${sw} clientWidth=${vw}`)
        for (const o of offenders.slice(0, 3)) {
          console.error(`  → .${o.className.split(' ')[0] || o.tag} right=${o.right} width=${o.width}`)
        }
      } else {
        console.log(`OK ${width}x${height} ${route}`)
      }
    }
  }

  await browser.close()
  server.close()

  if (failures.length) {
    console.error(`\n${failures.length} overflow failure(s)`)
    process.exit(1)
  }
  console.log('\ntest-overflow-playwright: all passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
