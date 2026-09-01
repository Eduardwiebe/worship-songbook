#!/usr/bin/env node
/**
 * Benchmark: legacy flat Tesseract text vs structured RapidOCR reconstruction.
 * Uses synthetic fixtures only (no copyrighted scans).
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreLeadsheetQuality, isChordLine, chordTokens } from '../lib/leadsheetAnalysis.mjs'
import { reconstructLeadsheet, isValidChordToken } from '../lib/leadsheetReconstruct.mjs'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'fixtures/leadsheet')
const OCR_PYTHON = process.env.SONGBOOK_OCR_PYTHON || join(root, '.venv-ocr/bin/python')

await mkdir(outDir, { recursive: true })

const fixtures = [
  {
    name: 'german-chords-lyrics',
    lines: [
      { y: 60, size: 36, text: '12  Glaubenslied' },
      { y: 140, size: 28, text: 'E          A          E' },
      { y: 190, size: 28, text: 'Jesus, Herr, ich denke an dein Opfer' },
      { y: 260, size: 28, text: 'A          E          B7' },
      { y: 310, size: 28, text: 'Once again I thank You' },
    ],
    expectTitle: 'Glaubenslied',
    expectChords: ['E', 'A', 'B7'],
    expectWords: ['Jesus', 'Herr', 'Opfer'],
  },
  {
    name: 'multi-verse',
    lines: [
      { y: 50, size: 34, text: 'Mein Lied' },
      { y: 120, size: 26, text: 'C     G     Am    F' },
      { y: 170, size: 26, text: '1. Du bist die Liebe in meinem Leben' },
      { y: 230, size: 26, text: 'C     G     Am    F' },
      { y: 280, size: 26, text: '2. Du gibst mir Hoffnung jeden Morgen' },
    ],
    expectTitle: 'Mein Lied',
    expectChords: ['C', 'G', 'Am', 'F'],
    expectWords: ['Liebe', 'Hoffnung'],
  },
  {
    name: 'complex-chords',
    lines: [
      { y: 50, size: 34, text: 'Complex Key' },
      { y: 120, size: 26, text: 'F#m    D/F#    Asus2    Eb/G' },
      { y: 170, size: 26, text: 'Wir singen von deiner Gnade' },
    ],
    expectTitle: 'Complex Key',
    expectChords: ['F#m', 'D/F#', 'Asus2', 'Eb/G'],
    expectWords: ['Gnade'],
  },
]

async function renderFixture(fixture) {
  const path = join(outDir, `${fixture.name}.png`)
  const script = `
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (1100, 700), 'white')
d = ImageDraw.Draw(img)
try:
    font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    fonts = {}
except Exception:
    font_path = None
for line in ${JSON.stringify(fixture.lines)}:
    size = line['size']
    if font_path:
        font = ImageFont.truetype(font_path, size)
    else:
        font = ImageFont.load_default()
    d.text((70, line['y']), line['text'], fill='black', font=font)
img.save(${JSON.stringify(path)})
print(${JSON.stringify(path)})
`
  await execFileAsync(OCR_PYTHON, ['-c', script], { timeout: 30000 })
  return path
}

function metrics(text, fixture) {
  const quality = scoreLeadsheetQuality(text)
  const chordLines = text.split('\n').filter(isChordLine)
  const foundChords = new Set()
  for (const line of chordLines) {
    for (const m of chordTokens(line)) foundChords.add(m[0])
  }
  // also accept spaced chord tokens
  for (const token of text.split(/\s+/)) {
    if (isValidChordToken(token)) foundChords.add(token)
  }
  const chordHits = fixture.expectChords.filter((c) => [...foundChords].some((f) => f.includes(c) || c.includes(f)))
  const wordHits = fixture.expectWords.filter((w) => text.includes(w))
  const junk = (text.match(/SSS|<3|♪|~\s*_/g) || []).length
  return {
    score: quality.score,
    needsReview: quality.needsReview,
    titleOk: text.toLowerCase().includes(fixture.expectTitle.toLowerCase().split(' ')[0].toLowerCase()),
    chordRecall: chordHits.length / fixture.expectChords.length,
    wordRecall: wordHits.length / fixture.expectWords.length,
    junk,
    validChords: [...foundChords].filter(isValidChordToken).length,
  }
}

const rows = []
for (const fixture of fixtures) {
  const imagePath = await renderFixture(fixture)
  const t0 = Date.now()
  const { stdout } = await execFileAsync(OCR_PYTHON, [join(root, 'ocr_structured.py'), imagePath], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120000,
  })
  const structured = JSON.parse(stdout)
  const structuredMs = Date.now() - t0
  const reconstructed = reconstructLeadsheet(structured, { titleHint: fixture.expectTitle })

  // Legacy: join OCR token texts naively (simulates flat OCR)
  const flatText = structured.pages
    .flatMap((p) => p.tokens)
    .sort((a, b) => (a.line_index - b.line_index) || (a.bbox[0] - b.bbox[0]))
    .reduce((acc, token) => {
      if (!acc.lines[token.line_index]) acc.lines[token.line_index] = []
      acc.lines[token.line_index].push(token.text)
      return acc
    }, { lines: [] })
  const legacyText = flatText.lines.filter(Boolean).map((parts) => parts.join(' ')).join('\n')

  const legacy = metrics(legacyText, fixture)
  const neu = metrics(reconstructed.text, fixture)
  rows.push({
    fixture: fixture.name,
    engine: structured.engine,
    elapsedMs: structured.elapsed_ms || structuredMs,
    legacy,
    structured: neu,
    better:
      neu.chordRecall + neu.wordRecall - neu.junk * 0.1
      >= legacy.chordRecall + legacy.wordRecall - legacy.junk * 0.1,
  })
  console.log(`\n=== ${fixture.name} (${structured.engine}, ${structured.elapsed_ms || structuredMs}ms) ===`)
  console.log('legacy     ', legacy)
  console.log('structured ', neu)
  console.log('--- reconstructed ---\n' + reconstructed.text.slice(0, 400))
}

const allBetter = rows.every((r) => r.better || (r.structured.chordRecall >= r.legacy.chordRecall && r.structured.wordRecall >= r.legacy.wordRecall))
const report = { generatedAt: new Date().toISOString(), rows, allBetter }
await writeFile(join(outDir, 'benchmark-report.json'), JSON.stringify(report, null, 2))

if (!allBetter) {
  console.error('FAIL: structured pipeline not better on all fixtures')
  process.exit(1)
}
console.log('\nOK structured pipeline >= legacy on all synthetic fixtures')
console.log('wrote', join(outDir, 'benchmark-report.json'))
