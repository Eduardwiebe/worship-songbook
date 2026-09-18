/**
 * Chord-view syllable rehydration.
 *
 * Engraved lyrics under notes are syllabic ("ei nen", "un serm", "Eh re").
 * Akkordansicht must show normal German words ("einen", "unserm", "Ehre")
 * using native PDF words, boxes, baselines, and gaps — never musical underlay.
 */

import { isClosedClassWord, isProtectedWholeWord } from './ocrTextRefine.mjs'
import { isMetadataText } from './songMetadata.mjs'

const VOWEL = /[aeiouyäöüAEIOUYÄÖÜ]/

const COMPLETE_SHORT = new Set([
  'so', 'ja', 'nur', 'hin', 'her', 'vor', 'aus', 'auf', 'ob', 'da', 'na', 'nie',
  'neu', 'gut', 'hat', 'nun', 'weg', 'tod', 'tot', 'lob', 'ruh', 'weh', 'weh',
  'oh', 'ah', 'am', 'im', 'an', 'in', 'es', 'er', 'sie', 'wir', 'ihr', 'du',
  'zu', 'um', 'ab', 'ja', 'nein', 'mein', 'dein', 'sein', 'uns', 'mir', 'dir',
  'ich', 'und', 'als', 'der', 'die', 'das', 'ein', 'mit', 'bei', 'von', 'für',
  'war', 'ist', 'den', 'dem', 'des',
])

const KNOWN_WORDS = new Set([
  'einen', 'einem', 'einer', 'eines',
  'unserm', 'unserem', 'unserer', 'unsere', 'unser',
  'ehre', 'heilig', 'herrlichkeit', 'halleluja', 'hallelujah',
  'kommen', 'komme', 'gehst', 'stehst', 'stehe',
  'barmherzig', 'geduld', 'majestaet', 'majestät',
])

function tokenCenterX(token) {
  const [x0, , x1] = token.bbox || [0, 0, 0, 0]
  return (x0 + x1) / 2
}

function tokenCenterY(token) {
  const [, y0, , y1] = token.bbox || [0, 0, 0, 0]
  return (y0 + y1) / 2
}

function tokenWidth(token) {
  return Math.max((token.bbox?.[2] || 0) - (token.bbox?.[0] || 0), 1)
}

function typicalCharWidth(token) {
  const letters = String(token.text || '').replace(/\s+/g, '').length
  return Math.max(tokenWidth(token) / Math.max(letters, 1), 6)
}

function normalizeWord(raw) {
  return String(raw || '')
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .toLowerCase()
}

function isCompleteWord(raw) {
  const text = String(raw || '').replace(/-$/, '')
  const lower = normalizeWord(text)
  if (!lower) return false
  if (isClosedClassWord(lower) || COMPLETE_SHORT.has(lower) || isProtectedWholeWord(lower)) return true
  if (KNOWN_WORDS.has(lower)) return true
  if (lower.length >= 5 && VOWEL.test(lower)) return true
  return false
}

function isIncompleteSyllable(raw) {
  const text = String(raw || '').replace(/-$/, '').trim()
  if (!text) return true
  if (/[-‐‑‒–—]$/.test(String(raw || ''))) return true
  const lower = normalizeWord(text)
  if (!lower) return true
  if (isCompleteWord(lower)) return false
  return lower.length <= 4
}

const CHORD_LIKE_RE = /^(?:[CDEFGABH](?:is|es|#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[CDEFGABH](?:is|es|#|b)?)?)$/

function looksLikeChordWord(word) {
  return CHORD_LIKE_RE.test(String(word || '').trim())
}

export function lyricTokensLookSyllabic(tokens = []) {
  const lyrics = tokens.filter((token) => {
    const text = String(token?.text || '').trim()
    if (!text || isMetadataText(text) || looksLikeChordWord(text)) return false
    if (/^\[.+\]$/.test(text)) return false
    return /[\p{L}]/u.test(text)
  })
  if (lyrics.length < 6) return false
  const short = lyrics.filter((token) => {
    const value = String(token.text).replace(/-$/, '')
    return value.length <= 3 || /-$/.test(String(token.text))
  }).length
  return short / lyrics.length >= 0.32
}

export function collectNativeLexicon(tokens = []) {
  const words = new Set(KNOWN_WORDS)
  for (const token of tokens) {
    const parts = String(token?.text || '').split(/[^\p{L}]+/u).filter(Boolean)
    for (const part of parts) {
      const lower = part.toLowerCase()
      if (looksLikeChordWord(part)) continue
      if (lower.length >= 4 && VOWEL.test(lower) && !isMetadataText(part)) words.add(lower)
      if (isClosedClassWord(lower) || COMPLETE_SHORT.has(lower)) words.add(lower)
    }
  }
  return words
}

function sameBaseline(a, b) {
  if (!a?.bbox || !b?.bbox) return true
  const dy = Math.abs(tokenCenterY(a) - tokenCenterY(b))
  const h = Math.max((a.bbox[3] - a.bbox[1]) || 12, (b.bbox[3] - b.bbox[1]) || 12)
  return dy <= h * 0.65
}

/**
 * Native word boxes that cover a run of syllable tokens on a nearby baseline
 * win over guessed joins.
 */
export function coveringNativeWord(syllables, nativeTokens) {
  if (!syllables.length || !nativeTokens?.length) return null
  const x0 = Math.min(...syllables.map((token) => token.bbox?.[0] ?? 0))
  const x1 = Math.max(...syllables.map((token) => token.bbox?.[2] ?? 0))
  const y = syllables.reduce((sum, token) => sum + tokenCenterY(token), 0) / syllables.length
  let best = null
  let bestScore = 0
  for (const native of nativeTokens) {
    const word = String(native.text || '').trim()
    if (!word || isMetadataText(word) || /\s/.test(word)) continue
    if (word.length < 2 || looksLikeChordWord(word)) continue
    if (!syllables.every((token) => sameBaseline(token, native))) continue
    const nx0 = native.bbox?.[0]
    const nx1 = native.bbox?.[2]
    if (nx0 == null || nx1 == null) continue
    const overlap = Math.min(x1, nx1) - Math.max(x0, nx0)
    const sliceWidth = Math.max(x1 - x0, 1)
    const nativeWidth = Math.max(nx1 - nx0, 1)
    if (overlap / sliceWidth < 0.72 || overlap / nativeWidth < 0.72) continue
    const dy = Math.abs(tokenCenterY(native) - y)
    if (dy > 80) continue
    const score = (overlap / sliceWidth) - dy / 400
    if (score > bestScore && normalizeWord(word).length >= 2) {
      best = word
      bestScore = score
    }
  }
  return best
}

function lexiconMatch(parts, lexicon) {
  const combined = parts.join('').replace(/-/g, '')
  const lower = normalizeWord(combined)
  if (!lower) return null
  if (lexicon.has(lower) || KNOWN_WORDS.has(lower) || isProtectedWholeWord(lower)) return combined
  return null
}

function stripJoinPunct(text) {
  return String(text || '').replace(/-$/g, '').replace(/^-/g, '')
}

/**
 * Rehydrate a baseline of lyric tokens into readable words.
 * @param {object[]} tokens syllable/word tokens with bbox
 * @param {{ nativeTokens?: object[], lexicon?: Set<string> }} [options]
 */
export function rehydrateSyllableLine(tokens, { nativeTokens = [], lexicon } = {}) {
  const usable = (tokens || [])
    .map((token) => ({ ...token, text: String(token.text || '').trim() }))
    .filter((token) => token.text && !isMetadataText(token.text))
    .sort((a, b) => (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0) || tokenCenterY(a) - tokenCenterY(b))

  if (!usable.length) return { text: '', words: [] }

  const wordsLex = lexicon || collectNativeLexicon([...(nativeTokens || []), ...usable])
  const words = []
  let i = 0
  while (i < usable.length) {
    const start = usable[i]
    if (start.text === '-') {
      i += 1
      continue
    }

    let best = null
    const maxLook = Math.min(usable.length, i + 6)
    for (let j = i; j < maxLook; j += 1) {
      const slice = usable.slice(i, j + 1)
      if (slice.length > 1 && slice.some((token, idx) => idx > 0 && !sameBaseline(slice[0], token))) break
      const covered = coveringNativeWord(slice, nativeTokens)
      if (covered && slice.length >= 1) {
        best = { end: j, text: covered, via: 'native-box' }
      }
      const joined = slice.map((token) => stripJoinPunct(token.text)).join('')
      const lex = lexiconMatch(slice.map((token) => stripJoinPunct(token.text)), wordsLex)
      if (lex) best = { end: j, text: preserveCase(lex, slice[0].text), via: 'lexicon' }
      else if (slice.length === 1 && isCompleteWord(slice[0].text)) {
        if (!best) best = { end: j, text: stripJoinPunct(slice[0].text), via: 'complete' }
      } else if (slice.length >= 2 && slice.every((token) => isIncompleteSyllable(token.text))) {
        const gapOk = slice.every((token, idx) => {
          if (idx === 0) return true
          const prev = slice[idx - 1]
          if (!prev.bbox || !token.bbox) return true
          const gap = token.bbox[0] - prev.bbox[2]
          return gap <= Math.max(typicalCharWidth(prev) * 8, 90)
        })
        const candidate = joined.replace(/-/g, '')
        if (gapOk && candidate.length >= 4 && VOWEL.test(candidate) && !isClosedClassWord(candidate)) {
          if (!best || best.end < j) best = { end: j, text: preserveCase(candidate, slice[0].text), via: 'fragments' }
        }
      }
    }

    if (!best) {
      words.push({ text: stripJoinPunct(start.text), tokens: [start] })
      i += 1
      continue
    }
    const slice = usable.slice(i, best.end + 1)
    words.push({ text: best.text, tokens: slice, via: best.via })
    i = best.end + 1
  }

  const text = words.map((word) => word.text).join(' ').replace(/\s+([.,;:!?])/g, '$1')
  return { text: text.replace(/[ \t]+/g, ' ').trim(), words }
}

function preserveCase(combined, sample) {
  const raw = String(combined || '')
  if (/^\p{Lu}/u.test(String(sample || ''))) {
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }
  return raw
}

/**
 * Join a list of lyric tokens (possibly mixed complete words + syllables)
 * into a readable chord-view line.
 */
export function rehydrateLyricTokens(tokens, options = {}) {
  return rehydrateSyllableLine(tokens, options).text
}
