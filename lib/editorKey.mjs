/**
 * Editor source-key resolution and chord transposition.
 * Scanned leadsheets must keep the recognized original key; never default to D.
 */

export const GERMAN_EDITOR_KEYS = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'Bb', 'B']

export const editorPitchMap = {
  C: 0, Cis: 1, 'C#': 1, Des: 1, Db: 1,
  D: 2, Dis: 3, 'D#': 3, Es: 3, Eb: 3,
  E: 4, F: 5, Fis: 6, 'F#': 6, Ges: 6, Gb: 6,
  G: 7, Gis: 8, 'G#': 8, As: 8, Ab: 8,
  A: 9, Ais: 10, 'A#': 10, Bb: 10, B: 11, H: 11,
}

const editorSharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const editorFlatNames = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'Bb', 'B']
const KEY_ALIASES = {
  'C#': 'Cis', CIS: 'Cis',
  Db: 'Des', DES: 'Des',
  'D#': 'Dis', DIS: 'Dis',
  Eb: 'Es', ES: 'Es',
  'F#': 'Fis', FIS: 'Fis',
  Gb: 'Ges', GES: 'Ges',
  'G#': 'Gis', GIS: 'Gis',
  Ab: 'As', AS: 'As',
  'A#': 'Ais', AIS: 'Ais',
  H: 'B',
}

export const editorChordPattern = /(?<![\p{L}\d])(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°-]\d*)*(?:\/(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)(?![\p{L}\d])/gu

export function editorChordTokens(line) {
  return [...String(line || '').matchAll(new RegExp(editorChordPattern.source, 'gu'))]
}

export function isEditorChordLine(line) {
  const matches = editorChordTokens(line)
  if (!matches.length) return false
  return line.replace(new RegExp(editorChordPattern.source, 'gu'), '').replace(/[\s|,:()[\]{}-]/g, '').length === 0
}

export function normalizeEditorKey(raw) {
  const text = String(raw || '').trim()
  if (!text || text === '–' || text === '-' || text === '?' || text === 'unknown') return ''
  const token = text
    .replace(/[-–]?\s*(dur|moll|major|minor|maj|min)\b/ig, '')
    .replace(/[.\s]+/g, '')
    .trim()
  if (!token) return ''
  const mapped = KEY_ALIASES[token] || KEY_ALIASES[token.toUpperCase()] || token
  return GERMAN_EDITOR_KEYS.includes(mapped) ? mapped : ''
}

/**
 * Original/source key only. Never song.key / song_key — that field is the
 * preferred/display key after a later transpose and must not become the source.
 * Never defaults to D.
 */
export function resolveEditorSourceKey(song = {}, analysisKey = '') {
  return normalizeEditorKey(song.sourceKey)
    || normalizeEditorKey(song.originalKey)
    || normalizeEditorKey(analysisKey)
}

export function inferKeyFromLeadsheet(text) {
  const match = String(text || '').match(
    /(?:TONART|Tonart|KEY|Key)\s*[:·]\s*(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])(?:\s|-)?(?:dur|moll|major|minor)?/i,
  )
  return match ? normalizeEditorKey(match[1]) : ''
}

const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11]

export function extractEditorChordRoots(text) {
  const roots = []
  for (const line of String(text || '').split('\n')) {
    if (!isEditorChordLine(line)) continue
    for (const match of editorChordTokens(line)) roots.push(match[1])
  }
  return roots
}

/**
 * Diatonic plausibility over recognized chord roots. Returns '' unless I and
 * (IV or V) are present and most roots fit one major key. Never defaults to D.
 */
export function inferKeyFromChords(text) {
  const roots = extractEditorChordRoots(text)
  const counts = new Map()
  for (const root of roots) {
    const pitch = editorPitchMap[root]
    if (pitch === undefined) continue
    counts.set(pitch, (counts.get(pitch) || 0) + 1)
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  if (total < 3) return { key: '', confidence: 0, total }

  let best = null
  for (const key of GERMAN_EDITOR_KEYS) {
    const tonic = editorPitchMap[key]
    const scale = new Set(MAJOR_SCALE_STEPS.map((step) => (tonic + step) % 12))
    let diatonic = 0
    for (const [pitch, count] of counts) {
      if (scale.has(pitch)) diatonic += count
    }
    const hasI = counts.get(tonic) || 0
    const hasIV = counts.get((tonic + 5) % 12) || 0
    const hasV = counts.get((tonic + 7) % 12) || 0
    const score = (diatonic / total) * 10 + (hasI ? 3 : 0) + (hasIV ? 1.5 : 0) + (hasV ? 2 : 0)
    const candidate = { key, score, diatonic, hasI, hasIV, hasV }
    if (!best || candidate.score > best.score) best = candidate
  }

  const ratio = best.diatonic / total
  const confident = ratio >= 0.75 && best.hasI && (best.hasIV || best.hasV)
  return {
    key: confident ? best.key : '',
    confidence: Number(ratio.toFixed(3)),
    total,
    best: best.key,
  }
}

export function editorSemitoneDelta(sourceKey, targetKey) {
  const source = normalizeEditorKey(sourceKey)
  const target = normalizeEditorKey(targetKey)
  if (!source || !target) return null
  return editorPitchMap[target] - editorPitchMap[source]
}

/**
 * Scan original key from stacked evidence. Never D unless evidence says D.
 * Vision/TONART win when they agree with chords; chord material wins on conflict.
 */
export function resolveScanSourceKey({ visionKey = '', text = '', storedKey = '' } = {}) {
  const vision = normalizeEditorKey(visionKey)
  const tonart = inferKeyFromLeadsheet(text)
  const chords = inferKeyFromChords(text)
  const stored = normalizeEditorKey(storedKey)
  const explicit = vision || tonart
  if (explicit && chords.key && explicit !== chords.key) {
    return {
      key: chords.key,
      source: 'chords',
      needsReview: true,
      visionKey: vision,
      tonartKey: tonart,
      chordKey: chords.key,
    }
  }
  if (vision) {
    return { key: vision, source: 'vision', needsReview: false, visionKey: vision, tonartKey: tonart, chordKey: chords.key }
  }
  if (tonart) {
    return { key: tonart, source: 'tonart', needsReview: false, visionKey: vision, tonartKey: tonart, chordKey: chords.key }
  }
  if (chords.key) {
    return { key: chords.key, source: 'chords', needsReview: false, visionKey: vision, tonartKey: tonart, chordKey: chords.key }
  }
  if (stored) {
    return { key: stored, source: 'stored', needsReview: true, visionKey: vision, tonartKey: tonart, chordKey: chords.key }
  }
  return { key: '', source: 'unknown', needsReview: true, visionKey: vision, tonartKey: tonart, chordKey: '' }
}

/** Always original chords + (source → selected). Never re-transpose the current view. */
export function displayEditorText(originalText, sourceKey, targetKey) {
  const source = normalizeEditorKey(sourceKey)
  const target = normalizeEditorKey(targetKey)
  if (!source || !target || source === target) return originalText
  return transposeEditorText(originalText, source, target)
}

export function editorPitchName(idx, targetKey) {
  const useFlat = ['F', 'Bb', 'Es', 'As', 'Des', 'Ges'].includes(targetKey)
  if (idx === 10 && (useFlat || ['C', 'G', 'D'].includes(targetKey))) return 'Bb'
  if (idx === 3 && (useFlat || targetKey === 'C')) return 'Es'
  return (useFlat ? editorFlatNames : editorSharpNames)[idx]
}

export function transposeEditorText(text, fromKey, toKey) {
  const source = normalizeEditorKey(fromKey)
  const target = normalizeEditorKey(toKey)
  if (!source || !target || source === target) return text
  const shift = editorPitchMap[target] - editorPitchMap[source]
  if (!shift) return text
  return String(text || '').split('\n').map((line) => (
    isEditorChordLine(line)
      ? line.replace(editorChordPattern, (full, note, suffix) => {
        const slash = suffix.match(/\/(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/)
        const root = (value) => editorPitchName((editorPitchMap[value] + shift + 120) % 12, target)
        return root(note) + (slash ? `${suffix.slice(0, -slash[0].length)}/${root(slash[1])}` : suffix)
      })
      : line
  )).join('\n')
}

/**
 * Select a display key. If the original is unknown, the first real pick only
 * declares sourceKey — chords stay untouched.
 */
export function applyEditorKeyChange(originalText, sourceKey, nextKey) {
  const next = normalizeEditorKey(nextKey)
  const source = normalizeEditorKey(sourceKey)
  if (!next) {
    return { text: originalText, sourceKey: source, currentKey: source, targetKey: '' }
  }
  if (!source) {
    return { text: originalText, sourceKey: next, currentKey: next, targetKey: next }
  }
  return {
    text: displayEditorText(originalText, source, next),
    sourceKey: source,
    currentKey: next,
    targetKey: next,
  }
}
