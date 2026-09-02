/**
 * Conservative lyric/chord text repair after OMR-zone fill.
 *
 * Glued lyric runs are segmented with a scored German word-break:
 * function-word anchors, lexicon/phonotactic probability, and sequence
 * likelihood. A split is kept only when it is clearly better than the
 * original token. Whole words without a function-word cut stay intact.
 */

const VOWEL = /[aeiouyäöüAEIOUYÄÖÜ]/

const KEEP_WHOLE = new Set([
  'allein', 'alles', 'allen', 'allem', 'alle', 'also', 'alsbald', 'amen',
  'barmherzig', 'bridge', 'chorus',
  'dazu', 'davon', 'damit', 'dafür', 'darin', 'darauf', 'dahin', 'daher', 'daran', 'darum',
  'diese', 'dieser', 'dieses', 'diesem', 'diesen',
  'durch', 'durchaus', 'durcheinander',
  'geduld',
  'halleluja', 'hallelujah',
  'hatte', 'hatten', 'heraus', 'herauf', 'herab', 'hinauf', 'hinein', 'hinter',
  'indem', 'indessen',
  'miteinander', 'nacheinander',
  'refrain', 'sehnsucht', 'strophe',
  'trotzdem',
  'überall', 'überhaupt', 'überaus',
  'unter', 'unterwegs', 'untereinander',
  'verstehst', 'verstehen', 'verse',
  'wieder', 'wunder',
  'zwischen', 'zuerst', 'zuletzt', 'zusammen', 'zurück', 'zuvor', 'zufrieden', 'zugleich', 'zumindest',
])

const FUNCTION = new Set([
  'du', 'zu', 'es', 'im', 'am', 'in',
  'ich', 'dir', 'mir', 'und', 'als', 'der', 'die', 'das', 'ein', 'mit', 'bei', 'von',
  'für', 'fur', 'war', 'ist', 'uns', 'wir', 'ihr', 'sie', 'wenn', 'was', 'wo', 'wer', 'wie',
  'mich', 'dich', 'dass', 'daß', 'eine', 'wirst', 'wird', 'bist', 'auch', 'noch',
  'nicht', 'mein', 'dein', 'sein', 'hast', 'habt', 'oder', 'aber', 'schon', 'warst',
  'einem', 'einen', 'einer', 'den', 'dem',
])

const CONTENT = new Set([
  'danke', 'wahrer', 'wahre', 'gott', 'kennst', 'hebst', 'verstehn', 'verstehst',
  'verstehen', 'weißt', 'weisst', 'fühle', 'fuhle', 'stehe', 'liebst', 'nennst',
  'vergibst', 'richtest', 'fliehe', 'denke', 'mensch', 'menschen',
])

const VERB_LIKE = /(?:st|ßt|est|te|ten|en)$/i

const UMLAUT_CLOSED = [
  [/\bweiSt\b/g, 'weißt'],
  [/\bWeisSt\b/g, 'Weißt'],
  [/\bweisst\b/g, 'weißt'],
  [/\bWeisst\b/g, 'Weißt'],
  [/\bfuhle\b/g, 'fühle'],
  [/\bFuhle\b/g, 'Fühle'],
  [/\bfuhlt\b/g, 'fühlt'],
  [/\bfuhlen\b/g, 'fühlen'],
  [/\buber\b/g, 'über'],
  [/\bUber\b/g, 'Über'],
  [/\bfuer\b/g, 'für'],
  [/\bFuer\b/g, 'Für'],
  [/\bgroesser\b/g, 'größer'],
  [/\bGroesser\b/g, 'Größer'],
  [/\bgrosser\b/g, 'größer'],
  [/\bGrosser\b/g, 'Größer'],
  [/\bStrasse\b/g, 'Straße'],
  [/\bstrasse\b/g, 'straße'],
  [/\bStrase\b/g, 'Straße'],
  [/\bstrase\b/g, 'straße'],
]

function hasVowel(value) {
  return VOWEL.test(value)
}

function germanShape(value) {
  if (!value || value.length < 4) return false
  if (!hasVowel(value)) return false
  if (/^[A-ZÄÖÜ]{2,}$/.test(value)) return false
  if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(value)) return false
  return true
}

function isVerbLike(value, kind) {
  const lower = value.toLowerCase()
  if (['ist', 'war', 'bist', 'wirst', 'wird', 'weißt', 'weisst', 'hast', 'hat', 'sind'].includes(lower)) {
    return true
  }
  if (kind === 'content' || kind === 'shape' || kind === 'keep') return VERB_LIKE.test(value)
  return false
}

function scorePiece(raw) {
  const lower = raw.toLowerCase()
  if (KEEP_WHOLE.has(lower)) return { score: 120 + raw.length * 3, kind: 'keep', verb: isVerbLike(raw, 'keep') }
  if (CONTENT.has(lower)) return { score: 90 + raw.length * 3, kind: 'content', verb: isVerbLike(raw, 'content') }
  if (FUNCTION.has(lower)) {
    return {
      score: raw.length <= 2 ? 42 : 55 + raw.length * 2,
      kind: 'function',
      verb: isVerbLike(raw, 'function'),
    }
  }
  if (germanShape(raw)) {
    return { score: 18 + raw.length, kind: 'shape', verb: isVerbLike(raw, 'shape') }
  }
  return null
}

function sequenceBonus(previous, current) {
  if (!previous) return 0
  if (previous.kind === 'function' && current.kind === 'function') return 16
  if (previous.kind === 'function' && (current.kind === 'content' || current.kind === 'keep' || current.kind === 'shape')) {
    return 12
  }
  if ((previous.kind === 'content' || previous.kind === 'keep' || previous.kind === 'shape') && current.kind === 'function') {
    return 12
  }
  return 0
}

function esAllowed(previous) {
  return Boolean(previous?.verb)
}

function segmentWord(word, { confidence = 1 } = {}) {
  if (!word) return { parts: [word], uncertain: false }
  const lower = word.toLowerCase()
  if (KEEP_WHOLE.has(lower)) return { parts: [word], uncertain: false }
  if (word.length < 5) return { parts: [word], uncertain: false }

  const n = word.length
  const best = Array.from({ length: n + 1 }, () => null)
  best[0] = { score: 0, parts: [], kinds: [], verbs: [] }

  for (let i = 0; i < n; i += 1) {
    if (!best[i]) continue
    const previous = best[i].kinds.length
      ? { kind: best[i].kinds[best[i].kinds.length - 1], verb: best[i].verbs[best[i].verbs.length - 1] }
      : null
    for (let j = i + 1; j <= n; j += 1) {
      const slice = word.slice(i, j)
      const piece = scorePiece(slice)
      if (!piece) continue
      if (slice.toLowerCase() === 'es' && !esAllowed(previous)) continue
      const cut = i === 0 ? 0 : 8
      const nextScore = best[i].score + piece.score + sequenceBonus(previous, piece) - cut
      if (!best[j] || nextScore > best[j].score) {
        best[j] = {
          score: nextScore,
          parts: [...best[i].parts, slice],
          kinds: [...best[i].kinds, piece.kind],
          verbs: [...(best[i].verbs || []), piece.verb],
        }
      }
    }
  }

  const whole = scorePiece(word) || { score: 0, kind: 'shape' }
  const chosen = best[n]
  const hasAnchor = chosen?.kinds.includes('function') || chosen?.kinds.includes('keep')
  const margin = confidence >= 0.85 ? 28 : 18
  if (!chosen || !hasAnchor || chosen.parts.length < 2 || chosen.score < whole.score + margin) {
    const looksGlued = [...FUNCTION].some((item) => item.length >= 3 && lower.includes(item) && !KEEP_WHOLE.has(lower))
    return { parts: [word], uncertain: looksGlued && word.length >= 8 }
  }
  return {
    parts: chosen.parts,
    uncertain: chosen.kinds.includes('shape'),
  }
}

function normalizeWeisstRuns(raw) {
  return String(raw || '').replace(/wei(?:Bt|St|sst)/g, (match) => (match[0] === 'W' ? 'Weißt' : 'weißt'))
}

function segmentText(raw, options) {
  let uncertain = false
  const text = String(raw || '').replace(/[\p{L}ÄÖÜäöüß]+/gu, (word) => {
    const result = segmentWord(word, options)
    if (result.uncertain) uncertain = true
    return result.parts.join(' ')
  })
  return { text, uncertain }
}

/**
 * Split RapidOCR-glued German tokens. Already-spaced token boundaries stay.
 * "ichdankedir" → "ich danke dir"; "Gottund" → "Gott und"
 */
export function splitGluedGermanWords(raw, options) {
  return segmentText(raw, options).text
}

export function isClosedClassWord(raw) {
  return FUNCTION.has(String(raw || '').toLowerCase())
}

export function isProtectedWholeWord(raw) {
  return KEEP_WHOLE.has(String(raw || '').toLowerCase())
}

/**
 * Closed-set German OCR orthography. Does not run a dictionary rewriter.
 * Low-certainty leftover "weist" (without du/ihr) is reported, not force-changed.
 */
export function refineGermanOrthography(raw) {
  let text = String(raw || '')
  for (const [pattern, replacement] of UMLAUT_CLOSED) {
    text = text.replace(pattern, replacement)
  }
  text = text.replace(/\b(du|ihr)\s+weist\b/gi, (_, pronoun) => `${pronoun} weißt`)
  const uncertain = /\bweist\b/.test(text)
  return { text, uncertain }
}

export function refineLyricText(raw, options) {
  const prepared = normalizeWeisstRuns(raw)
  const segmented = segmentText(prepared, options)
  const ortho = refineGermanOrthography(segmented.text)
  return {
    text: ortho.text.replace(/[ \t]+/g, ' ').trim(),
    uncertain: segmented.uncertain || ortho.uncertain,
  }
}

export function normalizeChordGlyphs(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/[♯＃]/g, '#').replace(/[♭]/g, 'b').replace(/[／⁄∕]/g, '/')
  text = text.replace(/\s*\/\s*/g, '/')
  const wrapped = text.match(/^\((.+)\)$/)
  if (wrapped) text = wrapped[1].trim()
  return text
}
