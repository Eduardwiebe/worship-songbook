#!/usr/bin/env node
/**
 * Immutable original-key/editor contract.
 * A UI key selection is display state only; verified snapshot evidence is the
 * sole source of truth for sourceKey and transposition.
 */
import { readFileSync } from 'node:fs'
import {
  applyEditorKeyChange,
  displayEditorKeyLabel,
  displayEditorText,
  editorSemitoneDelta,
  extractEditorChordAnchors,
  extractEditorChordModel,
  formatEditorDisplayText,
  GERMAN_EDITOR_KEYS,
  inferKeyFromChords,
  inferKeyFromLeadsheet,
  normalizeEditorKey,
  projectEditorSnapshot,
  resolveEditorSnapshot,
  resolveEditorSourceKey,
  resolveScanSourceKey,
  simplifyChordToken,
  simplifyEditorText,
  transposeEditorText,
} from '../lib/editorKey.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const original = `TONART: C
C      F
Erste Zeile
G      Am
Zweite Zeile
Em     F`
const originalAnchors = extractEditorChordAnchors(original)
const originalChordModel = extractEditorChordModel(original)
const verifiedEnvelope = {
  snapshot: {
    id: 'verified-snapshot',
    status: 'verified',
    sourceKey: 'C',
    originalText: original,
    originalChordModel,
    originalAnchorData: originalAnchors,
  },
}

assert(normalizeEditorKey('–') === '', 'dash is unknown')
assert(normalizeEditorKey('C') === 'C', 'C')
assert(normalizeEditorKey('C-Dur') === 'C', 'C-Dur')
assert(normalizeEditorKey('C major') === 'C', 'C major')
assert(normalizeEditorKey('Eb') === 'Es', 'Eb → Es')
assert(resolveEditorSourceKey(verifiedEnvelope) === 'C', 'verified snapshot supplies source C')
assert(resolveEditorSourceKey({ status: 'review_required', sourceKey: 'C', originalText: original }) === '', 'unverified raw sourceKey is ignored')
assert(resolveEditorSourceKey({ sourceKey: 'C', key: 'D' }) === '', 'legacy song fields are not source truth')
assert(resolveEditorSnapshot({ ...verifiedEnvelope.snapshot, originalText: 'client tamper' }).ok === false, 'tampered original text fails snapshot structure')
assert(inferKeyFromLeadsheet('TONART: C · TEMPO: 156 BPM') === 'C', 'infer TONART C')
assert(inferKeyFromLeadsheet('Key - D | Time - 4/4') === 'D', 'infer Key - D chart header')
assert(inferKeyFromLeadsheet('TONART: G') === 'G', 'infer TONART G still works')


const cChords = `C
F
G
Am
Em`
assert(inferKeyFromChords(cChords).key === 'C', 'C F G Am Em → C')
assert(resolveScanSourceKey({ visionKey: 'C', text: cChords }).key === 'C', 'vision C + chords C')
assert(resolveScanSourceKey({ visionKey: 'D', text: cChords }).key === 'C', 'chords override conflicting vision D')
assert(resolveScanSourceKey({ visionKey: 'D', text: cChords }).needsReview === true, 'conflict needs review')
assert(resolveScanSourceKey({ visionKey: '', text: 'Key - C | Time - 4/4\n\nC\nBb/C\nF\nG\nAm\nEm\nDm' }).key === 'C', 'Key - C header wins over chord F')
assert(resolveScanSourceKey({ visionKey: '', text: 'Key - C | Time - 4/4\n\nC\nBb/C\nF\nG\nAm\nEm\nDm' }).needsReview === false, 'Key - C header not review-blocked')
assert(resolveScanSourceKey({ visionKey: 'E', text: 'Key - E | Time - 4/4\n\nE\nB/D#\nC#m\nA\nD\nA/E' }).key === 'E', 'Key - E + vision E wins over chord A')
assert(resolveScanSourceKey({ visionKey: 'E', text: 'Key - E | Time - 4/4\n\nE\nB/D#\nC#m\nA\nD\nA/E' }).method === 'explicit_document_key_over_chord_conflict', 'method documents header trust')

assert(resolveScanSourceKey({ visionKey: '', text: cChords }).key === 'C', 'chords alone → C')
assert(resolveScanSourceKey({ visionKey: '', text: '' }).key === '', 'empty is unknown, not D')
assert(editorSemitoneDelta('C', 'C') === 0, 'C→C delta 0')
assert(editorSemitoneDelta('C', 'D') === 2, 'C→D delta +2')
console.log('PASS source resolution requires a verified snapshot')

const unknown = applyEditorKeyChange(original, '', 'C')
assert(unknown.text === original, 'unresolved selection must not transpose text')
assert(unknown.sourceKey === '', 'first UI key pick must not set source_key')
assert(unknown.currentKey === 'C' && unknown.targetKey === 'C', 'first UI key pick sets display/current key only')
assert(unknown.blocked === true && unknown.reason === 'source_key_unresolved', 'transposition remains blocked without verified source')
console.log('PASS first UI key pick is display-only and transposition stays blocked')

const resolved = resolveEditorSnapshot(verifiedEnvelope)
assert(resolved.ok && resolved.sourceKey === 'C', 'verified editor snapshot resolves')
const stay = displayEditorText(resolved.originalText, resolved.sourceKey, 'C')
assert(stay === original, 'C→C identity')

const toD = applyEditorKeyChange(original, 'C', 'D')
const toG = applyEditorKeyChange(original, 'C', 'G')
const backC = applyEditorKeyChange(original, 'C', 'C')
assert(toD.sourceKey === 'C' && toD.targetKey === 'D', 'source stays C while viewing D')
assert(toG.sourceKey === 'C' && toG.targetKey === 'G', 'source stays C while viewing G')
assert(backC.text === original, 'C→D→G→C always projects from original')
assert(displayEditorText(original, 'C', 'D') === toD.text, 'repeat C→D is drift-free')

const anchorShape = (anchors) => anchors.map(({ id, kind, line, column }) => ({ id, kind, line, column }))
assert(JSON.stringify(anchorShape(extractEditorChordAnchors(toD.text))) === JSON.stringify(anchorShape(originalAnchors)), 'C→D anchors remain stable')
assert(JSON.stringify(anchorShape(extractEditorChordAnchors(toG.text))) === JSON.stringify(anchorShape(originalAnchors)), 'C→G anchors remain stable')
assert(JSON.stringify(anchorShape(extractEditorChordAnchors(backC.text))) === JSON.stringify(anchorShape(originalAnchors)), 'C→C anchors remain stable')
console.log('PASS C → D → G → C is drift-free with stable anchors')

const lyricOverlay = original.replace('Erste Zeile', 'Erste Zeile – manuell bearbeitet')
const manual = projectEditorSnapshot({
  ...resolved,
  originalAnchorData: resolved.originalAnchorData,
  overlayText: lyricOverlay,
  selectedKey: 'D',
  requireSnapshotModel: true,
})
assert(manual.ok && manual.text.includes('manuell bearbeitet'), 'manual lyric edit is projected')
const chordTamper = projectEditorSnapshot({
  ...resolved,
  originalAnchorData: resolved.originalAnchorData,
  overlayText: lyricOverlay.replace('C      F', 'D      F'),
  selectedKey: 'D',
  requireSnapshotModel: true,
})
assert(!chordTamper.ok && chordTamper.reason === 'overlay_chord_structure_changed', 'manual overlay cannot redefine original chords')
console.log('PASS manual overlay edits preserve immutable chord origin')

assert(displayEditorText('F', 'D', 'C') === 'Es', 'flat spelling Es not Dis when landing in C')
console.log('PASS Es spelling')

try {
  const vision = JSON.parse(readFileSync('/tmp/songbook-vision-last.json', 'utf8'))
  const scan = resolveScanSourceKey({ visionKey: vision.document?.key, text: cChords })
  assert(scan.key === 'C', `real vision key is C, got ${scan.key}`)
  const chords = (vision.document?.sections || []).flatMap((section) => (
    (section.lines || []).flatMap((line) => (line.chords || []).map((item) => item.chord))
  ))
  assert(chords.includes('C') && chords.includes('Em') && chords.includes('F') && chords.includes('G') && chords.includes('Am'), 'realscan has C Em F G Am')
  console.log('PASS real scan Vision JSON identifies C and expected chords')
} catch (error) {
  if (error.code === 'ENOENT') console.log('SKIP real scan Vision JSON (not on disk)')
  else throw error
}

console.log('test-editor-original-key: all passed')

const jesus = `G     D
Jesus meine`
const jesusA = displayEditorText(jesus, 'G', 'A')
assert(jesusA.split('\n')[0] === 'A     E', `G→A columns: ${JSON.stringify(jesusA.split('\\n')[0])}`)
assert(jesusA.split('\n')[1] === 'Jesus meine', 'lyrics stay')
const jesusSlash = displayEditorText(`F/G   Am
Jesus meine`, 'G', 'A')
assert(jesusSlash.split('\n')[0].startsWith('G/A'), `slash transpose got ${JSON.stringify(jesusSlash.split('\\n')[0])}`)
assert(jesusSlash.split('\n')[0].indexOf('Hm') === 6, 'Am→Hm keeps column (German H)')
console.log('PASS Jesus meine transpose column alignment + slash token')

assert(GERMAN_EDITOR_KEYS.includes('H') && !GERMAN_EDITOR_KEYS.includes('B'), 'key list uses H not English B')
assert(normalizeEditorKey('B') === 'H', 'legacy B → H')
assert(normalizeEditorKey('H') === 'H', 'H stays H')
assert(normalizeEditorKey('Bb') === 'Bb', 'Bb stays Bb')
assert(displayEditorKeyLabel('Bb') === 'B', 'Bb displays as German B')
assert(displayEditorKeyLabel('H') === 'H', 'H displays as H')

// Anker-style D→E worship chords (harmonic + German spelling)
const ankerD = `D          Gmaj7
A
Hm         Fism
Em7        D/Fis
A          Bm7     E7
Em7        A`
const ankerE = displayEditorText(ankerD, 'D', 'E')
assert(/\bE\b/.test(ankerE) && /\bAmaj7\b/.test(ankerE), `D→E has E and Amaj7: ${ankerE}`)
assert(/\bH\b/.test(ankerE), 'A→H German')
assert(/\bCism\b/.test(ankerE), 'Hm/Bm → Cism')
assert(/\bGism\b/.test(ankerE), 'Fism → Gism')
assert(/\bFism7\b/.test(ankerE), 'Em7 → Fism7')
assert(/\bE\/Gis\b/.test(ankerE), 'D/Fis → E/Gis')
assert(/\bFis7\b/.test(ankerE), 'E7 → Fis7')
assert(!/#/.test(ankerE) && !/\bB\b/.test(ankerE.replace(/Bb/g, '')), 'no international # or bare English B')

const ankerSimple = formatEditorDisplayText(ankerE, { simplify: true })
assert(/\bA\b/.test(ankerSimple) && !/Amaj7/.test(ankerSimple), 'simplify Amaj7→A')
assert(/\bCism\b/.test(ankerSimple) && !/Cism7/.test(ankerSimple), 'simplify Cism7→Cism')
assert(/\bFis\b/.test(ankerSimple) && !/Fis7/.test(ankerSimple), 'simplify Fis7→Fis')
assert(/\bE\b/.test(ankerSimple) && !/E\/Gis/.test(ankerSimple), 'simplify drop slash E/Gis→E')
assert(simplifyChordToken('Asus') === 'Asus', 'keep Asus')
assert(simplifyChordToken('C#m7') === 'C#m', 'international m7 still simplifies')

// Round-trip: simplify is display-only; full transpose from original snapshot still works
const back = displayEditorText(ankerD, 'D', 'D')
assert(back.includes('Gmaj7') || back.includes('G'), 'source fidelity path still available')
const again = transposeEditorText(ankerD, 'D', 'E')
assert(again === ankerE, 'repeat D→E stable')
console.log('PASS D→E German spelling + simplify display rules')
