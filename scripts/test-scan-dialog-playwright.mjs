#!/usr/bin/env node
/**
 * Browser check: camera/gallery scan shows page detection and a straightened preview.
 * Requires app/dist (cd app && npm run build) and Playwright chromium.
 */
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, dirname } from 'node:path'
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
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

function fulfillJson(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function routeApi(route) {
  const url = route.request().url()
  if (url.includes('/api/auth/me') || url.includes('/api/auth/native/me')) {
    return fulfillJson(route, { user: { id: 'scan-ui', name: 'Scan Test', role: 'admin', mustChangePassword: false, hasPhoto: false } })
  }
  if (url.includes('/api/onboarding')) {
    return fulfillJson(route, { step: 0, completed: true, manualRestart: false, mode: '', data: {} })
  }
  if (url.includes('/api/version')) return fulfillJson(route, { version: '1.1.1', releaseUrl: 'https://songbook.lyruma.de' })
  if (url.includes('/api/')) return fulfillJson(route, [])
  return route.continue()
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

function makeFixtures() {
  const dir = tmpdir()
  const skewed = join(dir, 'songbook-scan-skewed.jpg')
  const full = join(dir, 'songbook-scan-full.jpg')
  const script = `
from PIL import Image, ImageDraw
import sys
skewed, full = sys.argv[1:]
page = Image.new('RGB', (900, 1200), (248, 246, 240))
draw = ImageDraw.Draw(page)
for y in range(80, 1100, 36):
    draw.rectangle((50, y, 850, y + 3), fill=(20, 20, 20))
canvas = Image.new('RGB', (1300, 1700), (48, 42, 38))
# Paste a rotated page so the photo is not already a straight sheet.
rotated = page.rotate(11, expand=True, fillcolor=(48, 42, 38))
ox = (canvas.width - rotated.width) // 2
oy = (canvas.height - rotated.height) // 2
canvas.paste(rotated, (ox, oy))
canvas.save(skewed, quality=90)
page.save(full, quality=90)
print(canvas.size[0], canvas.size[1], page.size[0], page.size[1])
`
  const proc = spawnSync('python3', ['-c', script, skewed, full], { encoding: 'utf8' })
  if (proc.status !== 0) {
    console.error(proc.stderr)
    process.exit(proc.status || 1)
  }
  const [sw, sh, fw, fh] = proc.stdout.trim().split(/\s+/).map(Number)
  return { skewed, full, skewedSize: { w: sw, h: sh }, fullSize: { w: fw, h: fh } }
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('app/dist missing — run: cd app && npm run build')
    process.exit(1)
  }
  const fixtures = makeFixtures()
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    playwright = await import(pathToFileURL(join(root, 'app/node_modules/playwright/index.mjs')).href)
  }

  const server = await startStaticServer()
  const port = server.address().port
  const base = `http://127.0.0.1:${port}/`
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', (error) => console.error('PAGEERROR', error.message))
  page.on('console', (msg) => {
    const text = msg.text()
    if (msg.type() === 'error' || text.startsWith('scan:')) console.error('CONSOLE', msg.type(), text)
  })
  await page.addInitScript(() => {
    localStorage.setItem('songbook-locale', 'de')
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 880
    const ctx = canvas.getContext('2d')
    const draw = () => {
      ctx.fillStyle = '#2b2622'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#f7f4ec'
      ctx.beginPath()
      ctx.moveTo(90, 78)
      ctx.lineTo(560, 68)
      ctx.lineTo(576, 802)
      ctx.lineTo(72, 812)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#161616'
      for (let y = 120; y < 760; y += 28) ctx.fillRect(110, y, 420, 3)
    }
    draw()
    const stream = canvas.captureStream(12)
    const loop = () => { draw(); requestAnimationFrame(loop) }
    loop()
    navigator.mediaDevices = navigator.mediaDevices || {}
    navigator.mediaDevices.getUserMedia = async () => stream
  })
  await page.route('**/api/**', routeApi)
  await page.goto(base, { waitUntil: 'networkidle' })

  await page.getByRole('button', { name: 'Hinzufügen' }).first().click()
  await page.getByRole('button', { name: /Aus einem Buch scannen/ }).click()
  const modal = page.locator('.scan-modal')
  await modal.getByText('erkannt, begradigt und zugeschnitten').waitFor()
  const modalText = await modal.innerText()
  if (/AKKORDE|LEADSHEET|Tonart ändern/.test(modalText)) {
    throw new Error('scan dialog reintroduced chord/LeadSheet controls')
  }

  const gallery = page.locator('.scan-modal input[type="file"][accept="image/*"]')
  await gallery.nth(1).setInputFiles(fixtures.skewed)
  try {
    await modal.getByText('Begradigt', { exact: true }).waitFor({ timeout: 20000 })
  } catch (error) {
    console.error('MODAL TEXT:', await modal.innerText().catch(() => ''))
    console.error('BADGES:', await modal.locator('.scan-detect-badge').allInnerTexts().catch(() => []))
    throw error
  }
  const preview = await modal.locator('.scan-pages img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }))
  if (!(preview.w < fixtures.skewedSize.w - 40 && preview.h < fixtures.skewedSize.h - 40)) {
    throw new Error(`preview was not cropped: ${preview.w}x${preview.h} from ${fixtures.skewedSize.w}x${fixtures.skewedSize.h}`)
  }
  console.log(`OK scan dialog straightened preview ${preview.w}x${preview.h}`)

  await modal.locator('.scan-pages article button').last().click()
  await gallery.nth(1).setInputFiles(fixtures.full)
  await modal.getByText('Ganzes Foto', { exact: true }).waitFor({ timeout: 20000 })
  const fullPreview = await modal.locator('.scan-pages img').evaluate((img) => ({ w: img.naturalWidth, h: img.naturalHeight }))
  if (Math.abs(fullPreview.w - fixtures.fullSize.w) > 4 || Math.abs(fullPreview.h - fixtures.fullSize.h) > 4) {
    throw new Error(`full-frame photo was cropped: ${fullPreview.w}x${fullPreview.h}`)
  }
  console.log('OK scan dialog keeps a full-bleed sheet')

  await modal.getByRole('button', { name: /Nächste Seite scannen|Seite scannen/ }).click()
  const live = page.locator('.live-scan')
  await live.waitFor()
  const sawOutline = await page.waitForFunction(() => {
    const stage = document.querySelector('.live-scan-stage')
    const canvas = document.querySelector('.live-scan-overlay')
    if (!stage || !canvas || stage.getAttribute('data-quad') !== '1') return false
    const ctx = canvas.getContext('2d')
    if (!ctx || !canvas.width || !canvas.height) return false
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let blue = 0
    for (let i = 0; i < pixels.length; i += 16) {
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const a = pixels[i + 3]
      if (a > 18 && b > r + 12 && b > 70) blue += 1
    }
    return blue > 24
  }, null, { timeout: 12000 }).then(() => true).catch(() => false)
  if (!sawOutline) {
    console.error('LIVE TEXT:', await live.innerText().catch(() => ''))
    throw new Error('live camera did not draw a blue page outline')
  }
  console.log('OK live camera draws a blue page outline')
  await live.screenshot({ path: '/tmp/live-scan-overlay.png' })
  await page.getByText('Begradigte Seite').waitFor({ timeout: 12000 })
  await live.screenshot({ path: '/tmp/live-scan-preview.png' })
  const liveText = await live.innerText()
  if (/AKKORDE|LEADSHEET|Tonart ändern/.test(liveText)) {
    throw new Error('live scanner reintroduced chord controls')
  }
  await live.getByRole('button', { name: 'Seite übernehmen' }).click()
  await live.waitFor({ state: 'hidden' })
  await modal.getByText('Begradigt', { exact: true }).waitFor({ timeout: 5000 })
  console.log('OK live capture returns a straightened page')

  await browser.close()
  server.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
