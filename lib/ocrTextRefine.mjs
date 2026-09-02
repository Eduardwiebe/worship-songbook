/**
 * Conservative lyric/chord text repair after OMR-zone fill.
 * Does not invent lyrics. Glue splits use German function-word boundaries;
 * umlaut/ß repairs use closed OCR-confusable patterns only.
 */

const VOWEL = /[aeiouyäöüAEIOUYÄÖÜ]/

const KEEP_WHOLE = new Set([
  'allein', 'alles', 'allen', 'allem', 'alle', 'also', 'alsbald',
  'dazu', 'davon', 'damit', 'dafür', 'darin', 'darauf', 'dahin', 'daher', 'daran', 'darum',
  'diese', 'dieser', 'dieses', 'diesem', 'diesen',
  'durch', 'durchaus', 'durcheinander',
  'hatte', 'hatten',
  'hinter', 'indem', 'indessen',
  'miteinander', 'nacheinander',
  'trotzdem',
  'überall', 'überhaupt', 'überaus',
  'unter', 'unterwegs', 'untereinander',
  'zwischen', 'zuerst', 'zuletzt', 'zusammen', 'zurück', 'zuvor', 'zufrieden', 'zugleich', 'zumindest',
])

const PREFIXES = [
  'wirst', 'werdet', 'werden', 'wurde', 'wurden',
  'nicht', 'noch', 'schon', 'auch',
  'mein', 'dein', 'sein', 'eure', 'euer', 'unser', 'unsre',
  'dass', 'daß', 'und', 'oder', 'aber',
  'mich', 'dich', 'euch', 'uns',
  'dir', 'mir', 'wir', 'ihr',
  'hast', 'habt', 'haben',
  'ich', 'du',
  'als',
  'zu',
]

const SUFFIXES = ['hinauf', 'hinein', 'heraus', 'mich', 'dich', 'euch', 'uns', 'dir', 'mir']

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

function plausibleGermanRest(rest) {
  if (!rest || rest.length < 3) return false
  if (!hasVowel(rest)) return false
  if (/^[A-ZÄÖÜ]{2,}$/.test(rest)) return false
  return true
}

function prefixAllowed(prefix, restLower) {
  if (prefix === 'zu') return /^(dir|mir|uns|ihm|ihr|den|dem|der)/.test(restLower)
  if (prefix === 'als') return /^(wahr|der|die|das|ein|ich|du|wir|gott|mensch)/.test(restLower)
  return true
}

function splitOnce(word) {
  const lower = word.toLowerCase()
  if (KEEP_WHOLE.has(lower) || lower.length < 6) return null

  for (const prefix of PREFIXES) {
    if (!lower.startsWith(prefix) || lower.length <= prefix.length) continue
    const rest = word.slice(prefix.length)
    const restLower = rest.toLowerCase()
    if (!prefixAllowed(prefix, restLower)) continue
    if (!plausibleGermanRest(rest) && !splitOnce(rest)) continue
    return [word.slice(0, prefix.length), rest]
  }

  for (const suffix of SUFFIXES) {
    if (!lower.endsWith(suffix) || lower.length < suffix.length + 4) continue
    const head = word.slice(0, word.length - suffix.length)
    if (!hasVowel(head) || head.length < 4) continue
    if (KEEP_WHOLE.has(head.toLowerCase())) continue
    return [head, word.slice(head.length)]
  }
  return null
}

function splitCore(word) {
  const parts = []
  let rest = word
  const seen = new Set()
  while (rest && !seen.has(rest.toLowerCase())) {
    seen.add(rest.toLowerCase())
    const pair = splitOnce(rest)
    if (!pair) {
      parts.push(rest)
      break
    }
    parts.push(pair[0])
    rest = pair[1]
  }
  return parts
}

/**
 * Split RapidOCR-glued German tokens using function-word boundaries.
 * "ichdanke" → "ich danke"; "Alswahrer" → "Als wahrer"; "duwirstverstehn" → "du wirst verstehn"
 */
export function splitGluedGermanWords(raw) {
  return String(raw || '').replace(/[\p{L}ÄÖÜäöüß]+/gu, (word) => splitCore(word).join(' '))
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

export function refineLyricText(raw) {
  const split = splitGluedGermanWords(raw)
  const ortho = refineGermanOrthography(split)
  return {
    text: ortho.text.replace(/[ \t]+/g, ' ').trim(),
    uncertain: ortho.uncertain,
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
