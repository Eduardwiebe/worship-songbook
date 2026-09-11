#!/usr/bin/env node
/**
 * Visual harness for RunSet safe-area toolbar layout.
 * Loads built CSS + static RunSet markup; simulates iOS insets via CSS substitution.
 */
import { chromium } from '../app/node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dist = join(root, 'app/dist')
const outDir = join(root, 'tmp/runset-safe-area')
mkdirSync(outDir, { recursive: true })

const cssName = readFileSync(join(dist, 'index.html'), 'utf8').match(/assets\/index-[^"]+\.css/)?.[0]
if (!cssName) throw new Error('built css not found in dist/index.html')
let css = readFileSync(join(dist, cssName), 'utf8')
if (!css.includes('safe-area-inset-top')) throw new Error('built CSS missing safe-area-inset-top')
if (!css.includes('run-meta')) throw new Error('built CSS missing run-meta')

function withInsets(source, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  // Vite may minify env() fallbacks with or without spaces after commas.
  const repl = (name, px) => {
    const re = new RegExp(`env\\(${name}\\s*,\\s*0px\\)`, 'g')
    return source.replace(re, `${px}px`)
  }
  let out = source
  out = out.replace(/env\(safe-area-inset-top\s*,\s*0px\)/g, `${top}px`)
  out = out.replace(/env\(safe-area-inset-right\s*,\s*0px\)/g, `${right}px`)
  out = out.replace(/env\(safe-area-inset-bottom\s*,\s*0px\)/g, `${bottom}px`)
  out = out.replace(/env\(safe-area-inset-left\s*,\s*0px\)/g, `${left}px`)
  return out
}

const markup = (label) => `<!doctype html><html lang="de"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>RunSet safe-area ${label}</title>
<link rel="stylesheet" href="/harness.css"/>
<style>
  html,body{margin:0;height:100%;background:#050c16}
  /* Fake iOS status bar so overlap is visible if padding is wrong */
  .fake-status{
    position:fixed;z-index:500;left:0;right:0;top:0;height:var(--fake-status-h,0px);
    pointer-events:none;
    background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.15));
    color:#fff;font:600 12px/var(--fake-status-h,0) system-ui;
    display:flex;justify-content:space-between;padding:0 14px;box-sizing:border-box;
  }
  .pdf-stage-scroll{display:flex;align-items:flex-start;justify-content:center;padding:24px;background:#fff;color:#111}
  .chart-mock{width:min(720px,100%);font:14px ui-monospace,monospace}
  .chart-mock h1{margin:0 0 6px;font:700 26px system-ui}
  .chart-mock .key{color:#785d1f;font:700 14px system-ui;margin-bottom:16px}
</style>
</head><body>
<div class="fake-status"><span>9:41</span><span>5G ▮▮▮▮</span></div>
<div class="run-mode">
  <header>
    <div class="run-meta">
      <p class="eyebrow">SET MODUS</p>
      <strong>Feuerwehr Gottesdienst Abend</strong>
      <span>1/4 · Groß ist unser Gott · Tonart D</span>
    </div>
    <div class="run-tools">
      <div class="tool-group scroll-tool"><span>Auto-Scroll</span><button type="button" aria-label="auto">▶</button></div>
      <div class="tool-group cajon-tool"><span>BPM / Cajón</span><input value="120"/><button type="button" aria-label="cajon">▶</button></div>
      <button class="icon-button" aria-label="close">✕</button>
    </div>
  </header>
  <main class="pdf-stage">
    <div class="pdf-stage-scroll">
      <div class="chart-mock"><h1>Groß ist unser Gott</h1><div class="key">Tonart: D</div>
      <div>[REFRAIN]</div>
      <div>D&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;G/D</div>
      <div>Groß ist unser Gott und...</div></div>
    </div>
    <button class="stage-arrow left" aria-label="prev">‹</button>
    <button class="stage-arrow right" aria-label="next">›</button>
  </main>
  <footer>
    <button>‹ Zurück</button>
    <div><span class="active"></span><span></span><span></span></div>
    <button>Weiter ›</button>
  </footer>
</div>
</body></html>`

function startServer(cssText) {
  const server = http.createServer((req, res) => {
    if (req.url === '/harness.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
      res.end(cssText)
      return
    }
    if (req.url?.startsWith('/shot')) {
      const label = decodeURIComponent((req.url.split('?label=')[1] || 'run'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(markup(label))
      return
    }
    res.writeHead(404)
    res.end('no')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

const shots = [
  { name: 'phone-390-portrait', width: 390, height: 844, insets: { top: 47, right: 0, bottom: 34, left: 0 }, status: 47 },
  { name: 'phone-844-landscape', width: 844, height: 390, insets: { top: 0, right: 47, bottom: 21, left: 47 }, status: 20 },
  { name: 'tablet-768', width: 768, height: 1024, insets: { top: 24, right: 0, bottom: 20, left: 0 }, status: 24 },
  { name: 'desktop-1280', width: 1280, height: 800, insets: { top: 0, right: 0, bottom: 0, left: 0 }, status: 0 },
]

const browser = await chromium.launch()
const results = []
for (const shot of shots) {
  const { server, port } = await startServer(withInsets(css, shot.insets))
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2 })
  await page.goto(`http://127.0.0.1:${port}/shot?label=${encodeURIComponent(shot.name)}`, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: `:root{--fake-status-h:${shot.status}px}` })
  // Measure whether tools clear the fake status bar
  const metrics = await page.evaluate((statusH) => {
    const tools = document.querySelector('.run-tools')
    const header = document.querySelector('.run-mode header')
    const footer = document.querySelector('.run-mode footer')
    const tr = tools.getBoundingClientRect()
    const hr = header.getBoundingClientRect()
    const fr = footer.getBoundingClientRect()
    return {
      toolsTop: tr.top,
      toolsHeight: tr.height,
      headerTop: hr.top,
      headerPaddingTop: getComputedStyle(header).paddingTop,
      footerPaddingBottom: getComputedStyle(footer).paddingBottom,
      clearsStatus: tr.top >= statusH - 0.5,
      viewportH: window.innerHeight,
    }
  }, shot.status)
  const file = join(outDir, `${shot.name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  results.push({ ...shot, ...metrics, file })
  await page.close()
  server.close()
}
await browser.close()
writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => r.status > 0 && !r.clearsStatus)
console.log(JSON.stringify(results.map(({ name, toolsTop, headerPaddingTop, footerPaddingBottom, clearsStatus, file }) => ({ name, toolsTop, headerPaddingTop, footerPaddingBottom, clearsStatus, file })), null, 2))
if (failed.length) {
  console.error('FAIL: tools still under status bar', failed.map((f) => f.name))
  process.exit(1)
}
console.log('OK all viewports clear status / layout captured')
