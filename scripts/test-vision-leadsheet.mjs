#!/usr/bin/env node
/**
 * Vision leadsheet schema, editor rendering, OMR validation, transposition.
 * Synthetic lyrics only — no copyrighted fixtures.
 */
import { chordPattern, isChordLine, pitchMap } from '../lib/leadsheetAnalysis.mjs'
import {
  leadsheetFromVision,
  normalizeVisionDocument,
  validateVisionWithOmr,
  visionResultToApi,
} from '../lib/visionLeadsheet.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const document = normalizeVisionDocument({
  title: 'Morgenlicht',
  key: 'C',
  confidence: 0.9,
  needsReview: false,
  sections: [
    {
      type: 'verse',
      number: 1,
      lines: [{
        lyrics: 'Alpha beta gamma, delta epsilon.',
        chords: [{ chord: 'C', index: 0 }, { chord: 'F/C', index: 12 }, { chord: 'G/B', index: 20 }],
      }],
    },
    {
      type: 'verse',
      number: 2,
      lines: [{ lyrics: 'Zeta eta theta, iota kappa.', chords: [{ chord: 'Em', index: 0 }] }],
    },
    {
      type: 'chorus',
      lines: [{
        lyrics: 'Wir singen heut von Frieden und Geduld.',
        chords: [{ chord: 'Am', index: 0 }, { chord: 'D/F#', index: 16 }, { chord: 'Bb/D', index: 28 }],
      }],
    },
  ],
})

const text = leadsheetFromVision(document)
assert(/Morgenlicht/.test(text), 'title')
assert(/\[Strophe 1\]/.test(text) && /\[Strophe 2\]/.test(text) && /\[Refrain\]/.test(text), 'sections')
assert(text.indexOf('[Strophe 1]') < text.indexOf('[Strophe 2]'), 'verse order')
assert(/Alpha beta/.test(text) && !/Zeta eta[\s\S]*\[Strophe 1\]/.test(text), 'verses not mixed')
assert(/F\/C/.test(text) && /G\/B/.test(text) && /D\/F#/.test(text) && /Bb\/D/.test(text), 'slash chords')
assert(!/LOB|62|156|Verlag/.test(text), 'no page chrome')
assert(!/Alphabeta/.test(text), 'spaces kept')
console.log('OK vision render')

const dropped = normalizeVisionDocument({
  sections: [{ type: 'verse', number: 1, lines: [{ lyrics: 'Alpha beta.', chords: [{ chord: 'SSS', index: 0 }, { chord: 'C', index: 0 }] }] }],
})
assert(dropped.sections[0].lines[0].chords.length === 1, 'invalid chord dropped')
assert(dropped.needsReview, 'invalid chord flags review')
console.log('OK invalid chords')

const validated = validateVisionWithOmr(document, {
  pages: [{
    tokens: [
      { text: 'F', bbox: [100, 40, 130, 70], source: 'audiveris-chord' },
      { text: 'C', bbox: [102, 80, 132, 110], source: 'audiveris-chord' },
      { text: 'Alpha beta gamma, delta epsilon.', bbox: [80, 200, 500, 240], source: 'rapidocr-fill' },
    ],
  }],
})
assert(validated.sections[0].lines[0].chords.some((item) => item.chord === 'F/C'), 'OMR stacked slash upgrades F')
assert(validated.validation.matchedLines >= 1, 'OCR lyric agree')
console.log('OK OMR/OCR validation')

const api = visionResultToApi(document)
assert(api.method.startsWith('Vision/'), 'api method')
assert(api.text === text, 'api text is vision render, not OCR refine')

const shift = pitchMap.D - pitchMap.C
const transposeRoot = (root) => {
  const names = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
  return names[(pitchMap[root] + shift + 120) % 12]
}
const transposed = api.text.split('\n').map((line) => (
  isChordLine(line)
    ? line.replace(chordPattern, (full, root, suffix) => {
      const slash = suffix.match(/\/(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/)
      let next = suffix
      if (slash) next = `${suffix.slice(0, -slash[0].length)}/${transposeRoot(slash[1])}`
      return transposeRoot(root) + next
    })
    : line
)).join('\n')
assert(/G\/D/.test(transposed), `transpose F/C -> G/D: ${transposed}`)
assert(/A\/C#/.test(transposed) || /A\/Db/.test(transposed), 'transpose G/B')
assert(/Alpha beta/.test(transposed), 'lyrics unchanged by transpose')
console.log('OK transposition')

console.log('test-vision-leadsheet: all passed')
