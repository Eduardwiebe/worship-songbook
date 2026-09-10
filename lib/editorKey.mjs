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

export const TRUSTED_SOURCE_KEY_STATUSES = new Set([
  'verified',
])

export const editorChordPattern = /(?<![\p{L}\d])(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°-]\d*)*(?:\/(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)(?![\p{L}\d])/gu

export function editorChordTokens(line) {
  return [...String(line || '').matchAll(new RegExp(editorChordPattern.source, 'gu'))]
}

export function isEditorChordLine(line) {
  const matches = editorChordTokens(line)
  if (!matches.length) return false
  return line.replace(new RegExp(editorChordPattern.source, 'gu'), '').replace(/[\s|,:()[\]{}-]/g, '').length === 0
}

export function extractEditorChordModel(text) {
  const lines = []
  String(text || '').split('\n').forEach((line, lineIndex) => {
    if (!isEditorChordLine(line)) return
    const chords = editorChordTokens(line).map((match) => ({
      chord: match[0],
      root: match[1],
      suffix: match[2],
      column: match.index,
    }))
    if (chords.length) lines.push({ line: lineIndex, chords })
  })
  return { format: 'leadsheet-chords-v1', lines }
}

function sameEditorStructure(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
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
export function resolveEditorSnapshot(envelope = {}) {
  const snapshot = envelope?.snapshot && typeof envelope.snapshot === 'object'
    ? envelope.snapshot
    : envelope
  const status = String(snapshot?.snapshotStatus || snapshot?.status || '').trim()
  const sourceKey = normalizeEditorKey(snapshot?.sourceKey || snapshot?.source_key)
  const originalText = typeof snapshot?.originalText === 'string'
    ? snapshot.originalText
    : (typeof snapshot?.original_text === 'string' ? snapshot.original_text : '')
  const originalChordModel = snapshot?.originalChordModel || snapshot?.original_chord_model || null
  const originalAnchorData = snapshot?.originalAnchorData
    || snapshot?.originalAnchors
    || snapshot?.original_anchor_data
    || null
  const modelMatches = originalChordModel
    && sameEditorStructure(originalChordModel, extractEditorChordModel(originalText))
  const anchorsMatch = Array.isArray(originalAnchorData)
    && sameEditorStructure(originalAnchorData, extractEditorChordAnchors(originalText))
  if (!TRUSTED_SOURCE_KEY_STATUSES.has(status)
      || !sourceKey
      || !originalText
      || !modelMatches
      || !anchorsMatch) {
    return {
      ok: false,
      reason: status === 'verified' ? 'snapshot_incomplete' : 'snapshot_review_required',
      status: status || 'unresolved',
      sourceKey: '',
      originalText: '',
      originalChordModel: null,
      originalAnchorData: [],
    }
  }
  return {
    ok: true,
    status,
    sourceKey,
    originalText,
    originalChordModel,
    originalAnchorData,
    snapshotId: snapshot.id || '',
  }
}

export function resolveEditorSourceKey(snapshotEnvelope = {}) {
  return resolveEditorSnapshot(snapshotEnvelope).sourceKey
}

export function inferKeyFromLeadsheet(text) {
  const raw = String(text || '')
  const keyToken = '(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])'
  const patterns = [
    new RegExp(`(?:TONART|Tonart|KEY|Key)\\s*[:·]\\s*${keyToken}(?:\\s|-)?(?:dur|moll|major|minor)?`, 'i'),
    // Common chart headers: "Key - D | Time - 4/4"
    new RegExp(`(?:TONART|Tonart|KEY|Key)\\s*[-–—]\\s*${keyToken}(?![#b])`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match) return normalizeEditorKey(match[1])
  }
  return ''
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
export function resolveScanSourceKey({ visionKey = '', visionConfidence = 0, text = '', storedKey = '' } = {}) {
  const vision = normalizeEditorKey(visionKey)
  const tonart = inferKeyFromLeadsheet(text)
  const chords = inferKeyFromChords(text)
  const stored = normalizeEditorKey(storedKey)
  const explicit = vision || tonart
  if (explicit && chords.key && explicit !== chords.key) {
    return {
      key: chords.key,
      source: 'chords',
      status: 'detected_chords',
      confidence: chords.confidence,
      method: 'chord_scale_conflict_override',
      needsReview: true,
      visionKey: vision,
      tonartKey: tonart,
      chordKey: chords.key,
      staleStoredKey: stored,
    }
  }
  if (vision) {
    return {
      key: vision,
      source: 'vision',
      status: 'detected_vision',
      confidence: Math.max(0, Math.min(1, Number(visionConfidence) || (chords.key === vision ? chords.confidence : 0.9))),
      method: chords.key === vision ? 'vision_and_chord_agreement' : 'vision_document_key',
      needsReview: false,
      visionKey: vision,
      tonartKey: tonart,
      chordKey: chords.key,
      staleStoredKey: stored,
    }
  }
  if (tonart) {
    return {
      key: tonart,
      source: 'tonart',
      status: 'detected_document',
      confidence: chords.key === tonart ? chords.confidence : 0.95,
      method: chords.key === tonart ? 'document_key_and_chord_agreement' : 'explicit_document_key',
      needsReview: false,
      visionKey: vision,
      tonartKey: tonart,
      chordKey: chords.key,
      staleStoredKey: stored,
    }
  }
  if (chords.key) {
    return {
      key: chords.key,
      source: 'chords',
      status: 'detected_chords',
      confidence: chords.confidence,
      method: 'chord_scale_fit',
      needsReview: false,
      visionKey: vision,
      tonartKey: tonart,
      chordKey: chords.key,
      staleStoredKey: stored,
    }
  }
  return {
    key: '',
    source: 'unknown',
    status: 'review_required',
    confidence: 0,
    method: 'unresolved',
    needsReview: true,
    visionKey: vision,
    tonartKey: tonart,
    chordKey: '',
    staleStoredKey: stored,
  }
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

function transposeEditorChordToken(note, suffix, shift, targetKey) {
  const slash = suffix.match(/\/(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/)
  const root = (value) => editorPitchName((editorPitchMap[value] + shift + 120) % 12, targetKey)
  return root(note) + (slash ? `${suffix.slice(0, -slash[0].length)}/${root(slash[1])}` : suffix)
}

function transposeChordLinePreservingAnchors(line, shift, targetKey) {
  const matches = editorChordTokens(line)
  if (!matches.length) return line

  let output = line.slice(0, matches[0].index)
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const desiredColumn = match.index
    if (output.length < desiredColumn) output += ' '.repeat(desiredColumn - output.length)
    const transposed = transposeEditorChordToken(match[1], match[2], shift, targetKey)
    output += transposed

    const originalEnd = match.index + match[0].length
    const next = matches[index + 1]
    const segmentEnd = next ? next.index : line.length
    const between = line.slice(originalEnd, segmentEnd)
    if (next && /^\s*$/.test(between)) {
      const spaceCount = Math.max(1, next.index - output.length)
      output += ' '.repeat(spaceCount)
    } else {
      output += between
    }
  }
  return output
}

export function extractEditorChordAnchors(text) {
  const anchors = []
  String(text || '').split('\n').forEach((line, lineIndex) => {
    if (!isEditorChordLine(line)) return
    editorChordTokens(line).forEach((match, chordIndex) => {
      anchors.push({
        id: `${lineIndex}:${chordIndex}`,
        kind: 'text-column',
        line: lineIndex,
        column: match.index,
        chord: match[0],
      })
    })
  })
  return anchors
}

export function transposeEditorText(text, fromKey, toKey) {
  const source = normalizeEditorKey(fromKey)
  const target = normalizeEditorKey(toKey)
  if (!source || !target || source === target) return text
  const shift = editorPitchMap[target] - editorPitchMap[source]
  if (!shift) return text
  return String(text || '').split('\n').map((line) => (
    isEditorChordLine(line) ? transposeChordLinePreservingAnchors(line, shift, target) : line
  )).join('\n')
}

export function projectEditorSnapshot({
  originalText = '',
  originalChordModel = null,
  originalAnchorData = null,
  overlayText,
  sourceKey = '',
  selectedKey = '',
  requireSnapshotModel = false,
} = {}) {
  const source = normalizeEditorKey(sourceKey)
  const selected = normalizeEditorKey(selectedKey)
  const sourceText = overlayText == null ? String(originalText || '') : String(overlayText)
  const originalAnchors = extractEditorChordAnchors(originalText)
  const derivedChordModel = extractEditorChordModel(originalText)
  const sourceAnchors = extractEditorChordAnchors(sourceText)
  if (!source) {
    return {
      ok: false,
      reason: 'source_key_unresolved',
      sourceKey: '',
      selectedKey: '',
      text: sourceText,
      originalAnchors,
      sourceAnchors,
      visibleAnchors: sourceAnchors,
    }
  }
  if (!selected) {
    return {
      ok: false,
      reason: 'selected_key_invalid',
      sourceKey: source,
      selectedKey: '',
      text: sourceText,
      originalAnchors,
      sourceAnchors,
      visibleAnchors: sourceAnchors,
    }
  }
  if (requireSnapshotModel && (
    !sameEditorStructure(originalChordModel, derivedChordModel)
    || !sameEditorStructure(originalAnchorData, originalAnchors)
  )) {
    return {
      ok: false,
      reason: 'snapshot_model_mismatch',
      sourceKey: source,
      selectedKey: selected,
      text: sourceText,
      originalAnchors,
      sourceAnchors,
      visibleAnchors: sourceAnchors,
    }
  }
  if (overlayText != null && (
    !sameEditorStructure(extractEditorChordModel(sourceText), derivedChordModel)
    || !sameEditorStructure(sourceAnchors, originalAnchors)
  )) {
    return {
      ok: false,
      reason: 'overlay_chord_structure_changed',
      sourceKey: source,
      selectedKey: selected,
      text: sourceText,
      originalAnchors,
      sourceAnchors,
      visibleAnchors: sourceAnchors,
    }
  }
  const text = displayEditorText(sourceText, source, selected)
  return {
    ok: true,
    sourceKey: source,
    selectedKey: selected,
    text,
    originalAnchors,
    sourceAnchors,
    visibleAnchors: extractEditorChordAnchors(text),
  }
}

/**
 * Select a display key. Unknown source keys remain blocked and can never be
 * inferred from a UI selection.
 */
export function applyEditorKeyChange(originalText, sourceKey, nextKey) {
  const next = normalizeEditorKey(nextKey)
  const source = normalizeEditorKey(sourceKey)
  if (!next) {
    return { text: originalText, sourceKey: source, currentKey: source, targetKey: '', blocked: true, reason: 'selected_key_invalid' }
  }
  if (!source) {
    return { text: originalText, sourceKey: '', currentKey: next, targetKey: next, blocked: true, reason: 'source_key_unresolved' }
  }
  return {
    text: displayEditorText(originalText, source, next),
    sourceKey: source,
    currentKey: next,
    targetKey: next,
  }
}
