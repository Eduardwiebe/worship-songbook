#!/usr/bin/env node
/**
 * Integration test: staff-system OCR + musical page understanding.
 * Synthetic hymnal art uses original placeholder lyrics only.
 * A local private scan is used when present and is never copied into the repo.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstructLeadsheet } from '../lib/leadsheetReconstruct.mjs'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OCR_PYTHON = process.env.SONGBOOK_OCR_PYTHON || join(root, '.venv-ocr/bin/python')
const outDir = join(root, 'fixtures/leadsheet')
const realScan = process.env.SONGBOOK_REAL_SCAN
  || '/tmp/songbook-phase2-layout/run-790da40b/page-1.png'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function renderSyntheticHymnal() {
  await mkdir(outDir, { recursive: true })
  const path = join(outDir, 'hymnal-layout.png')
  const script = `
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (2200, 2800), 'white')
d = ImageDraw.Draw(img)
try:
    title_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 54)
    body = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 36)
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 28)
except Exception:
    title_font = body = small = ImageFont.load_default()

d.text((220, 90), '32', fill='black', font=title_font)
d.text((820, 90), 'Morgenlicht', fill='black', font=title_font)
d.rectangle((150, 700, 230, 1120), fill='#222222')
# vertical rubric drawn as stacked letters
d.text((165, 860), 'LOB', fill='white', font=small)
d.text((165, 920), '&', fill='white', font=small)
d.text((165, 970), 'DANK', fill='white', font=small)
d.text((260, 370), '156', fill='black', font=small)

def staff(y0):
    for i in range(5):
        y = y0 + i * 20
        d.line((320, y, 2000, y), fill='black', width=3)

staff(460)
d.text((400, 390), 'C', fill='black', font=body)
d.text((980, 390), 'G', fill='black', font=body)
d.text((1500, 390), 'F', fill='black', font=body)
d.text((380, 560), '1. Alpha beta gam - ma, delta epsi - lon.', fill='black', font=body)
d.text((380, 640), '2. Zeta eta the - ta, iota kap - pa.', fill='black', font=body)

staff(820)
d.text((400, 750), 'Em', fill='black', font=body)
d.text((980, 750), 'Am', fill='black', font=body)
d.text((1500, 750), 'G', fill='black', font=body)
d.text((380, 920), 'Wenn Licht den Weg be - schreibt.', fill='black', font=body)
d.text((380, 1000), 'Die Nacht wird barm - her - zig hell.', fill='black', font=body)

staff(1180)
d.text((380, 1100), 'Refrain', fill='black', font=body)
d.text((700, 1100), 'Am', fill='black', font=body)
d.text((980, 1100), 'F', fill='black', font=body)
d.text((1500, 1100), 'C', fill='black', font=body)
d.text((380, 1280), 'Wir sin - gen heut von Frie - den und Ge - duld.', fill='black', font=body)

d.text((240, 2400), 'Text und Melodie: Example Author', fill='black', font=small)
d.text((240, 2460), '1999 Example Verlag, Example City', fill='black', font=small)
d.text((1040, 2680), '62', fill='black', font=title_font)
img.save(${JSON.stringify(path)})
print(${JSON.stringify(path)})
`
  await execFileAsync(OCR_PYTHON, ['-c', script], { timeout: 30000 })
  return path
}

function structuralChecks(text, { requireTitle = 'Morgenlicht', real = false } = {}) {
  const fail = []
  const expect = {
    strophe1: /\[Strophe 1\]/.test(text),
    strophe2: /\[Strophe 2\]/.test(text),
    refrain: /\[Refrain\]/.test(text),
    refrainOnce: (text.match(/\[Refrain\]/g) || []).length === 1,
    order: text.indexOf('[Strophe 1]') >= 0
      && text.indexOf('[Strophe 1]') < text.indexOf('[Strophe 2]')
      && text.indexOf('[Strophe 2]') < text.indexOf('[Refrain]'),
    noLob: !/LOB/.test(text),
    noPage62: !/(^|\n)62(\n|$)/.test(text),
    noSong32: !/(^|\n)32(\n|$)/.test(text),
    noTempo: !/(^|\n)156(\n|$)/.test(text),
    noBareHyphenSyllable: !/(\p{L}{1,6})\s+-\s+(\p{L}{1,6})/u.test(text),
  }
  if (!real) {
    expect.title = text.includes(requireTitle)
    expect.gamma = /gamma/i.test(text)
    expect.barmherzig = /barmherzig/i.test(text)
    expect.geduld = /Geduld/i.test(text)
    expect.verseSplit = /\[Strophe 1\][\s\S]*Alpha beta[\s\S]*\[Strophe 2\]/.test(text)
      && !/\[Strophe 1\][\s\S]*Zeta eta[\s\S]*\[Strophe 2\]/.test(text)
    expect.noVerlag = !/Example Verlag/.test(text)
    expect.noDankLeak = !/DANI|DANK/.test(text)
  }
  for (const [name, ok] of Object.entries(expect)) {
    if (!ok) fail.push(name)
  }
  return fail
}

async function ocrAndReconstruct(imagePath, titleHint = '') {
  const { stdout } = await execFileAsync(OCR_PYTHON, [join(root, 'ocr_structured.py'), imagePath], {
    maxBuffer: 40 * 1024 * 1024,
    timeout: 180000,
  })
  const structured = JSON.parse(stdout)
  const reconstructed = reconstructLeadsheet(structured, { titleHint })
  return { structured, reconstructed }
}

const syntheticPath = await renderSyntheticHymnal()
const synthetic = await ocrAndReconstruct(syntheticPath, 'Morgenlicht')
assert((synthetic.structured.pages[0].systems || []).length >= 2, `synthetic staffs: ${JSON.stringify(synthetic.structured.pages[0].systems)}`)
const syntheticFails = structuralChecks(synthetic.reconstructed.text)
console.log('synthetic engine', synthetic.structured.engine, 'systems', synthetic.structured.pages[0].systems.length)
console.log('--- synthetic text ---\n' + synthetic.reconstructed.text)
if (syntheticFails.length) {
  throw new Error(`synthetic hymnal failed: ${syntheticFails.join(', ')}`)
}
console.log('OK synthetic hymnal OCR + reconstruction')

let realScanRan = false
try {
  await readFile(realScan)
  realScanRan = true
} catch {
  realScanRan = false
}

if (realScanRan) {
  const real = await ocrAndReconstruct(realScan, '')
  console.log('real engine', real.structured.engine, 'systems', real.structured.pages[0].systems?.length)
  console.log('--- real text ---\n' + real.reconstructed.text)
  const realFails = structuralChecks(real.reconstructed.text, { real: true })
  if (realFails.length) {
    throw new Error(`real scan failed: ${realFails.join(', ')}`)
  }
  assert(real.reconstructed.layout.usedStaves, 'real scan must use staff systems')
  assert(real.reconstructed.layout.parallelVerseTracks >= 2, 'real scan parallel tracks')
  assert(!/©|Hänssler|Hanssler|1994SCM/.test(real.reconstructed.text), 'real copyright filtered')
  console.log('OK real local scan reconstruction')
} else {
  console.log('SKIP real scan (no local page image)')
}

await writeFile(join(outDir, 'page-understanding-report.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  synthetic: {
    systems: synthetic.structured.pages[0].systems,
    usedStaves: synthetic.reconstructed.layout.usedStaves,
  },
  realScanRan,
}, null, 2))

console.log('test-musical-page-understanding: all passed')
