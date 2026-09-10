#!/usr/bin/env node
/**
 * Regression checks for scan import sources converging on lead-sheet model.
 * PDF extraction path is unit-tested via analyzePdfPageText + mocked page texts
 * (full pdftotext/OCR integration remains covered by existing OCR tests).
 */
import { readFile } from 'node:fs/promises'
import { parseChordOverLyricsText, analyzePdfPageText, suggestSongPageIndices } from '../lib/chordTextParse.mjs'
import { shouldRunOcr, scoreLeadsheetQuality, isChordLine } from '../lib/leadsheetAnalysis.mjs'
import { inferKeyFromLeadsheet, transposeEditorText, resolveScanSourceKey } from '../lib/editorKey.mjs'

const textLayer = `TONART: D

Verse
D        A
Jesus, meine Hoffnung lebt
Bm       G
Du bist immer bei mir`

const scannedOcrJunk = `~=_<>{}|
BR• R
22 Jesus`

const rich = analyzePdfPageText(textLayer)
if (shouldRunOcr(textLayer)) throw new Error('good PDF text layer should not force OCR')
if (!rich.hasMusic) throw new Error('text layer should detect music')
console.log('OK PDF text-layer preferred (OCR not forced)')

if (!shouldRunOcr(scannedOcrJunk)) throw new Error('scanned PDF junk should trigger OCR fallback')
console.log('OK scanned PDF fallback gate still triggers OCR')

const parsed = parseChordOverLyricsText(textLayer)
const resolved = resolveScanSourceKey({ text: parsed.text, visionKey: '', storedKey: '' })
if (resolved.key !== 'D' && inferKeyFromLeadsheet(parsed.text) !== 'D') {
  throw new Error('source key D not recognized')
}
const toE = transposeEditorText(parsed.text, 'D', 'E')
if (toE === parsed.text) throw new Error('transpose did not change chords')
const back = transposeEditorText(toE, 'E', 'D')
// Round-trip roots should land back near original chord lines
if (!back.split('\n').some((line) => isChordLine(line) && /\bD\b/.test(line))) {
  throw new Error('transpose round-trip lost original root')
}
console.log('OK key stored and transpose from original')

const multi = suggestSongPageIndices([
  { index: 0, score: 80, hasMusic: true },
  { index: 1, score: 75, hasMusic: true },
  { index: 2, score: 10, hasMusic: false },
  { index: 3, score: 70, hasMusic: true },
])
if (multi.includes(2)) throw new Error('non-musical gap page should not be auto-included blindly across gap')
if (!(multi.includes(0) && multi.includes(1))) throw new Error('first song window not selected')
console.log('OK single/multi page selection heuristic')

const imageLike = scoreLeadsheetQuality(`G   D\nJesus lebt\nEm  C\nDu bist da`)
if (imageLike.score < 40) throw new Error('image-path style chord chart quality regressed')
console.log('OK image-path chord/lyric quality still scores well')

// Ensure module graph for server helpers still loads
await import('../lib/chordTextParse.mjs')
console.log('OK import module graph')

console.log('All scan-import-source checks passed')
