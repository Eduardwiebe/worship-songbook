#!/usr/bin/env node
/**
 * Unit tests for geometric leadsheet reconstruction + chord validation.
 */
import {
  isValidChordToken,
  placeChordsAboveLyric,
  reconstructLeadsheet,
} from '../lib/leadsheetReconstruct.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Chord validation
assert(isValidChordToken('C'), 'C valid')
assert(isValidChordToken('F#m'), 'F#m valid')
assert(isValidChordToken('D/F#'), 'D/F# valid')
assert(isValidChordToken('Asus2'), 'Asus2 valid')
assert(isValidChordToken('Eb/G'), 'Eb/G valid')
assert(isValidChordToken('Cmaj7'), 'Cmaj7 valid')
assert(!isValidChordToken('SSS'), 'SSS invalid')
assert(!isValidChordToken('ce'), 'ce invalid')
assert(!isValidChordToken('ow'), 'ow invalid')
assert(!isValidChordToken('66'), '66 invalid')
assert(!isValidChordToken('<3'), '<3 invalid')
console.log('OK chord validation')

// Geometric placement
const lyricLine = {
  tokens: [
    { text: 'Jesus,', bbox: [80, 190, 180, 220], confidence: 0.99, line_index: 1 },
    { text: 'Herr,', bbox: [190, 190, 270, 220], confidence: 0.99, line_index: 1 },
    { text: 'ich', bbox: [280, 190, 320, 220], confidence: 0.99, line_index: 1 },
    { text: 'denke', bbox: [330, 190, 420, 220], confidence: 0.99, line_index: 1 },
  ],
}
const chords = [
  { text: 'E', bbox: [80, 140, 100, 170], confidence: 0.99, line_index: 0 },
  { text: 'A', bbox: [190, 140, 210, 170], confidence: 0.99, line_index: 0 },
  { text: 'E', bbox: [330, 140, 350, 170], confidence: 0.99, line_index: 0 },
]
const placed = placeChordsAboveLyric(chords, lyricLine, 'Jesus, Herr, ich denke')
assert(placed.chordLine.includes('E'), 'placed has E')
assert(placed.chordLine.includes('A'), 'placed has A')
assert(placed.lyricLine.includes('Jesus'), 'lyric preserved')
console.log('OK geometric placement')

// Full reconstruct from RapidOCR-like tokens
const structured = {
  engine: 'rapidocr',
  elapsed_ms: 900,
  pages: [{
    page_index: 0,
    width: 1200,
    height: 1600,
    tokens: [
      { text: 'Amazing Grace', bbox: [80, 60, 420, 100], confidence: 0.97, line_index: 0 },
      { text: 'E', bbox: [80, 140, 100, 170], confidence: 0.99, line_index: 1 },
      { text: 'A', bbox: [190, 140, 210, 170], confidence: 0.99, line_index: 1 },
      { text: 'E', bbox: [300, 140, 320, 170], confidence: 0.99, line_index: 1 },
      { text: 'Jesus,', bbox: [80, 190, 160, 220], confidence: 0.99, line_index: 2 },
      { text: 'Herr,', bbox: [170, 190, 250, 220], confidence: 0.99, line_index: 2 },
      { text: 'ich', bbox: [260, 190, 300, 220], confidence: 0.99, line_index: 2 },
      { text: 'denke', bbox: [310, 190, 400, 220], confidence: 0.99, line_index: 2 },
      { text: 'an', bbox: [410, 190, 450, 220], confidence: 0.99, line_index: 2 },
      { text: 'dein', bbox: [460, 190, 520, 220], confidence: 0.99, line_index: 2 },
      { text: 'Opfer', bbox: [530, 190, 620, 220], confidence: 0.99, line_index: 2 },
      { text: '♪', bbox: [80, 400, 100, 420], confidence: 0.4, line_index: 3 },
      { text: 'SSS', bbox: [120, 400, 180, 420], confidence: 0.3, line_index: 3 },
    ],
  }],
}

const result = reconstructLeadsheet(structured, { titleHint: 'Amazing Grace' })
assert(result.text.includes('Jesus'), 'reconstruct has lyrics')
assert(result.text.includes('E'), 'reconstruct has chords')
assert(!result.text.includes('SSS'), 'music junk filtered')
assert(!result.text.includes('♪'), 'notation filtered')
assert(result.engine === 'rapidocr', 'engine recorded')
console.log('OK reconstruct leadsheet')

// Syllable joining
const syllabic = {
  engine: 'rapidocr',
  pages: [{
    page_index: 0,
    width: 800,
    height: 600,
    tokens: [
      { text: 'Je-', bbox: [80, 100, 120, 130], confidence: 0.9, line_index: 0 },
      { text: 'sus', bbox: [125, 100, 180, 130], confidence: 0.9, line_index: 0 },
      { text: 'den-', bbox: [200, 100, 250, 130], confidence: 0.9, line_index: 0 },
      { text: 'ke', bbox: [255, 100, 290, 130], confidence: 0.9, line_index: 0 },
    ],
  }],
}
const joined = reconstructLeadsheet(syllabic)
assert(/Jesus/i.test(joined.text), `syllables joined, got: ${joined.text}`)
assert(/denke/i.test(joined.text), `denke joined, got: ${joined.text}`)
console.log('OK syllable joining')

console.log('test-leadsheet-reconstruct: all passed')
