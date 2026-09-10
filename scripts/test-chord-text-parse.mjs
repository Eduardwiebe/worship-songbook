#!/usr/bin/env node
import {
  parseChordOverLyricsText,
  suggestSongPageIndices,
  analyzePdfPageText,
  isSectionHeader,
} from '../lib/chordTextParse.mjs'
import {
  inferKeyFromLeadsheet,
  transposeEditorText,
  normalizeEditorKey,
} from '../lib/editorKey.mjs'
import { isChordLine } from '../lib/leadsheetAnalysis.mjs'

const sample = `Jesus, meine Hoffnung lebt
TONART: G

Verse 1
G        D
Jesus, meine Hoffnung lebt
Em       C
Du bist immer bei mir

Chorus
C        G
Ich will dich loben
D        Em
Heute und immerdar`

const parsed = parseChordOverLyricsText(sample, { injectTonart: true })
if (!parsed.text.includes('Jesus, meine Hoffnung lebt')) throw new Error('lyrics missing')
if (!parsed.text.split('\n').some(isChordLine)) throw new Error('chord lines missing')
if (!parsed.sections.includes('Verse 1') || !parsed.sections.includes('Chorus')) throw new Error('sections missing')
if (parsed.key !== 'G') throw new Error(`expected key G, got ${parsed.key}`)
if (inferKeyFromLeadsheet(parsed.text) !== 'G') throw new Error('TONART not stored in text')
console.log('OK text chord parsing + sections + key')

const spaced = parseChordOverLyricsText(`G        D\nJesus, meine Hoffnung lebt\nEm       C\nDu bist immer bei mir`)
const chordLine = spaced.text.split('\n').find(isChordLine)
if (!chordLine || !/\s{2,}/.test(chordLine)) throw new Error('chord positions not preserved')
console.log('OK chord column spacing preserved')

if (!isSectionHeader('Bridge') || !isSectionHeader('[Intro]') || !isSectionHeader('Strophe 2:')) {
  throw new Error('section header detection failed')
}
console.log('OK section headers')

const transposed = transposeEditorText(parsed.text, 'G', 'A')
if (!transposed.split('\n').some((line) => isChordLine(line) && /\bA\b/.test(line))) {
  throw new Error('transpose from original key failed')
}
if (normalizeEditorKey(inferKeyFromLeadsheet(parsed.text)) !== 'G') {
  throw new Error('transpose must leave original snapshot key as G')
}
console.log('OK transpose from original key G -> A')

const uncertain = parseChordOverLyricsText('Nur ein Text ohne Akkorde und ohne Tonart')
if (uncertain.key) throw new Error('uncertain text must not invent a key')
console.log('OK uncertain key stays empty')

const pages = suggestSongPageIndices([
  { index: 0, score: 5, hasMusic: false },
  { index: 1, score: 70, hasMusic: true },
  { index: 2, score: 65, hasMusic: true },
  { index: 3, score: 8, hasMusic: false },
])
if (JSON.stringify(pages) !== JSON.stringify([1, 2])) {
  throw new Error(`expected suggested pages [1,2], got ${JSON.stringify(pages)}`)
}
console.log('OK multi-page suggestion does not dump whole PDF')

const blankBook = suggestSongPageIndices([
  { index: 0, score: 0, hasMusic: false },
  { index: 1, score: 0, hasMusic: false },
])
if (JSON.stringify(blankBook) !== JSON.stringify([0])) throw new Error('blank PDF should fall back to first page only')
console.log('OK blank multi-page fallback is first page only')

const pageAnalysis = analyzePdfPageText(sample)
if (!pageAnalysis.hasMusic || pageAnalysis.score < 40) throw new Error('PDF page text analysis weak')
console.log('OK PDF text-layer page analysis')

console.log('All chord-text/PDF import unit checks passed')

const leading = parseChordOverLyricsText(`  G     D
Jesus meine`)
const leadChord = leading.text.split('\n').find(isChordLine)
if (!leadChord || leadChord.indexOf('G') !== 0 && leadChord.indexOf('G') !== 2) {
  // After soft format over "Jesus meine", G should be at 0
}
if (!leading.text.includes('Jesus meine')) throw new Error('leading sample lost lyrics')
const leadPacked = leading.text.split('\n')
const gLine = leadPacked.find(isChordLine)
if (!gLine || gLine.indexOf('G') !== 0 || gLine.indexOf('D') !== 6) {
  throw new Error(`expected G at 0 and D at 6, got ${JSON.stringify(gLine)} in\n${leading.text}`)
}
console.log('OK leading chord spaces align to Jesus meine')
