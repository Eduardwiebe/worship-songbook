/**
 * Musical page understanding from structured OCR tokens + optional staff systems.
 *
 * OCR tokens are raw data (text, bbox, confidence). Reading order is never
 * copied as song text. Reconstruction assigns every token to a page region,
 * uses staff geometry when present, and keeps parallel lyric tracks separate.
 */

import { chordPattern, cleanOcrText, isChordLine, pitchMap, scoreLeadsheetQuality } from './leadsheetAnalysis.mjs'
import { packChordsAboveLyrics, softFormatChordChart, deinterleaveTwoColumnLayout } from './chartLayout.mjs'
import { isClosedClassWord, isProtectedWholeWord, normalizeChordGlyphs, refineLyricText } from './ocrTextRefine.mjs'

const SECTION_NAME_RE = /^(?:verse|strophe|chorus|refrain|ref|bridge|intro|outro|pre-?chorus|ending|coda|tag|interlude)/i
const TEMPO_RE = /^(?:tempo|bpm|♩|=)\b/i
const META_RE = /^(?:capo|key|tonart|words|music|text|melodie|copyright|©|cc\s*li)/i
const COPYRIGHT_RE = /(?:©|copyright|\bcc\s*li\b|verlag|hänssler|hanssler|immanuel\s+music|nach\s+psalm|\bmelodie\b|\btext\s*\()/i
const YEAR_PUB_RE = /^(?:©\s*)?(?:19|20)\d{2}\b/
const RUBRIC_RE = /^(?:lob\s*&?\s*dank|lob\s+und\s+dank|anbetung|anrufung)$/i
const RUBRIC_CAPS_RE = /^[A-ZÄÖÜ]{2,}(?:\s*[&+/]\s*[A-ZÄÖÜ]{2,})+$/
const MUSIC_JUNK = /^[|¦\[\]{}♪♫♩♬ coc·•]+$/u
const OCR_GARBAGE_TOKEN = /^(sss+|ss+|ce|ow|oh+|ah+|mm+|hm+|<3|~+|_+|=+)$/i

/** Strict chord validator — rejects SSS, ce, ow, 66, <3, etc. */
export function isValidChordToken(raw) {
  const text = normalizeChordGlyphs(raw)
  if (!text || text.length > 18) return false
  if (/^[0-9]+$/.test(text)) return false
  if (/[<>_=~]/.test(text)) return false
  if (OCR_GARBAGE_TOKEN.test(text)) return false

  const matches = [...text.matchAll(new RegExp(chordPattern.source, 'gu'))]
  if (matches.length !== 1) return false
  if (matches[0][0] !== text) return false
  if (!(matches[0][1] in pitchMap)) return false
  if (/^[a-z]$/.test(text)) return false
  return true
}

const SIMPLE_BASS = /^(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/

function chordSourceRank(token) {
  if (token.source === 'audiveris-chord') return 3
  if (String(token.source || '').startsWith('audiveris')) return 2
  return 1
}

function pickChordSlot(items) {
  if (!items.length) return null
  const names = [...new Set(items.map((item) => normalizeChordGlyphs(item.text)))]
  const slashes = items.filter((item) => normalizeChordGlyphs(item.text).includes('/'))
  const omr = items.filter((item) => item.source === 'audiveris-chord')
  const ranked = (slashes.length ? slashes : omr.length ? omr : items)
    .slice()
    .sort((a, b) => chordSourceRank(b) - chordSourceRank(a) || (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
  const chosen = ranked[0]
  const text = normalizeChordGlyphs(chosen.text)
  const sameName = names.length === 1
  const omrNames = new Set(omr.map((item) => normalizeChordGlyphs(item.text)))
  const confidence = sameName
    ? Math.min(1, Math.max(...items.map((item) => Number(item.confidence) || 0)) + (items.length > 1 ? 0.08 : 0))
    : Number(chosen.confidence) || 0
  return {
    ...chosen,
    text,
    confidence,
    chordUncertain: names.length > 1 && omrNames.size !== 1,
  }
}

/**
 * Merge OMR + OCR chord glyphs in the same X slot.
 * Stacked roots (F over C) become slash chords. Conflicts prefer Audiveris
 * chord-name glyphs, then higher confidence; leftover disagreement is flagged.
 */
export function mergeChordCandidates(tokens) {
  const prepared = tokens.map((token) => ({
    ...token,
    text: normalizeChordGlyphs(token.text),
  })).filter((token) => isValidChordToken(token.text))
  const sorted = prepared.sort((a, b) => tokenCenterX(a) - tokenCenterX(b) || tokenCenterY(a) - tokenCenterY(b))
  const clusters = []
  for (const chord of sorted) {
    const cx = tokenCenterX(chord)
    const previous = clusters[clusters.length - 1]
    if (previous && Math.abs(previous.cx - cx) < 28) {
      previous.items.push(chord)
      previous.cx = previous.items.reduce((sum, item) => sum + tokenCenterX(item), 0) / previous.items.length
    } else {
      clusters.push({ cx, items: [chord] })
    }
  }

  const chords = []
  const conflicts = []
  for (const cluster of clusters) {
    const items = cluster.items
    const byY = [...items].sort((a, b) => tokenCenterY(a) - tokenCenterY(b))
    const top = byY[0]
    const bottom = byY[byY.length - 1]
    const dy = tokenCenterY(bottom) - tokenCenterY(top)
    const stacked = items.length > 1 && dy >= 12 && dy <= 90
    if (stacked) {
      const upperItems = items.filter((item) => Math.abs(tokenCenterY(item) - tokenCenterY(top)) < 16)
      const lowerItems = items.filter((item) => Math.abs(tokenCenterY(item) - tokenCenterY(bottom)) < 16)
      const upper = pickChordSlot(upperItems)
      const lower = pickChordSlot(lowerItems)
      const upperRoot = upper ? normalizeChordGlyphs(upper.text).split('/')[0] : ''
      const lowerBass = lower ? normalizeChordGlyphs(lower.text) : ''
      if (upper && lower && upperRoot !== lowerBass && SIMPLE_BASS.test(lowerBass)) {
        const slash = `${upperRoot}/${lowerBass}`
        if (isValidChordToken(slash)) {
          chords.push({ ...upper, text: slash, chordUncertain: Boolean(upper.chordUncertain || lower.chordUncertain) })
          continue
        }
      }
    }
    const chosen = pickChordSlot(items)
    if (!chosen) continue
    if (chosen.chordUncertain) conflicts.push(chosen)
    chords.push(chosen)
  }
  return { chords, conflicts }
}

export function tokenCenterX(token) {
  const [x0, , x1] = token.bbox
  return (x0 + x1) / 2
}

export function tokenCenterY(token) {
  const [, y0, , y1] = token.bbox
  return (y0 + y1) / 2
}

function tokenHeight(token) {
  return Math.max((token.bbox[3] || 0) - (token.bbox[1] || 0), 1)
}

function tokenWidth(token) {
  return Math.max((token.bbox[2] || 0) - (token.bbox[0] || 0), 1)
}

/**
 * Normalize engraved lyric hyphenation without deleting linguistic hyphens.
 * "ste - he" / "ste-he" / "barm - her - zig" / "Ge-duld" → joined
 * "Ist-Zustand", "E-Mail", "COVID-19" → kept
 */
export function normalizeEngravedLyrics(raw) {
  let text = String(raw || '')
  text = text.replace(/,(?=\S)/g, ', ')
  text = text.replace(/;(?=\S)/g, '; ')
  text = text.replace(/:(?=\S)/g, ': ')
  text = text.replace(/,\s+-\s*/g, ', ')

  const dash = '[-\\u2010-\\u2015\\u2212]'
  const joinSyllable = (left, right) => {
    const combined = `${left}${right}`
    if (isProtectedWholeWord(combined)) return combined
    if (isClosedClassWord(left) && isClosedClassWord(right)) return `${left} ${right}`
    if (isClosedClassWord(left) && right.length >= 4) return `${left} ${right}`
    if (right.length > 6) return `${left} ${right}`
    return combined
  }
  let previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(new RegExp(`(\\p{L}{1,8})\\s+${dash}\\s+(\\p{L}{1,8})`, 'gu'), (_, left, right) => joinSyllable(left, right))
    text = text.replace(new RegExp(`(\\p{L}{1,8})${dash}\\s+(\\p{L}{1,8})`, 'gu'), (_, left, right) => joinSyllable(left, right))
    text = text.replace(new RegExp(`(\\p{L}{1,8})\\s+${dash}(\\p{L}{1,8})`, 'gu'), (_, left, right) => joinSyllable(left, right))
  }

  previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(new RegExp(`(\\p{L}{1,6})${dash}(\\p{Ll}{1,6})`, 'gu'), (full, left, right) => {
      if (/\d/.test(left) || /\d/.test(right)) return full
      if (/^\p{Lu}$/u.test(left)) return full
      const combined = `${left}${right}`
      if (isProtectedWholeWord(combined)) return combined
      if (isClosedClassWord(left) && isClosedClassWord(right)) return `${left} ${right}`
      if (isClosedClassWord(left) && right.length >= 4) return `${left} ${right}`
      if (right.length > 6) return `${left} ${right}`
      return combined
    })
  }

  return text.replace(/[ \t]+/g, ' ').trim()
}

function parseSectionToken(raw) {
  const text = String(raw || '').trim()
  const match = text.match(SECTION_NAME_RE)
  if (!match) return null

  const sectionName = match[0]
  const remainder = text.slice(sectionName.length).replace(/^[.:\s]+/, '').trim()
  const isVerse = /^(?:verse|strophe)$/i.test(sectionName)
  if (remainder && !(isVerse && /^[1-9]$/.test(remainder)) && !isValidChordToken(remainder)) return null

  let label = sectionName
  if (/^(?:ref|refrain|chorus)$/i.test(sectionName)) label = 'Refrain'
  if (isVerse && /^[1-9]$/.test(remainder)) label = `Strophe ${remainder}`
  return {
    label,
    trailingChord: remainder && isValidChordToken(remainder) ? remainder : '',
  }
}

function isRubricText(text) {
  const value = String(text || '').trim()
  return RUBRIC_RE.test(value) || RUBRIC_CAPS_RE.test(value.replace(/\s+/g, ' '))
}

function isPageOrSongNumber(text) {
  return /^\d{1,3}\.?$/.test(String(text || '').trim())
}

function isTempoNumber(text) {
  return /^(?:♩\s*=\s*)?\d{2,3}$/.test(String(text || '').trim())
}

function isCopyrightText(text) {
  const value = String(text || '').trim()
  return COPYRIGHT_RE.test(value) || YEAR_PUB_RE.test(value)
}

function isMarginalVerticalToken(token) {
  const width = tokenWidth(token)
  const height = tokenHeight(token)
  const pageWidth = Number(token.page_width) || 0
  const pageHeight = Number(token.page_height) || 0
  if (pageWidth <= 0 || pageHeight <= 0) return false
  const leftColumn = token.bbox[2] <= pageWidth * 0.14 || tokenCenterX(token) <= pageWidth * 0.12
  if (leftColumn && (isRubricText(token.text) || /^[A-ZÄÖÜ&]{2,10}$/.test(String(token.text || '').trim()))) {
    return true
  }
  return token.bbox[2] <= pageWidth * 0.22
    && height >= pageHeight * 0.04
    && height > width * 2.2
}

function classifyToken(token) {
  const text = String(token.text || '').trim()
  if (!text) return 'empty'
  if (token.role === 'Rights' || token.role === 'Creator') return 'meta'
  if (token.region === 'margin' || isMarginalVerticalToken(token) || isRubricText(text)) return 'rubric'
  if (token.region === 'footer' && (isCopyrightText(text) || isPageOrSongNumber(text))) return 'meta'
  if (token.region === 'header' && (isPageOrSongNumber(text) || isTempoNumber(text))) return 'meta'
  if (MUSIC_JUNK.test(text) || OCR_GARBAGE_TOKEN.test(text)) return 'music'
  if (TEMPO_RE.test(text) || isTempoNumber(text)) return 'meta'
  if (META_RE.test(text) || isCopyrightText(text)) return 'meta'
  if (parseSectionToken(text)) return 'section'
  if (isValidChordToken(text)) return 'chord'
  if (isPageOrSongNumber(text) && (token.region === 'header' || token.region === 'footer' || token.bbox[0] < 120)) {
    return token.bbox[0] < 120 && token.region === 'lyric' ? 'verse_number' : 'meta'
  }
  if (text.length <= 2 && /[^A-Za-zÄÖÜäöüß0-9]/.test(text)) return 'music'
  if (/^[\p{L}]{1,6}-$/u.test(text)) return 'syllable'
  if (/^\d{1,3}\.?$/.test(text) && token.bbox[0] < 140) return 'verse_number'
  return 'lyric'
}

function typicalCharWidth(token) {
  const letters = String(token.text || '').replace(/\s+/g, '').length
  return Math.max(tokenWidth(token) / Math.max(letters, 1), 6)
}

function tokensAreAdjacent(previous, next) {
  if (!previous?.bbox || !next?.bbox) return false
  const gap = next.bbox[0] - previous.bbox[2]
  return gap <= Math.max(typicalCharWidth(previous) * 0.45, 5)
}

/**
 * Join lyric tokens while keeping OCR box gaps as spaces.
 * Hyphen concatenation is allowed only for adjacent syllable fragments.
 */
export function joinLyricTokens(tokens) {
  const sorted = [...tokens].sort((a, b) => (
    (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0) || tokenCenterY(a) - tokenCenterY(b)
  ))
  const chunks = []
  for (const token of sorted) {
    const text = String(token.text || '').trim()
    if (!text) continue
    if (!chunks.length) {
      chunks.push({ text, token })
      continue
    }
    const previous = chunks[chunks.length - 1]
    const gap = previous.token?.bbox && token.bbox ? token.bbox[0] - previous.token.bbox[2] : Infinity
    const adjacent = tokensAreAdjacent(previous.token, token)
    const modestGap = gap <= Math.max(typicalCharWidth(previous.token) * 1.1, 16)
    if (text === '-') {
      if ((adjacent || modestGap) && !/-$/.test(previous.text)) previous.text += '-'
      continue
    }
    const prevHyphen = /-$/.test(previous.text)
    const nextBare = text.replace(/^-/, '')
    if ((prevHyphen || /^-/.test(text)) && (adjacent || (prevHyphen && modestGap && nextBare.length <= 4))) {
      const left = previous.text.replace(/-$/, '')
      const combined = left + nextBare
      if (isProtectedWholeWord(combined) || !(
        (isClosedClassWord(left) && isClosedClassWord(nextBare))
        || (isClosedClassWord(left) && nextBare.length >= 4)
      )) {
        previous.text = combined
        previous.token = {
          ...previous.token,
          text: previous.text,
          bbox: [previous.token.bbox[0], previous.token.bbox[1], token.bbox[2], token.bbox[3]],
        }
      } else {
        previous.text = left
        chunks.push({ text: nextBare, token })
      }
      continue
    }
    if (prevHyphen && !adjacent) previous.text = previous.text.replace(/-$/, '')
    chunks.push({ text: nextBare, token })
  }
  return refineLyricText(normalizeEngravedLyrics(chunks.map((chunk) => chunk.text).join(' '))).text
}

function joinSyllables(parts) {
  const out = []
  for (const part of parts) {
    const text = part.trim()
    if (!text) continue
    if (text === '-') {
      if (out.length && !/-$/.test(out[out.length - 1])) out[out.length - 1] += '-'
      continue
    }
    if (out.length && /-$/.test(out[out.length - 1])) {
      const left = out[out.length - 1].replace(/-$/, '')
      const right = text.replace(/^-/, '')
      const combined = left + right
      if (isProtectedWholeWord(combined) || !(
        (isClosedClassWord(left) && isClosedClassWord(right))
        || (isClosedClassWord(left) && right.length >= 4)
      )) {
        out[out.length - 1] = combined
      } else {
        out[out.length - 1] = left
        out.push(right)
      }
    } else if (out.length && /^-/.test(text)) {
      out[out.length - 1] += text.replace(/^-/, '')
    } else {
      out.push(text)
    }
  }
  return refineLyricText(normalizeEngravedLyrics(out.join(' '))).text
}

function chordColumnInLyric(chord, lyricTokens, lyricText) {
  if (!lyricTokens.length) {
    const x0 = 0
    const width = 1
    const rel = (chord.bbox?.[0] ?? tokenCenterX(chord) - x0) / width
    return Math.max(0, Math.round(rel * Math.max(String(lyricText || '').length - 1, 0)))
  }

  const chordLeft = Number(chord.bbox?.[0])
  const chordX = Number.isFinite(chordLeft) ? chordLeft : tokenCenterX(chord)
  let best = lyricTokens[0]
  let bestDist = Infinity
  for (const token of lyricTokens) {
    const dist = Math.abs((token.bbox?.[0] ?? tokenCenterX(token)) - chordX)
    if (dist < bestDist) {
      best = token
      bestDist = dist
    }
  }

  let searchFrom = 0
  for (const token of lyricTokens) {
    const raw = String(token.text || '').replace(/-$/, '')
    if (!raw) continue
    let idx = lyricText.indexOf(raw, searchFrom)
    if (idx < 0) idx = lyricText.toLowerCase().indexOf(raw.toLowerCase(), searchFrom)
    if (idx < 0) {
      const x0 = lyricTokens[0].bbox[0]
      const x1 = lyricTokens[lyricTokens.length - 1].bbox[2]
      const width = Math.max(x1 - x0, 1)
      idx = Math.round(((token.bbox[0] - x0) / width) * Math.max(lyricText.length - 1, 0))
    }
    if (token === best) return Math.max(0, idx)
    searchFrom = Math.max(searchFrom, idx + raw.length)
  }

  const x0 = lyricTokens[0].bbox[0]
  const x1 = lyricTokens[lyricTokens.length - 1].bbox[2]
  const width = Math.max(x1 - x0, 1)
  const rel = (chordX - x0) / width
  return Math.max(0, Math.min(lyricText.length, Math.round(rel * Math.max(lyricText.length - 1, 0))))
}

export function placeChordsAboveLyric(chords, lyricLine, lyricText) {
  if (!chords.length || !lyricText) return { chordLine: '', lyricLine: lyricText }

  const lyricTokens = (lyricLine.tokens || []).filter((token) => {
    const kind = classifyToken(token)
    return kind === 'lyric' || kind === 'syllable' || kind === 'verse_number'
  })
  const anchors = [...chords]
    .sort((a, b) => tokenCenterX(a) - tokenCenterX(b))
    .map((chord) => ({
      chord: String(chord.text || '').trim(),
      index: chordColumnInLyric(chord, lyricTokens, lyricText),
    }))
    .filter((item) => item.chord)

  return packChordsAboveLyrics(lyricText, anchors)
}

export function computeStaffZones(systems, pageHeight) {
  return (systems || []).map((staff, index) => {
    const height = Math.max(staff.y1 - staff.y0, 12)
    const previous = systems[index - 1]
    const next = systems[index + 1]
    const gapAbove = staff.y0 - (previous ? previous.y1 : 0)
    const chordHeight = Math.min(height * 0.95, gapAbove > 40 ? gapAbove * 0.28 : height * 1.2)
    const chordY0 = staff.y0 - chordHeight
    const notationY0 = staff.y0 - height * 0.08
    const lyricY0 = staff.y1 + height * 0.12
    const nextChordHeight = next
      ? Math.min((next.y1 - next.y0) * 0.95, (next.y0 - staff.y1) * 0.28)
      : 0
    const lyricY1 = next
      ? next.y0 - nextChordHeight
      : Math.min(pageHeight * 0.92, staff.y1 + height * 4.2)
    return {
      index,
      staff,
      chord: [chordY0, notationY0],
      notation: [notationY0, lyricY0],
      lyric: [lyricY0, lyricY1],
    }
  })
}

function assignRegion(token, zones, pageWidth, pageHeight) {
  if (isMarginalVerticalToken(token) || token.bbox[0] > pageWidth * 0.93) return 'margin'
  const cy = tokenCenterY(token)
  if (!zones.length) {
    if (cy < pageHeight * 0.1) return 'header'
    if (cy > pageHeight * 0.9) return 'footer'
    return 'body'
  }
  const chordLike = isValidChordToken(token.text) || Boolean(parseSectionToken(token.text)?.trailingChord)
  if (chordLike) {
    let best = null
    let bestDist = Infinity
    for (const zone of zones) {
      const previous = zones[zone.index - 1]
      const gapAbove = zone.staff.y0 - (previous ? previous.staff.y1 : 0)
      const pad = Math.min(56, Math.max(24, gapAbove * 0.22))
      if (cy >= zone.chord[0] - pad && cy < zone.lyric[0]) {
        const dist = Math.abs(zone.staff.y0 - cy)
        if (dist < bestDist) {
          bestDist = dist
          best = zone
        }
      }
    }
    if (best) return `chord:${best.index}`
  }
  if (cy < zones[0].chord[0]) return 'header'
  if (cy > zones[zones.length - 1].lyric[1]) return 'footer'
  for (const zone of zones) {
    if (cy >= zone.chord[0] && cy < zone.notation[0]) return `chord:${zone.index}`
    if (cy >= zone.notation[0] && cy < zone.lyric[0]) return `notation:${zone.index}`
    if (cy >= zone.lyric[0] && cy <= zone.lyric[1]) return `lyric:${zone.index}`
  }
  return 'body'
}

function clusterLines(tokens, yFactor = 0.55) {
  const ordered = [...tokens].sort((a, b) => tokenCenterY(a) - tokenCenterY(b) || a.bbox[0] - b.bbox[0])
  const lines = []
  for (const token of ordered) {
    const cy = tokenCenterY(token)
    const height = tokenHeight(token)
    let found = null
    for (const line of lines) {
      if (Math.abs(cy - line.y) <= Math.max(height, line.height) * yFactor) {
        found = line
        break
      }
    }
    if (found) {
      found.tokens.push(token)
      found.y = found.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / found.tokens.length
      found.height = found.tokens.reduce((sum, item) => sum + tokenHeight(item), 0) / found.tokens.length
    } else {
      lines.push({
        tokens: [token],
        y: cy,
        height,
        pageIndex: token.page_index || 0,
      })
    }
  }
  return lines
    .map((line) => ({
      ...line,
      tokens: line.tokens.sort((a, b) => a.bbox[0] - b.bbox[0]),
    }))
    .sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y)
}

function lyricLineText(tokens) {
  const usable = tokens.filter((token) => {
    const kind = classifyToken(token)
    return kind === 'lyric' || kind === 'syllable' || kind === 'verse_number'
  })
  if (usable.some((token) => Array.isArray(token.bbox) && token.bbox.length >= 4)) {
    return joinLyricTokens(usable)
  }
  return joinSyllables(usable.map((token) => token.text))
}

function leadingVerseNumber(text) {
  const match = String(text || '').match(/^\s*([1-9])(?:\s*[.):\]-]\s*|\s+)/)
  return match ? Number(match[1]) : null
}

function stripVerseNumber(text, verseNumber) {
  let next = String(text || '').trim()
  if (verseNumber != null) {
    next = next.replace(new RegExp(`^\\s*${verseNumber}(?:\\s*[.):\\]\\-]\\s*|\\s+)`), '').trim()
  }
  // 1. often OCR'd as 9 on the first parallel track
  next = next.replace(/^\s*[89]\s+(?=[\p{L}])/u, '')
  return next
}

function collectChords(tokens) {
  const chords = []
  for (const token of joinChordSuffixFragments(tokens)) {
    const section = parseSectionToken(token.text)
    if (section?.trailingChord) {
      const [x0, y0, x1, y1] = token.bbox
      const ratio = section.trailingChord.length / Math.max(String(token.text).length, 1)
      chords.push({
        ...token,
        text: section.trailingChord,
        bbox: [x1 - (x1 - x0) * ratio, y0, x1, y1],
      })
      continue
    }
    if (classifyToken(token) === 'chord') chords.push(token)
  }
  return mergeChordCandidates(chords).chords
}

function clusterLyricTracks(tokens, pageWidth) {
  if (!tokens.length) return { tracks: [], uncertain: false }
  const long = tokens.filter((token) => tokenWidth(token) >= pageWidth * 0.22 || String(token.text || '').length >= 18)
  const seeds = (long.length ? long : tokens).sort((a, b) => tokenCenterY(a) - tokenCenterY(b))
  const tracks = []
  for (const token of seeds) {
    const cy = tokenCenterY(token)
    const existing = tracks.find((track) => Math.abs(cy - track.y) <= Math.max(tokenHeight(token), track.height) * 0.55)
    if (existing) {
      if (!existing.tokens.includes(token)) existing.tokens.push(token)
      existing.y = existing.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / existing.tokens.length
      existing.height = existing.tokens.reduce((sum, item) => sum + tokenHeight(item), 0) / existing.tokens.length
    } else if (tracks.length < 3) {
      tracks.push({ tokens: [token], y: cy, height: tokenHeight(token) })
    }
  }
  tracks.sort((a, b) => a.y - b.y)

  let uncertain = false
  for (const token of tokens) {
    if (tracks.some((track) => track.tokens.includes(token))) continue
    const cy = tokenCenterY(token)
    const overlapping = tracks.filter((track) => Math.abs(cy - track.y) <= Math.max(tokenHeight(token), track.height) * 0.85)
    let chosen = overlapping[0] || tracks[0]
    if (overlapping.length > 1) {
      const continuation = overlapping.find((track) => {
        const right = Math.max(...track.tokens.map((item) => item.bbox[2]))
        return token.bbox[0] >= right - 50 && token.bbox[0] <= right + 90
      })
      chosen = continuation || overlapping.reduce((best, track) => (
        Math.abs(cy - track.y) < Math.abs(cy - best.y) ? track : best
      ))
      if (!continuation && (String(token.text || '').length >= 8 || tokenWidth(token) > pageWidth * 0.15)) {
        uncertain = true
      }
    } else if (!overlapping.length && tracks.length) {
      chosen = tracks.reduce((best, track) => (
        Math.abs(cy - track.y) < Math.abs(cy - best.y) ? track : best
      ))
      if (String(token.text || '').length >= 8 || tokenWidth(token) > pageWidth * 0.15) uncertain = true
    }
    chosen.tokens.push(token)
  }

  return {
    tracks: tracks.map((track) => ({
      tokens: track.tokens.sort((a, b) => a.bbox[0] - b.bbox[0]),
      y: track.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / track.tokens.length,
    })),
    uncertain,
  }
}

function systemLabel(tokens) {
  const sections = tokens.map((token) => parseSectionToken(token.text)).filter(Boolean)
  return sections[0]?.label || ''
}

function buildSystemsFromStaves(tokens, staves, pageWidth, pageHeight) {
  const zones = computeStaffZones(staves, pageHeight)
  const annotated = tokens.map((token) => ({
    ...token,
    region: assignRegion(token, zones, pageWidth, pageHeight),
  }))
  const header = annotated.filter((token) => token.region === 'header')
  const footer = annotated.filter((token) => token.region === 'footer' || token.region === 'margin')
  const systems = zones.map((zone, index) => {
    const chordTokens = annotated.filter((token) => token.region === `chord:${index}` || (
      token.region === `notation:${index}` && classifyToken({ ...token, region: 'chord' }) === 'chord'
    ))
    const lyricTokens = annotated.filter((token) => {
      if (token.region !== `lyric:${index}`) return false
      const kind = classifyToken({ ...token, region: 'lyric' })
      return kind === 'lyric' || kind === 'syllable' || kind === 'verse_number'
    })
    const clustered = clusterLyricTracks(lyricTokens, pageWidth)
    const sectionTokens = [...chordTokens, ...lyricTokens]
    return {
      index,
      chords: collectChords(chordTokens.filter((token) => classifyToken(token) !== 'meta')),
      tracks: clustered.tracks,
      sectionLabel: systemLabel(sectionTokens),
      uncertain: clustered.uncertain,
      staff: zone.staff,
    }
  })
  return { systems, header, footer, annotated, usedStaves: true }
}

function isMostlyChords(tokens) {
  const classified = tokens.map(classifyToken).filter((kind) => kind !== 'empty' && kind !== 'music' && kind !== 'rubric' && kind !== 'meta')
  if (!classified.length) return false
  const chords = classified.filter((kind) => kind === 'chord').length
  return chords / classified.length >= 0.6 && chords >= 1
}

function isMostlyLyrics(tokens) {
  const classified = tokens.map((token) => ({ token, kind: classifyToken(token) }))
  const lyrics = classified.filter(({ kind }) => kind === 'lyric' || kind === 'syllable' || kind === 'verse_number')
  const chords = classified.filter(({ kind }) => kind === 'chord')
  const lyricWeight = lyrics.reduce((sum, { token }) => sum + String(token.text || '').length, 0)
  const chordWeight = chords.reduce((sum, { token }) => sum + String(token.text || '').length, 0)
  return lyrics.length >= 1 && (lyrics.length > chords.length || lyricWeight > chordWeight * 3)
}

function inferSystemsFromTokens(tokens, pageWidth, pageHeight) {
  const usable = tokens.filter((token) => {
    const kind = classifyToken(token)
    return kind !== 'rubric' && kind !== 'music' && kind !== 'empty'
  })
  const lines = clusterLines(usable, 0.6)
  const systems = []
  const header = []
  const footer = []
  let pendingSection = ''
  let i = 0
  let seenBody = false

  while (i < lines.length) {
    const line = lines[i]
    const kinds = line.tokens.map(classifyToken)
    if (kinds.every((kind) => kind === 'meta' || kind === 'rubric' || kind === 'music' || kind === 'empty')) {
      if (!seenBody) header.push(...line.tokens)
      else footer.push(...line.tokens)
      i += 1
      continue
    }
    const label = systemLabel(line.tokens)
    if (label && line.tokens.length <= 3) {
      pendingSection = label
      const extraChords = collectChords(line.tokens)
      i += 1
      if (extraChords.length && lines[i] && isMostlyLyrics(lines[i].tokens)) {
        // section+chords above upcoming lyrics
        const tracks = []
        while (i < lines.length && isMostlyLyrics(lines[i].tokens) && tracks.length < 3) {
          if (tracks.length && Math.abs(lines[i].y - tracks[tracks.length - 1].y) > lines[i].height * 3.4) break
          tracks.push(lines[i])
          i += 1
        }
        systems.push({
          index: systems.length,
          chords: extraChords,
          tracks: tracks.map((track) => ({ tokens: track.tokens, y: track.y })),
          sectionLabel: pendingSection,
          uncertain: false,
          staff: null,
        })
        pendingSection = ''
        seenBody = true
        continue
      }
      continue
    }
    if (isMostlyChords(line.tokens)) {
      const chords = collectChords(line.tokens)
      i += 1
      const tracks = []
      while (i < lines.length && isMostlyLyrics(lines[i].tokens) && tracks.length < 3) {
        if (systemLabel(lines[i].tokens)) break
        if (tracks.length && Math.abs(lines[i].y - tracks[tracks.length - 1].y) > Math.max(lines[i].height, tracks[tracks.length - 1].height) * 3.2) break
        tracks.push(lines[i])
        i += 1
      }
      systems.push({
        index: systems.length,
        chords,
        tracks: tracks.map((track) => ({ tokens: track.tokens, y: track.y })),
        sectionLabel: pendingSection,
        uncertain: false,
        staff: null,
      })
      pendingSection = ''
      seenBody = true
      continue
    }
    if (isMostlyLyrics(line.tokens)) {
      if (!seenBody && line.y < pageHeight * 0.22 && String(lyricLineText(line.tokens)).length <= 60) {
        header.push(...line.tokens)
        i += 1
        continue
      }
      systems.push({
        index: systems.length,
        chords: collectChords(line.tokens),
        tracks: [{ tokens: line.tokens, y: line.y }],
        sectionLabel: pendingSection,
        uncertain: false,
        staff: null,
      })
      pendingSection = ''
      seenBody = true
      i += 1
      continue
    }
    i += 1
  }

  return { systems, header, footer, annotated: tokens, usedStaves: false }
}

function detectTitle(headerTokens, titleHint) {
  if (titleHint) return titleHint
  const lines = clusterLines(headerTokens.filter((token) => {
    const kind = classifyToken({ ...token, region: token.region || 'header' })
    return kind === 'lyric' || kind === 'syllable'
  }), 0.5)
  for (const line of lines) {
    const text = lyricLineText(line.tokens).replace(/^\d+\s+/, '').trim()
    if (!text || isRubricText(text) || isCopyrightText(text)) continue
    const avgH = line.tokens.reduce((sum, token) => sum + tokenHeight(token), 0) / Math.max(line.tokens.length, 1)
    if (text.length <= 70 && avgH >= 18) return text
  }
  return ''
}

function trackBlocks(system, track) {
  const raw = lyricLineText(track.tokens)
  const verseNumber = leadingVerseNumber(raw)
  const lyric = stripVerseNumber(raw, verseNumber)
  if (!lyric) return { blocks: [], verseNumber }
  const placed = placeChordsAboveLyric(system.chords, { tokens: track.tokens }, lyric)
  const blocks = []
  if (placed.chordLine) blocks.push({ type: 'chords', text: placed.chordLine })
  blocks.push({ type: 'lyrics', text: placed.lyricLine })
  return { blocks, verseNumber }
}

function expandSongStructure(systems) {
  const warnings = []
  let uncertain = false
  const twoTrackCount = systems.filter((system) => system.tracks.length >= 2).length
  const hasNumberedPair = systems.some((system) => {
    const numbers = system.tracks.map((track) => leadingVerseNumber(lyricLineText(track.tokens)))
    return numbers.includes(1) && numbers.includes(2)
  })
  const parallel = twoTrackCount >= 1 && (twoTrackCount >= 2 || hasNumberedPair)

  const verseSystems = []
  const refrainSystems = []
  let seenRefrain = false
  for (const system of systems) {
    if (system.uncertain) uncertain = true
    if (/^Refrain$/i.test(system.sectionLabel)) seenRefrain = true
    if (seenRefrain) {
      refrainSystems.push(system)
      continue
    }
    if (parallel && system.tracks.length <= 1 && verseSystems.some((item) => item.tracks.length >= 2)) {
      seenRefrain = true
      refrainSystems.push(system)
      if (!system.sectionLabel) warnings.push('refrain_inferred_from_single_track')
      continue
    }
    verseSystems.push(system)
  }

  const blocks = []
  if (parallel) {
    const trackCount = Math.max(...verseSystems.map((system) => system.tracks.length), 0)
    for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
      const numbers = verseSystems
        .map((system) => system.tracks[trackIndex] && leadingVerseNumber(lyricLineText(system.tracks[trackIndex].tokens)))
        .filter((value) => value != null)
      const number = numbers[0] || trackIndex + 1
      blocks.push({ type: 'section', text: `Strophe ${number}` })
      for (const system of verseSystems) {
        const track = system.tracks[trackIndex]
        if (!track) {
          uncertain = true
          warnings.push(`missing_track_${trackIndex + 1}_in_system_${system.index}`)
          continue
        }
        blocks.push(...trackBlocks(system, track).blocks)
      }
    }
  } else {
    let lastVerseNumber = null
    for (const system of verseSystems) {
      if (system.sectionLabel && !/^Refrain$/i.test(system.sectionLabel)) {
        blocks.push({ type: 'section', text: system.sectionLabel })
        lastVerseNumber = system.sectionLabel
      }
      for (const track of system.tracks) {
        const built = trackBlocks(system, track)
        if (built.verseNumber && lastVerseNumber !== `Strophe ${built.verseNumber}`) {
          blocks.push({ type: 'section', text: `Strophe ${built.verseNumber}` })
          lastVerseNumber = `Strophe ${built.verseNumber}`
        }
        blocks.push(...built.blocks)
      }
    }
  }

  if (refrainSystems.length) {
    blocks.push({ type: 'section', text: 'Refrain' })
    for (const system of refrainSystems) {
      const track = system.tracks[0] || system.tracks.find(Boolean)
      if (!track) continue
      blocks.push(...trackBlocks(system, track).blocks)
    }
  } else if (parallel) {
    warnings.push('parallel_verses_without_labeled_refrain')
  }

  return { blocks, warnings, uncertain, parallel, repeatedRefrain: false }
}

function flattenTokens(structured) {
  const pages = structured?.pages || []
  const all = []
  const pageSystems = []
  for (const page of pages) {
    const width = page.width || 1200
    const height = page.height || 1600
    for (const token of page.tokens || []) {
      all.push({
        ...token,
        page_index: page.page_index || 0,
        page_width: width,
        page_height: height,
      })
    }
    pageSystems.push({
      pageIndex: page.page_index || 0,
      width,
      height,
      systems: page.systems || [],
    })
  }
  return { all, pageSystems }
}

export function reconstructLeadsheet(structured, { titleHint = '' } = {}) {
  const { all, pageSystems } = flattenTokens(structured)
  const models = []
  for (const page of pageSystems) {
    const tokens = all.filter((token) => (token.page_index || 0) === page.pageIndex)
    const staves = (page.systems || []).filter((staff) => staff?.y1 > staff?.y0)
    const model = staves.length
      ? buildSystemsFromStaves(tokens, staves, page.width, page.height)
      : inferSystemsFromTokens(tokens, page.width, page.height)
    models.push({ ...model, width: page.width, height: page.height })
  }

  const header = models.flatMap((model) => model.header)
  const systems = models.flatMap((model, pageIndex) => model.systems.map((system) => ({
    ...system,
    pageIndex,
  })))
  const title = detectTitle(header, titleHint)
  const expanded = expandSongStructure(systems)
  const body = []
  for (const block of expanded.blocks) {
    if (block.type === 'section') {
      if (body.length) body.push('')
      body.push(`[${block.text}]`)
    } else {
      body.push(block.text)
    }
  }

  let text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (title && !text.toLowerCase().startsWith(title.toLowerCase())) {
    text = `${title}\n\n${text}`.trim()
  }
  text = cleanOcrText(text)
  let lyricUncertain = false
  text = text.split('\n').map((line) => {
    if (isChordLine(line)) return line
    if (!/[\p{L}]{3,}/u.test(line)) return line
    const refined = refineLyricText(line)
    lyricUncertain = lyricUncertain || refined.uncertain
    return refined.text
  }).join('\n')
  text = softFormatChordChart(text)
  const lyricRefine = { text, uncertain: lyricUncertain }

  const confidences = all.map((token) => Number(token.confidence) || 0).filter((value) => value > 0)
  const avgConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0
  const quality = scoreLeadsheetQuality(text)
  const chordTokensInText = text.split(/\s+/).filter(isValidChordToken)
  const falseChordCandidates = all
    .filter((token) => /^[A-Ga-g]/.test(token.text) && !isValidChordToken(token.text) && classifyToken(token) !== 'lyric')
    .map((token) => token.text)
  const usedStaves = models.some((model) => model.usedStaves)
  const emptyStaffCount = systems.filter((system) => system.staff && !system.tracks.length).length
  const chordConflicts = systems.some((system) => (system.chords || []).some((chord) => chord.chordUncertain))
  const reviewReasons = [
    quality.needsReview ? 'quality' : '',
    avgConfidence > 0 && avgConfidence < 0.55 ? 'low_confidence' : '',
    quality.chordLineCount === 0 && quality.lyricLineCount < 2 ? 'sparse_content' : '',
    expanded.uncertain ? 'uncertain_track_assignment' : '',
    emptyStaffCount > 1 ? 'empty_staff_systems' : '',
    lyricRefine.uncertain ? 'orthography_uncertain' : '',
    chordConflicts ? 'chord_conflict' : '',
  ].filter(Boolean)
  const needsReview = reviewReasons.length > 0

  const layout = {
    staffSystems: systems.filter((system) => system.staff).length,
    inferredSystems: systems.filter((system) => !system.staff).length,
    parallelVerseTracks: expanded.parallel
      ? Math.max(...systems.map((system) => system.tracks.length), 0)
      : 0,
    repeatedRefrain: false,
    usedStaves,
    warnings: expanded.warnings,
  }

  return {
    text,
    title,
    engine: structured?.engine || 'unknown',
    avgConfidence: Number(avgConfidence.toFixed(3)),
    quality: {
      ...quality,
      needsReview,
      avgConfidence: Number(avgConfidence.toFixed(3)),
      validChordCount: chordTokensInText.length,
      falseChordCandidates: [...new Set(falseChordCandidates)].slice(0, 20),
      elapsedMs: structured?.elapsed_ms || null,
      reviewReasons,
      layout,
    },
    needsReview,
    blocks: expanded.blocks,
    layout,
  }
}


/** Chord suffix fragments often split by PDF text extractors (A + sus, Em + 7). */
const CHORD_SUFFIX_FRAG_RE = /^(?:sus\d*|add\d*|maj\d*|min\d*|dim\d*|aug\d*|m\d*|\d{0,2}(?:\([^)]{1,12}\))?|[b#+\-°]{1,3}\d*)$/i

export function isChordSuffixFragment(raw) {
  const text = String(raw || '').trim()
  if (!text || isValidChordToken(text)) return false
  return CHORD_SUFFIX_FRAG_RE.test(text)
}

/**
 * Join adjacent root+suffix PDF tokens into full chords (A+sus→Asus, Em+7→Em7).
 * Operates on token objects with .text and .bbox.
 */
export function joinChordSuffixFragments(tokens) {
  const prepared = [...(tokens || [])].map((token) => ({
    ...token,
    text: String(token.text || '').trim(),
  })).filter((token) => token.text)
  // Cluster into visual lines first so A+sus (slight y jitter) still joins left→right.
  const lines = []
  for (const token of prepared.sort((a, b) => tokenCenterY(a) - tokenCenterY(b) || tokenCenterX(a) - tokenCenterX(b))) {
    const cy = tokenCenterY(token)
    const line = lines.find((entry) => Math.abs(entry.y - cy) <= Math.max(tokenHeight(token), 8) * 0.75)
    if (line) {
      line.tokens.push(token)
      line.y = line.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / line.tokens.length
    } else {
      lines.push({ y: cy, tokens: [token] })
    }
  }
  const out = []
  for (const line of lines) {
    const row = line.tokens.sort((a, b) => tokenCenterX(a) - tokenCenterX(b))
    for (let i = 0; i < row.length; i += 1) {
      const cur = row[i]
      const next = row[i + 1]
      if (next && isValidChordToken(cur.text) && isChordSuffixFragment(next.text)) {
        const gap = next.bbox[0] - cur.bbox[2]
        const adjacent = gap <= Math.max(typicalCharWidth(cur) * 1.6, 14)
        if (adjacent) {
          const mergedText = `${cur.text}${next.text}`.replace(/\s+/g, '')
          if (isValidChordToken(mergedText)) {
            out.push({
              ...cur,
              text: mergedText,
              bbox: [cur.bbox[0], Math.min(cur.bbox[1], next.bbox[1]), next.bbox[2], Math.max(cur.bbox[3], next.bbox[3])],
            })
            i += 1
            continue
          }
        }
      }
      out.push(cur)
    }
  }
  return out
}

/**
 * Parse pdftotext -bbox / -bbox-layout XHTML into structured OCR-like pages.
 */
export function parsePdfBBoxDocument(xml) {
  const raw = String(xml || '')
  const pages = []
  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi
  let pageMatch
  let pageIndex = 0
  while ((pageMatch = pageRe.exec(raw))) {
    const attrs = pageMatch[1] || ''
    const body = pageMatch[2] || ''
    const width = Number((attrs.match(/\bwidth="([\d.]+)"/i) || [])[1] || 0)
    const height = Number((attrs.match(/\bheight="([\d.]+)"/i) || [])[1] || 0)
    const tokens = []
    const wordRe = /<word\b([^>]*)>([^<]*)<\/word>/gi
    let wordMatch
    let lineIndex = 0
    let lastY = null
    while ((wordMatch = wordRe.exec(body))) {
      const a = wordMatch[1] || ''
      const text = String(wordMatch[2] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
      if (!text) continue
      const xMin = Number((a.match(/\bxMin="([\d.]+)"/i) || [])[1] || 0)
      const yMin = Number((a.match(/\byMin="([\d.]+)"/i) || [])[1] || 0)
      const xMax = Number((a.match(/\bxMax="([\d.]+)"/i) || [])[1] || 0)
      const yMax = Number((a.match(/\byMax="([\d.]+)"/i) || [])[1] || 0)
      if (lastY == null || Math.abs(yMin - lastY) > 6) {
        lineIndex += 1
        lastY = yMin
      }
      tokens.push({
        text,
        bbox: [xMin, yMin, xMax, yMax],
        confidence: 0.99,
        line_index: lineIndex,
        page_index: pageIndex,
        page_width: width,
        page_height: height,
        source: 'pdftotext-bbox',
      })
    }
    pages.push({
      page_index: pageIndex,
      width: width || 595,
      height: height || 842,
      tokens: joinChordSuffixFragments(tokens),
    })
    pageIndex += 1
  }
  return {
    engine: 'pdftotext-bbox',
    elapsed_ms: null,
    pages,
  }
}

/**
 * Split wide SongSelect pages into left/right virtual pages by X gap, then
 * reconstruct each column in reading order (left column block, then right).
 */
export function splitBBoxPagesByColumns(structured) {
  const pages = []
  for (const page of structured.pages || []) {
    const tokens = page.tokens || []
    if (tokens.length < 8) {
      pages.push(page)
      continue
    }
    const width = page.width || Math.max(...tokens.map((t) => t.bbox[2]), 1)

    // Prefer gutter just left of the right-column section header (SongSelect).
    const sectionTokens = tokens.filter((token) => /^(?:VERSE|CHORUS|BRIDGE|REFRAIN|STROPH|VERS|INTRO|OUTRO)/i.test(String(token.text || '').trim()))
    let splitX = null
    if (sectionTokens.length >= 2) {
      const leftSecs = sectionTokens.filter((token) => tokenCenterX(token) <= width * 0.45)
      const rightSecs = sectionTokens.filter((token) => tokenCenterX(token) > width * 0.45)
      if (leftSecs.length && rightSecs.length) {
        const rightStart = Math.min(...rightSecs.map((token) => token.bbox[0]))
        const leftCandidates = tokens.filter((token) => token.bbox[2] < rightStart - 8)
        const leftEnd = leftCandidates.length
          ? Math.max(...leftCandidates.map((token) => token.bbox[2]))
          : rightStart - 40
        if (rightStart - leftEnd >= 12) splitX = (leftEnd + rightStart) / 2
        else splitX = rightStart - 10
      }
    }

    // Fallback: x that minimizes tokens crossing a vertical gutter in the mid band.
    if (splitX == null) {
      let best = null
      for (let x = width * 0.34; x <= width * 0.68; x += Math.max(width * 0.008, 4)) {
        const crossing = tokens.filter((token) => token.bbox[0] < x && token.bbox[2] > x).length
        const left = tokens.filter((token) => tokenCenterX(token) < x).length
        const right = tokens.filter((token) => tokenCenterX(token) >= x).length
        if (left < 8 || right < 8) continue
        const score = crossing * 1000 - Math.min(left, right)
        if (!best || score < best.score) best = { x, score, crossing, left, right }
      }
      if (best && best.crossing <= Math.max(3, tokens.length * 0.02)) splitX = best.x
    }

    if (splitX == null) {
      pages.push(page)
      continue
    }

    const left = tokens.filter((t) => tokenCenterX(t) < splitX).map((t) => ({ ...t, page_width: splitX }))
    const right = tokens.filter((t) => tokenCenterX(t) >= splitX).map((t) => ({
      ...t,
      bbox: [Math.max(0, t.bbox[0] - splitX), t.bbox[1], Math.max(0, t.bbox[2] - splitX), t.bbox[3]],
      page_width: width - splitX,
    }))
    if (left.length >= 4) pages.push({ ...page, width: splitX, tokens: left, column: 'left' })
    if (right.length >= 4) {
      pages.push({
        ...page,
        page_index: (page.page_index || 0) + 0.5,
        width: width - splitX,
        tokens: right,
        column: 'right',
      })
    }
    if (left.length < 4 && right.length < 4) pages.push(page)
  }
  return {
    ...structured,
    pages: pages.map((page, index) => ({
      ...page,
      page_index: index,
      tokens: (page.tokens || []).map((token) => ({ ...token, page_index: index })),
    })),
  }
}

/**
 * Reconstruct a lead sheet from pdftotext -bbox XHTML (SongSelect and similar).
 */

function clusterTokensIntoRows(tokens, yTol = 7) {
  const rows = []
  const sorted = [...tokens].sort((a, b) => tokenCenterY(a) - tokenCenterY(b) || tokenCenterX(a) - tokenCenterX(b))
  for (const token of sorted) {
    const cy = tokenCenterY(token)
    const row = rows.find((entry) => Math.abs(entry.y - cy) <= yTol)
    if (row) {
      row.tokens.push(token)
      row.y = row.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / row.tokens.length
    } else {
      rows.push({ y: cy, tokens: [token] })
    }
  }
  return rows
    .map((row) => ({
      y: row.y,
      tokens: row.tokens.sort((a, b) => tokenCenterX(a) - tokenCenterX(b)),
    }))
    .sort((a, b) => a.y - b.y)
}

function rowIsChordRow(tokens) {
  const usable = tokens.filter((token) => String(token.text || '').trim())
  if (!usable.length) return false
  let chordish = 0
  for (const token of usable) {
    const text = String(token.text || '').trim()
    if (isValidChordToken(text) || isChordSuffixFragment(text) || text === '/' || /^[1-9]$/.test(text) && usable.some((item) => /VERSE|CHORUS|STROPH/i.test(item.text))) {
      chordish += 1
    }
  }
  return chordish / usable.length >= 0.6
}

function rowIsSectionRow(tokens) {
  const text = tokens.map((token) => token.text).join(' ').trim()
  return Boolean(parseSectionToken(text.split(/\s+/).slice(0, 2).join(' ')) || /^(?:VERSE|CHORUS|BRIDGE|REFRAIN|STROPH|VERS)\b/i.test(text))
}

function packColumnFromBBoxTokens(tokens, { titleHint = '' } = {}) {
  const rows = clusterTokensIntoRows(joinChordSuffixFragments(tokens))
  const out = []
  let pendingChords = []
  let sawBody = false

  const flushChords = (lyricTokens) => {
    const lyricText = joinLyricTokens(lyricTokens)
    if (!lyricText) return
    if (pendingChords.length) {
      const placed = placeChordsAboveLyric(pendingChords, { tokens: lyricTokens }, lyricText)
      if (placed.chordLine.trim()) out.push(placed.chordLine)
      out.push(placed.lyricLine)
      pendingChords = []
    } else {
      out.push(lyricText)
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const texts = row.tokens.map((token) => String(token.text || '').trim()).filter(Boolean)
    const joined = texts.join(' ')
    if (!joined) continue

    if (!sawBody && (META_RE.test(joined) || TEMPO_RE.test(joined) || /\bKey\b|\bTempo\b|\bTime\b|\bBPM\b/i.test(joined))) {
      continue
    }
    if (rowIsSectionRow(row.tokens)) {
      if (pendingChords.length) {
        out.push(pendingChords.map((chord) => chord.text).join(' '))
        pendingChords = []
      }
      const label = parseSectionToken(joined)?.label || joined.replace(/:$/, '')
      if (out.length) out.push('')
      out.push(`[${label}]`)
      sawBody = true
      continue
    }
    if (rowIsChordRow(row.tokens)) {
      const chords = collectChords(row.tokens)
      // If we already emitted a lyric and these chords have no lyric beneath,
      // attach them to the previous lyric instead of carrying into the next line.
      const next = rows[i + 1]
      const nextIsLyric = next && !rowIsChordRow(next.tokens) && !rowIsSectionRow(next.tokens)
      if (chords.length && !nextIsLyric && out.length) {
        let lyricIdx = -1
        let chordIdx = -1
        for (let j = out.length - 1; j >= 0; j -= 1) {
          if (!out[j].trim()) continue
          // previous lyric is last non-chord-ish line
          const looksChord = out[j].replace(/[\s|/().]/g, '').length > 0 && !/[a-zäöü]{3,}/u.test(out[j])
          if (!looksChord) {
            lyricIdx = j
            if (j > 0) chordIdx = j - 1
            break
          }
        }
        if (lyricIdx >= 0) {
          const lyric = out[lyricIdx]
          const existing = chordIdx >= 0 ? out[chordIdx] : ''
          const extras = chords.map((chord) => chord.text)
          const target = Math.max(lyric.length + 1, existing.length + 1)
          const pad = Math.max(1, target - existing.length)
          const merged = `${existing}${' '.repeat(pad)}${extras.join(' ')}`.replace(/\s+$/g, '')
          if (chordIdx >= 0) out[chordIdx] = merged
          else out.splice(lyricIdx, 0, merged)
          sawBody = true
          continue
        }
      }
      if (chords.length) pendingChords.push(...chords)
      sawBody = true
      continue
    }
    // lyric row
    flushChords(row.tokens)
    sawBody = true
  }
  if (pendingChords.length) {
    out.push(pendingChords.map((chord) => chord.text).join(' '))
  }

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (titleHint && text && !text.toLowerCase().startsWith(String(titleHint).toLowerCase().slice(0, 12))) {
    // keep natural title if present at top of tokens
  }
  return softFormatChordChart(text)
}

export function reconstructFromPdfBBox(xml, { titleHint = '' } = {}) {
  const parsed = parsePdfBBoxDocument(xml)
  const structured = splitBBoxPagesByColumns(parsed)
  if (!structured.pages.length || !structured.pages.some((p) => p.tokens?.length)) {
    return {
      text: '',
      title: '',
      engine: 'pdftotext-bbox',
      avgConfidence: null,
      quality: scoreLeadsheetQuality(''),
      needsReview: true,
    }
  }

  const allTokens = (parsed.pages || []).flatMap((page) => page.tokens || [])
  const height = parsed.pages[0]?.height || 900
  const top = allTokens.filter((token) => tokenCenterY(token) < height * 0.12)
  const topText = top.map((token) => token.text).join(' ')
  const titleToken = top.find((token) => String(token.text || '').length > 8 && tokenCenterY(token) < height * 0.07)
  const title = titleHint || (titleToken ? joinLyricTokens(top.filter((token) => Math.abs(tokenCenterY(token) - tokenCenterY(titleToken)) < 8)) : '')
  const keyMatch = topText.match(/\bKey\s*[-–:]\s*([A-H][#b]?m?)/i)
  const tempoMatch = topText.match(/\bTempo\s*[-–:=]\s*(\d{2,3})/i) || topText.match(/\bBPM\s*[-–:=]?\s*(\d{2,3})/i)
  const timeMatch = topText.match(/\bTime\s*[-–:]\s*([0-9]+\/[0-9]+)/i)
  const metaParts = []
  if (keyMatch) metaParts.push(`Key - ${keyMatch[1]}`)
  if (tempoMatch) metaParts.push(`Tempo - ${tempoMatch[1]}`)
  if (timeMatch) metaParts.push(`Time - ${timeMatch[1]}`)

  const bodies = structured.pages.map((page) => packColumnFromBBoxTokens(page.tokens || [], { titleHint }))
  let text = bodies.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  const header = []
  if (title) header.push(title)
  if (metaParts.length) header.push(metaParts.join(' | '))
  if (header.length) text = `${header.join('\n\n')}\n\n${text}`.replace(/\n{3,}/g, '\n\n').trim()
  text = softFormatChordChart(text)
  const quality = scoreLeadsheetQuality(text)
  return {
    text,
    title: title || '',
    engine: 'pdftotext-bbox',
    avgConfidence: 0.99,
    quality,
    needsReview: quality.needsReview,
  }
}

export function reconstructFromFlatText(text) {
  const cleaned = softFormatChordChart(deinterleaveTwoColumnLayout(cleanOcrText(text)))
  const quality = scoreLeadsheetQuality(cleaned)
  return {
    text: cleaned,
    title: '',
    engine: 'flat-text',
    avgConfidence: null,
    quality,
    needsReview: quality.needsReview,
    blocks: cleaned.split('\n').map((line) => ({
      type: isChordLine(line) ? 'chords' : 'lyrics',
      text: line,
    })),
  }
}
