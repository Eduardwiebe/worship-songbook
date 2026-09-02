/**
 * Musical page understanding from structured OCR tokens + optional staff systems.
 *
 * OCR tokens are raw data (text, bbox, confidence). Reading order is never
 * copied as song text. Reconstruction assigns every token to a page region,
 * uses staff geometry when present, and keeps parallel lyric tracks separate.
 */

import { chordPattern, cleanOcrText, isChordLine, pitchMap, scoreLeadsheetQuality } from './leadsheetAnalysis.mjs'

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
  const text = String(raw || '').trim()
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
  let previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(new RegExp(`(\\p{L}{1,8})\\s+${dash}\\s+(\\p{L}{1,8})`, 'gu'), '$1$2')
    text = text.replace(new RegExp(`(\\p{L}{1,8})${dash}\\s+(\\p{L}{1,8})`, 'gu'), '$1$2')
    text = text.replace(new RegExp(`(\\p{L}{1,8})\\s+${dash}(\\p{L}{1,8})`, 'gu'), '$1$2')
  }

  previous = ''
  while (text !== previous) {
    previous = text
    text = text.replace(new RegExp(`(\\p{L}{1,6})${dash}(\\p{Ll}{1,6})`, 'gu'), (full, left, right) => {
      if (/\d/.test(left) || /\d/.test(right)) return full
      if (/^\p{Lu}$/u.test(left)) return full
      return `${left}${right}`
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
      out[out.length - 1] = out[out.length - 1].replace(/-$/, '') + text.replace(/^-/, '')
    } else if (out.length && /^-/.test(text)) {
      out[out.length - 1] += text.replace(/^-/, '')
    } else {
      out.push(text)
    }
  }
  return normalizeEngravedLyrics(out.join(' '))
}

export function placeChordsAboveLyric(chords, lyricLine, lyricText) {
  if (!chords.length || !lyricText) return { chordLine: '', lyricLine: lyricText }

  const lyricTokens = (lyricLine.tokens || []).filter((token) => {
    const kind = classifyToken(token)
    return kind === 'lyric' || kind === 'syllable' || kind === 'verse_number'
  })
  const x0 = lyricTokens.length
    ? Math.min(...lyricTokens.map((token) => token.bbox[0]))
    : lyricLine.tokens[0]?.bbox[0] || 0
  const x1 = lyricTokens.length
    ? Math.max(...lyricTokens.map((token) => token.bbox[2]))
    : lyricLine.tokens[lyricLine.tokens.length - 1]?.bbox[2] || 1
  const width = Math.max(x1 - x0, 1)
  const targetLen = Math.max(lyricText.length, 8)
  const slots = Array.from({ length: targetLen }, () => ' ')
  const sorted = [...chords].sort((a, b) => tokenCenterX(a) - tokenCenterX(b))

  for (const chord of sorted) {
    const rel = (tokenCenterX(chord) - x0) / width
    let pos = Math.round(Math.max(0, Math.min(1, rel)) * (targetLen - 1))
    const label = chord.text.trim()
    while (pos > 0 && slots.slice(pos, pos + label.length).some((char) => char !== ' ')) {
      pos += 1
      if (pos + label.length > slots.length) {
        slots.push(...Array.from({ length: label.length + 2 }, () => ' '))
      }
    }
    while (pos + label.length > slots.length) slots.push(' ')
    for (let i = 0; i < label.length; i += 1) slots[pos + i] = label[i]
  }

  return {
    chordLine: slots.join('').replace(/\s+$/g, ''),
    lyricLine: lyricText,
  }
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
  for (const token of tokens) {
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
  const sorted = [...chords].sort((a, b) => tokenCenterX(a) - tokenCenterX(b) || tokenCenterY(b) - tokenCenterY(a))
  const out = []
  for (const chord of sorted) {
    const previous = out[out.length - 1]
    if (previous && Math.abs(tokenCenterX(previous) - tokenCenterX(chord)) < 24) {
      const preferCurrent = tokenCenterY(chord) > tokenCenterY(previous) || chord.text.length > previous.text.length
      if (preferCurrent) out[out.length - 1] = chord
      continue
    }
    out.push(chord)
  }
  return out
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
  const reviewReasons = [
    quality.needsReview ? 'quality' : '',
    avgConfidence > 0 && avgConfidence < 0.55 ? 'low_confidence' : '',
    quality.chordLineCount === 0 && quality.lyricLineCount < 2 ? 'sparse_content' : '',
    expanded.uncertain ? 'uncertain_track_assignment' : '',
    emptyStaffCount > 1 ? 'empty_staff_systems' : '',
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

export function reconstructFromFlatText(text) {
  const cleaned = cleanOcrText(text)
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
