#!/usr/bin/env node
/**
 * POST /api/scans must not touch `pdf` before it is initialized.
 * srv1: ReferenceError: Cannot access 'pdf' before initialization
 * at preferSongTitle — that was the "Interner Serverfehler." Deskew was not the cause.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'server.mjs'), 'utf8')
const start = source.indexOf("pathname==='/api/scans'")
assert.ok(start > 0, 'scans route missing')
const slice = source.slice(start, start + 1800)
const declaration = slice.indexOf("const pdf=form.get('pdf')")
const use = slice.indexOf('pdf && typeof pdf')
assert.ok(declaration !== -1 && use !== -1, 'pdf declaration or use missing')
assert.ok(declaration < use, 'pdf is read before its const declaration')
assert.match(source, /runScanToPdf/)
assert.match(source, /statusCode === 422|statusCode===422/)
console.log('OK scan route reads pdf before preferSongTitle')

const broken = `
  const form = { get(name) { return name === 'title' ? 'Herr, ich komme zu dir' : null } }
  const title = (pdf && typeof pdf !== 'string') ? String(pdf.name || '') : form.get('title')
  const pdf = form.get('pdf')
  title
`
assert.throws(() => vm.runInNewContext(broken), /before initialization/)

const fixed = `
  const form = { get(name) { return name === 'title' ? 'Herr, ich komme zu dir' : null } }
  const pdf = form.get('pdf')
  const title = (pdf && typeof pdf !== 'string') ? String(pdf.name || '') : form.get('title')
  title
`
assert.equal(vm.runInNewContext(fixed), 'Herr, ich komme zu dir')
console.log('OK title lookup no longer throws when pdf is absent')

const dir = mkdtempSync(join(tmpdir(), 'songbook-scan-guard-'))
const photo = join(dir, 'page.jpg')
const pdf = join(dir, 'out.pdf')
const draw = spawnSync('python3', ['-c', `
from PIL import Image, ImageDraw
photo, = __import__('sys').argv[1:]
page = Image.new('RGB', (700, 980), (248, 246, 240))
draw = ImageDraw.Draw(page)
for y in range(70, 900, 34):
    draw.rectangle((40, y, 660, y + 3), fill=(20, 20, 20))
canvas = Image.new('RGB', (1000, 1400), (42, 38, 34))
rotated = page.rotate(8, expand=True, fillcolor=(42, 38, 34))
canvas.paste(rotated, ((canvas.width - rotated.width) // 2, (canvas.height - rotated.height) // 2))
canvas.save(photo, quality=90)
`, photo], { encoding: 'utf8' })
if (draw.status !== 0) {
  console.error(draw.stderr)
  process.exit(draw.status || 1)
}
const proc = spawnSync('python3', [join(root, 'scan_to_pdf.py'), pdf, photo], { encoding: 'utf8' })
if (proc.status !== 0) {
  console.error(proc.stderr)
  process.exit(proc.status || 1)
}
assert.match(proc.stderr, /deskew-crop/)
assert.ok(readFileSync(pdf).subarray(0, 4).toString() === '%PDF')
console.log('OK phone-like photo becomes an Original PDF')

const junk = join(dir, 'junk.bin')
writeFileSync(junk, Buffer.from('not-a-photo'))
const bad = spawnSync('python3', [join(root, 'scan_to_pdf.py'), join(dir, 'bad.pdf'), junk], { encoding: 'utf8' })
assert.notEqual(bad.status, 0)
assert.match(`${bad.stderr}\n${bad.stdout}`, /Bildformat/)
console.log('OK unreadable upload does not pretend to be a PDF')
