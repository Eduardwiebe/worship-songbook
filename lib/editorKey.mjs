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

const editorSharpNames = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'B']
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

/** Stored original key first, then recognized analysis key. Never D unless it was actually recognized/stored. */
export function resolveEditorSourceKey(song = {}, analysisKey = '') {
  return normalizeEditorKey(song.sourceKey)
    || normalizeEditorKey(analysisKey)
    || normalizeEditorKey(song.key)
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

/** First chosen key declares the original when it was unknown — no transpose. */
export function applyEditorKeyChange(text, currentKey, sourceKey, nextKey) {
  const next = normalizeEditorKey(nextKey)
  if (!next) {
    return { text, sourceKey: normalizeEditorKey(sourceKey), currentKey: normalizeEditorKey(currentKey), targetKey: '' }
  }
  if (!normalizeEditorKey(sourceKey) || !normalizeEditorKey(currentKey)) {
    return { text, sourceKey: next, currentKey: next, targetKey: next }
  }
  return {
    text: transposeEditorText(text, currentKey, next),
    sourceKey: normalizeEditorKey(sourceKey),
    currentKey: next,
    targetKey: next,
  }
}
