/**
 * SongSelect lead sheets print two verses under one staff (row "1." and row "2.")
 * with one shared chord line, then a chorus once.
 *
 * Akkordansicht must sing Strophe 1 → Refrain → Strophe 2 → Refrain.
 * Syllables from the two verses are never zipper-merged onto one line.
 * LeadSheet / MusicXML does not use this module.
 */

import { chordPattern, parseTempoBpm } from './leadsheetAnalysis.mjs'
import { isMetadataText } from './songMetadata.mjs'
import { normalizeChordGlyphs } from './ocrTextRefine.mjs'
import {
  isChordViewNoiseLine,
  isCreditLine,
  lexiconJoinedWord,
  mergeSyllabicLyricLine,
} from './chordViewText.mjs'

const SECTION_RE = /^(?:\[)?\s*(verse|strophe|vers|chorus|refrain|ref|bridge|intro|outro)\b/i
const SHARP_RE = /[\uE000-\uF8FF♯＃#]/

function isChordToken(raw) {
  const text = normalizeChordGlyphs(String(raw || '').replace(SHARP_RE, '#').replace(/#+$/, (hash) => (hash.length > 1 ? '#' : hash)))
  if (!text || text.length > 18 || /^[0-9]+$/.test(text)) return false
  const matches = [...text.matchAll(new RegExp(chordPattern.source, 'gu'))]
  return matches.length === 1 && matches[0][0] === text
}

function normalizeChordText(raw) {
  return normalizeChordGlyphs(String(raw || '').replace(SHARP_RE, '#'))
}

function isSharpToken(raw) {
  return /^[\uE000-\uF8FF♯＃#]$/u.test(String(raw || '').trim())
}

function isBarNumber(raw) {
  return /^\d{1,3}$/.test(String(raw || '').trim())
}

function tokenCenterY(token) {
  const box = token.bbox || [0, 0, 0, 0]
  return (box[1] + box[3]) / 2
}

function clusterRows(tokens, tol = 5) {
  const rows = []
  const sorted = [...tokens].sort((a, b) => tokenCenterY(a) - tokenCenterY(b) || a.bbox[0] - b.bbox[0])
  for (const token of sorted) {
    const cy = tokenCenterY(token)
    const row = rows.find((entry) => Math.abs(entry.y - cy) <= tol)
    if (row) {
      row.tokens.push(token)
      row.y = row.tokens.reduce((sum, item) => sum + tokenCenterY(item), 0) / row.tokens.length
    } else {
      rows.push({ y: cy, tokens: [token] })
    }
  }
  return rows.map((row) => ({
    y: row.y,
    tokens: row.tokens.sort((a, b) => a.bbox[0] - b.bbox[0]),
  }))
}

function mergeSharpRows(rows) {
  const out = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const sharpOnly = row.tokens.length > 0 && row.tokens.every((token) => isSharpToken(token.text))
    if (sharpOnly) {
      const host = out[out.length - 1]
      if (host && row.y - host.y < 16 && row.y >= host.y) {
        host.tokens.push(...row.tokens)
        host.tokens.sort((a, b) => a.bbox[0] - b.bbox[0])
        continue
      }
    }
    out.push({ ...row, tokens: [...row.tokens] })
  }
  return out
}

function rowText(tokens) {
  return tokens.map((token) => String(token.text || '').trim()).filter(Boolean).join(' ')
}

function attachSharps(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const next = tokens[i + 1]
    if (isBarNumber(token.text) || isSharpToken(token.text)) continue
    if (next && isSharpToken(next.text)) {
      const text = normalizeChordText(`${token.text}#`)
      if (isChordToken(text)) {
        out.push({
          ...token,
          text,
          bbox: [token.bbox[0], token.bbox[1], next.bbox[2], Math.max(token.bbox[3], next.bbox[3])],
        })
        i += 1
        continue
      }
    }
    const text = normalizeChordText(token.text)
    out.push({ ...token, text })
  }
  return out
}

function withoutCreditSuffix(tokens) {
  const text = rowText(tokens)
  if (!isMetadataText(text) && !isCreditLine(text) && !isChordViewNoiseLine(text)) return tokens
  const cut = tokens.findIndex((token) => /^(?:text|words|lyrics|musik|music|melodie|ccli|©)$/i.test(String(token.text || '').replace(/[.:]+$/g, '')))
  if (cut > 2) return tokens.slice(0, cut)
  return null
}

function classifyRow(row) {
  let tokens = attachSharps(row.tokens.filter((token) => !isBarNumber(token.text)))
  const kept = withoutCreditSuffix(tokens)
  if (!kept) return { ...row, kind: 'skip', tokens }
  tokens = kept
  const text = rowText(tokens)
  if (!text) return { ...row, kind: 'skip', tokens }
  if (isChordViewNoiseLine(text) || /^♩?\s*=\s*\d{2,3}$/.test(text.replace(/[^\d=]/g, '').replace(/=+/, '='))) {
    return { ...row, kind: 'skip', tokens }
  }
  if (parseTempoBpm(text) && text.replace(/[^\d]/g, '').length <= 3 && !/[a-zäöü]{3,}/iu.test(text)) {
    return { ...row, kind: 'skip', tokens }
  }
  if (SECTION_RE.test(text) && tokens.length <= 3) {
    const label = /chorus|refrain|ref/i.test(text) ? 'Refrain' : 'Strophe'
    return { ...row, kind: 'section', label, tokens }
  }
  const chords = tokens.filter((token) => isChordToken(token.text))
  if (chords.length && chords.length / tokens.length >= 0.6) {
    return { ...row, kind: 'chords', tokens: chords }
  }
  if (/[\p{L}]/u.test(text)) return { ...row, kind: 'lyrics', tokens }
  return { ...row, kind: 'skip', tokens }
}

function verseNumber(tokens) {
  const first = String(tokens[0]?.text || '').trim()
  const match = first.match(/^([1-9])\.$/) || first.match(/^([1-9])\.\s+\S/)
  if (match) return Number(match[1])
  if (/^[1-9]$/.test(first) && tokens[1] && /[\p{L}]/u.test(tokens[1].text)) return Number(first)
  return null
}

function gapThreshold(tokens) {
  const maxX = Math.max(...tokens.map((token) => token.bbox?.[2] || 0), 0)
  return maxX > 250 ? 70 : 12
}

function buildSystems(rows) {
  const systems = []
  let chords = []
  let lyrics = []
  let sawChorus = false
  const flush = () => {
    if (!lyrics.length) return
    systems.push({ chords: [...chords], lyrics: lyrics.map((row) => ({ tokens: [...row.tokens] })), refrain: false })
    chords = []
    lyrics = []
  }
  for (const row of rows) {
    if (row.kind === 'section') {
      if (row.label === 'Refrain') sawChorus = true
      continue
    }
    if (row.kind === 'chords') {
      if (lyrics.length) flush()
      chords = row.tokens
      continue
    }
    if (row.kind !== 'lyrics') continue
    if (lyrics.length >= 2) flush()
    lyrics.push(row)
  }
  flush()
  return { systems, sawChorus }
}

function numberedPair(system) {
  const numbers = system.lyrics.map((row) => verseNumber(row.tokens))
  return numbers.includes(1) && numbers.includes(2)
}

function orderTracks(system) {
  const numbered = system.lyrics.every((row) => verseNumber(row.tokens))
  const lyrics = numbered
    ? [...system.lyrics].sort((a, b) => verseNumber(a.tokens) - verseNumber(b.tokens))
    : system.lyrics
  return { ...system, lyrics }
}

function joinWrappedSyllables(systems) {
  for (let track = 0; track < 2; track += 1) {
    for (let i = 0; i < systems.length - 1; i += 1) {
      const left = systems[i].lyrics[track]
      const right = systems[i + 1].lyrics[track]
      if (!left?.tokens?.length || !right?.tokens?.length) continue
      const last = left.tokens[left.tokens.length - 1]
      const first = right.tokens[0]
      const joined = lexiconJoinedWord(last.text, first.text)
      if (!joined) continue
      right.tokens.shift()
      last.text = joined
    }
  }
}

function peelChorusPickup(system, gap) {
  const pickups = []
  for (const track of system.lyrics) {
    const tokens = track.tokens
    let cut = -1
    let best = 0
    for (let i = 1; i < tokens.length; i += 1) {
      const hole = tokens[i].bbox[0] - tokens[i - 1].bbox[2]
      if (hole > best) {
        best = hole
        cut = i
      }
    }
    if (cut < 1 || best < gap || tokens.length - cut > 3) continue
    const rightX = tokens[cut].bbox[0]
    const covered = system.lyrics.some((other) => other !== track && other.tokens.some((token) => token.bbox[0] >= rightX - gap * 0.4))
    if (covered) continue
    const right = tokens.slice(cut)
    track.tokens = tokens.slice(0, cut)
    const stay = []
    const moved = []
    for (const chord of system.chords) {
      if (chord.bbox[0] >= rightX - 4) moved.push(chord)
      else stay.push(chord)
    }
    system.chords = stay
    pickups.push({ tokens: right, chords: moved })
  }
  return pickups
}

function prependPickup(system, pickup) {
  if (!system?.lyrics?.[0] || !pickup?.tokens?.length) return
  system.lyrics[0] = { tokens: [...pickup.tokens, ...system.lyrics[0].tokens] }
  system.chords = [...pickup.chords, ...system.chords]
}

function renderPair(chords, tokens) {
  let text = ''
  const starts = []
  for (const token of tokens) {
    const raw = String(token.text || '').trim().replace(/^\d+\.\s*/, '')
    if (!raw || /^\d+\.$/.test(raw)) continue
    if (text) text += ' '
    starts.push({ token, index: text.length })
    text += raw
  }
  if (!text) return null
  const merged = mergeSyllabicLyricLine(text)
  const anchors = []
  for (const chord of chords) {
    if (!starts.length) break
    const x = chord.bbox[0]
    let best = starts[0]
    let bestDist = Infinity
    for (const start of starts) {
      const left = start.token.bbox[0]
      const right = start.token.bbox[2]
      const dist = x < left ? left - x : (x > right ? x - right : 0)
      if (dist < bestDist) {
        bestDist = dist
        best = start
      }
    }
    const index = merged.map?.[Math.min(best.index, (merged.map?.length || 1) - 1)] ?? best.index
    anchors.push({ chord: chord.text, index, x: chord.bbox[0] })
  }
  return packChordLine(merged.text, anchors)
}

function packChordLine(lyricLine, anchors) {
  const slots = Array.from({ length: Math.max(lyricLine.length, 1) }, () => ' ')
  let occupiedUntil = -1
  const sorted = anchors.filter((item) => item.chord).sort((a, b) => a.index - b.index || (a.x || 0) - (b.x || 0))
  for (const item of sorted) {
    let pos = Math.max(0, item.index)
    if (pos < occupiedUntil) pos = occupiedUntil
    while (slots.slice(pos, pos + item.chord.length).some((ch) => ch !== ' ')) pos += 1
    while (pos + item.chord.length > slots.length) slots.push(' ')
    for (let i = 0; i < item.chord.length; i += 1) slots[pos + i] = item.chord[i]
    occupiedUntil = pos + item.chord.length + 1
  }
  return { chordLine: slots.join('').replace(/\s+$/g, ''), lyricLine }
}

function renderSystems(systems, trackIndex) {
  const lines = []
  for (const system of systems) {
    const lyric = system.lyrics[trackIndex] || system.lyrics[0]
    if (!lyric) continue
    const pair = renderPair(system.chords, lyric.tokens)
    if (!pair?.lyricLine) continue
    if (pair.chordLine.trim()) lines.push(pair.chordLine)
    lines.push(pair.lyricLine)
  }
  return lines
}

function headerTitle(rows) {
  const firstChord = rows.find((row) => row.kind === 'chords')
  const limit = firstChord ? firstChord.y : Infinity
  const candidates = rows.filter((row) => row.kind === 'lyrics' && row.y < limit && !verseNumber(row.tokens))
  if (!candidates.length) return ''
  candidates.sort((a, b) => rowText(b.tokens).length - rowText(a.tokens).length)
  const title = rowText(candidates[0].tokens).replace(/\s+/g, ' ').trim()
  return title.length >= 8 ? title : ''
}

/**
 * Expand bbox tokens from a SongSelect dual-verse lead sheet.
 * @returns {{ text: string, title: string, bpm: number|null }|null}
 */
export function expandSongSelectFromTokens(tokens) {
  const list = (tokens || []).filter((token) => token?.bbox && String(token.text || '').trim())
  if (list.length < 8) return null
  const rows = mergeSharpRows(clusterRows(list)).map(classifyRow)
  const title = headerTitle(rows)
  const bpm = parseTempoBpm(list.map((token) => token.text).join(' '))
  const bodyRows = rows.filter((row) => {
    if (row.kind !== 'lyrics') return row.kind === 'chords' || row.kind === 'section'
    const firstChord = rows.find((item) => item.kind === 'chords')
    if (firstChord && row.y < firstChord.y) return false
    return true
  })
  const { systems, sawChorus } = buildSystems(bodyRows)
  const parallel = []
  const single = []
  let seenParallel = false
  for (const system of systems) {
    const ordered = orderTracks(system)
    if (ordered.lyrics.length >= 2 && (numberedPair(ordered) || seenParallel)) {
      parallel.push(ordered)
      seenParallel = true
      continue
    }
    if (seenParallel && ordered.lyrics.length === 1) single.push(ordered)
  }
  if (!parallel.some(numberedPair) || parallel.length < 1) return null
  joinWrappedSyllables(parallel)
  const gap = gapThreshold(list)
  const pickups = peelChorusPickup(parallel[parallel.length - 1], gap)
  if (pickups[0] && single[0]) prependPickup(single[0], pickups[0])
  if (!single.length && !sawChorus) return null
  const refrain = single.length ? renderSystems(single, 0) : []
  const blocks = []
  if (title) blocks.push(title, '')
  for (let track = 0; track < 2; track += 1) {
    const verse = renderSystems(parallel, track)
    if (!verse.length) continue
    if (blocks.length && blocks[blocks.length - 1] !== '') blocks.push('')
    blocks.push(`[Strophe ${track + 1}]`)
    blocks.push(...verse)
    if (refrain.length) {
      blocks.push('')
      blocks.push('[Refrain]')
      blocks.push(...refrain)
    }
  }
  const text = blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!/\[Strophe 1\]/.test(text) || !/\[Strophe 2\]/.test(text)) return null
  return { text, title, bpm }
}

function tokensFromLayout(text) {
  const tokens = []
  String(text || '').replace(/\r/g, '').split('\n').forEach((line, index) => {
    const normalized = line.replace(/[\uE000-\uF8FF♯＃]/g, '#')
    const re = /\S+/g
    let match
    while ((match = re.exec(normalized))) {
      tokens.push({
        text: match[0],
        bbox: [match.index, index * 20, match.index + match[0].length, index * 20 + 10],
      })
    }
  })
  return tokens
}

/**
 * Expand flat pdftotext -layout (or a stored chart) that still has
 * stacked "1." / "2." lyric rows. Returns null when this is not that layout,
 * so other charts keep the normal soft-format path.
 */
export function expandStackedVerseText(text) {
  const raw = String(text || '')
  if (!/(^|\n)\s*1\.\s+\S/.test(raw) || !/(^|\n)\s*2\.\s+\S/.test(raw)) return null
  const chart = expandSongSelectFromTokens(tokensFromLayout(raw))
  return chart?.text || null
}
