#!/usr/bin/env node
/**
 * Scan/editor original-key path. Synthetic + real-scan chords only.
 * Does not call Vision or commit private lyrics as fixtures in git.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  applyEditorKeyChange,
  displayEditorText,
  editorSemitoneDelta,
  inferKeyFromChords,
  inferKeyFromLeadsheet,
  normalizeEditorKey,
  resolveEditorSourceKey,
  resolveScanSourceKey,
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
assert(resolveEditorSourceKey({ sourceKey: '', key: 'D' }, 'C') === 'C', 'song.key D is not the source')
assert(resolveEditorSourceKey({ sourceKey: '', key: '–' }, 'C') === 'C', 'vision C wins')
assert(resolveEditorSourceKey({ sourceKey: 'C', key: 'D' }, 'G') === 'C', 'stored original wins over preferred D')
assert(inferKeyFromLeadsheet('TONART: C · TEMPO: 156 BPM') === 'C', 'infer TONART C')
const cChords = `C
F
G
Am
Em`
assert(inferKeyFromChords(cChords).key === 'C', 'C F G Am Em → C')
assert(resolveScanSourceKey({ visionKey: 'C', text: cChords }).key === 'C', 'vision C + chords C')
assert(resolveScanSourceKey({ visionKey: 'D', text: cChords }).key === 'C', 'chords override conflicting vision D')
assert(resolveScanSourceKey({ visionKey: 'D', text: cChords }).needsReview === true, 'conflict needs review')
assert(resolveScanSourceKey({ visionKey: '', text: cChords }).key === 'C', 'chords alone → C')
assert(resolveScanSourceKey({ visionKey: '', text: '' }).key === '', 'empty is unknown, not D')
assert(editorSemitoneDelta('C', 'C') === 0, 'C→C delta 0')
assert(editorSemitoneDelta('C', 'D') === 2, 'C→D delta +2')
console.log('OK key resolution (no hardcoded D, song.key ignored)')

const original = `C
F
G
Am
Em`
const scanSong = { sourceKey: '', key: '–' }
const source = resolveEditorSourceKey(scanSong, 'C')
assert(source === 'C', 'scan source is C')
const stay = displayEditorText(original, source, 'C')
assert(stay === original, 'C→C identity')
assert(/\bC\b/.test(stay) && /\bF\b/.test(stay) && /\bG\b/.test(stay) && /\bAm\b/.test(stay) && /\bEm\b/.test(stay), 'original chords kept')
assert(!/\bBb\b/.test(stay) && !/\bDm\b/.test(stay) && !/\bGm\b/.test(stay) && !/\bDis\b/.test(stay), 'no D→C drift')
console.log('OK C→C keeps original chords')

const toD = applyEditorKeyChange(original, source, 'D')
assert(toD.sourceKey === 'C' && toD.targetKey === 'D', 'source stays C while viewing D')
assert(toD.text === 'D\nG\nA\nBm\nF#m', `C→D +2:\n${toD.text}`)
const back = applyEditorKeyChange(original, toD.sourceKey, 'C')
assert(back.text === original, `C→D→C from original:\n${back.text}`)
const againD = applyEditorKeyChange(original, back.sourceKey, 'D')
assert(againD.text === toD.text, 'second C→D matches first (no cumulative drift)')
console.log('OK C→D→C no drift')

const unknown = applyEditorKeyChange(original, '', 'C')
assert(unknown.text === original && unknown.sourceKey === 'C', 'unknown key: first pick declares source, no transpose')
console.log('OK unknown key is not D')

assert(displayEditorText('F', 'D', 'C') === 'Es', 'flat spelling Es not Dis when landing in C')
console.log('OK Es spelling')

try {
  const vision = JSON.parse(readFileSync('/tmp/songbook-vision-last.json', 'utf8'))
  const key = resolveEditorSourceKey({ sourceKey: '', key: '–' }, vision.document?.key)
  assert(key === 'C', `real vision key is C, got ${key}`)
  const chords = (vision.document?.sections || []).flatMap((section) => (
    (section.lines || []).flatMap((line) => (line.chords || []).map((item) => item.chord))
  ))
  assert(chords.includes('C') && chords.includes('Em') && chords.includes('F') && chords.includes('G') && chords.includes('Am'), 'realscan has C Em F G Am')
  const realText = ['C', 'F', 'G', 'Am', 'Em'].join('\n')
  const outD = displayEditorText(realText, 'C', 'D')
  const outC = displayEditorText(realText, 'C', 'C')
  const backC = displayEditorText(realText, 'C', 'C')
  assert(outC === realText, 'realscan C→C')
  assert(outD === 'D\nG\nA\nBm\nF#m', `realscan C→D: ${outD}`)
  assert(backC === realText, 'realscan D→C via original')
  console.log('OK realscan vision JSON C / C→D→C')
} catch (error) {
  if (error.code === 'ENOENT') console.log('SKIP realscan json (not on disk)')
  else throw error
}

try {
  const db = new DatabaseSync('/var/www/songbook/data/songbook.sqlite', { readOnly: true })
  const rows = db.prepare('SELECT title, source_key, song_key FROM songs').all()
  const withC = rows.filter((row) => row.source_key === 'C')
  console.log(`OK live DB songs=${rows.length} source_key=C count=${withC.length}`)
  for (const row of withC) {
    assert(resolveEditorSourceKey({ sourceKey: row.source_key, key: row.song_key }) === 'C', `${row.title} reload source stays C`)
  }
  db.close()
} catch (error) {
  if (String(error.message || '').includes('unable to open')) console.log('SKIP live DB')
  else throw error
}

console.log('test-editor-original-key: all passed')
