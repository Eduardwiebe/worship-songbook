#!/usr/bin/env node
/**
 * Scan/editor original-key path. Synthetic + real-scan chords only.
 * Does not call Vision or commit private lyrics as fixtures in git.
 */
import { readFileSync } from 'node:fs'
import {
  applyEditorKeyChange,
  normalizeEditorKey,
  resolveEditorSourceKey,
  transposeEditorText,
} from '../lib/editorKey.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(normalizeEditorKey('–') === '', 'dash is unknown')
assert(normalizeEditorKey('C') === 'C', 'C')
assert(normalizeEditorKey('C-Dur') === 'C', 'C-Dur')
assert(normalizeEditorKey('C major') === 'C', 'C major')
assert(normalizeEditorKey('Eb') === 'Es', 'Eb → Es')
assert(resolveEditorSourceKey({ sourceKey: '', key: '–' }) === '', 'scan default is not D')
assert(resolveEditorSourceKey({ sourceKey: '', key: '–' }, 'C') === 'C', 'vision C wins')
assert(resolveEditorSourceKey({ sourceKey: 'C', key: 'D' }, 'G') === 'C', 'stored original wins over preferred D')
assert(resolveEditorSourceKey({ sourceKey: '', key: '–' }, 'D') === 'D', 'D only if recognized')
console.log('OK key resolution (no hardcoded D)')

const original = `C
E
Em
F
G
Am`
const scanSong = { sourceKey: '', key: '–' }
const source = resolveEditorSourceKey(scanSong, 'C')
assert(source === 'C', 'scan source is C')
const stay = transposeEditorText(original, source, 'C')
assert(stay === original, 'C→C identity')
assert(/\bC\b/.test(stay) && /\bEm\b/.test(stay) && /\bF\b/.test(stay) && /\bG\b/.test(stay) && /\bAm\b/.test(stay), 'original chords kept')
assert(!/\bBb\b/.test(stay) && !/\bDm\b/.test(stay) && !/\bGm\b/.test(stay), 'no D→C drift')
console.log('OK C→C keeps original chords')

const toD = applyEditorKeyChange(original, source, source, 'D')
assert(toD.sourceKey === 'C' && toD.currentKey === 'D', 'source stays C while viewing D')
assert(toD.text === 'D\nFis\nFism\nG\nA\nBm', `C→D +2:\n${toD.text}`)
const back = applyEditorKeyChange(toD.text, toD.currentKey, toD.sourceKey, 'C')
assert(back.text === original, `C→D→C roundtrip:\n${back.text}`)
console.log('OK C→D→C no drift')

const unknown = applyEditorKeyChange(original, '', '', 'C')
assert(unknown.text === original && unknown.sourceKey === 'C', 'unknown key: first pick declares source, no transpose')
console.log('OK unknown key is not D')

assert(transposeEditorText('F', 'D', 'C') === 'Es', 'flat spelling Es not Dis when landing in C')
console.log('OK Es spelling')

let realText = original
try {
  const vision = JSON.parse(readFileSync('/tmp/songbook-vision-last.json', 'utf8'))
  const key = resolveEditorSourceKey({ sourceKey: '', key: '–' }, vision.document?.key)
  assert(key === 'C', `real vision key is C, got ${key}`)
  const chords = (vision.document?.sections || []).flatMap((section) => (
    (section.lines || []).flatMap((line) => (line.chords || []).map((item) => item.chord))
  ))
  assert(chords.includes('C') && chords.includes('Em') && chords.includes('F') && chords.includes('G') && chords.includes('Am'), 'realscan has C Em F G Am')
  realText = chords.join('\n')
  const again = transposeEditorText(transposeEditorText(realText, 'C', 'D'), 'D', 'C')
  assert(again === realText, 'realscan chord list C→D→C')
  console.log('OK realscan vision JSON C / C→D→C')
} catch (error) {
  if (error.code === 'ENOENT') console.log('SKIP realscan json (not on disk)')
  else throw error
}

console.log('test-editor-original-key: all passed')
