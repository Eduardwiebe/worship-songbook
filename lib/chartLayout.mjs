/**
 * SongSelect / ChordPro-style chord-over-lyrics packing and chart soft-format.
 * Slash chords stay one token. Soft-format preserves column spacing (does not
 * reflow chords). Display helpers build word stacks so wrap keeps chords on
 * their syllables and never orphans a chord past its lyric.
 */

import { chordTokens, isChordLine } from './leadsheetAnalysis.mjs'

const SECTION_LINE_RE = /^(?:\[)?\s*(?:Verse|Chorus|Bridge|Intro|Outro|Pre-?Chorus|Tag|Instrumental|Interlude|Turnaround|Ending|Vamp|Strophe|Refrain|VERS|CHORUS|BRIDGE|Zwischenspiel|Schluss|Coda|Hook|Break)(?:\s*\d+)?\s*(?:\])?\s*:?\s*$/i
const META_LINE_RE = /^(?:TONART|KEY|TEMPO|CAPO)\b/i

export function isChartSectionLine(line) {
  return SECTION_LINE_RE.test(String(line || '').trim())
}

export function isChartMetaLine(line) {
  return META_LINE_RE.test(String(line || '').trim())
}

/**
 * Collapse glued slash+bass artifacts: "F/GG" / "F/G G" at same slot → "F/G".
 * Never splits a slash token into two chords.
 */
export function collapseGluedSlashBassAnchors(anchors) {
  const sorted = [...(anchors || [])]
    .map((item) => ({
      chord: String(item.chord || item[0] || '').trim(),
      index: Math.max(0, Number(item.index ?? item.column ?? 0) || 0),
    }))
    .filter((item) => item.chord)
    .sort((a, b) => a.index - b.index || a.chord.length - b.chord.length)

  const out = []
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]
    const next = sorted[i + 1]
    if (next && cur.chord.includes('/')) {
      const bass = cur.chord.slice(cur.chord.lastIndexOf('/') + 1)
      const glued = next.chord === bass && next.index <= cur.index + cur.chord.length
      const stacked = next.chord === bass && Math.abs(next.index - cur.index) <= 2
      if (glued || stacked) {
        out.push(cur)
        i += 1
        continue
      }
    }
    out.push(cur)
  }
  return out
}

/**
 * Pack chord tokens above a lyric line (ChordPro → chord-over-lyrics).
 * Chord start column ≈ syllable index; multi-char chords never overwrite neighbors.
 * Used by OMR/vision reconstruction — not by soft-format display.
 */
export function packChordsAboveLyrics(lyrics, chordAnchors) {
  const lyricLine = String(lyrics || '')
  const anchors = collapseGluedSlashBassAnchors(chordAnchors)
  if (!anchors.length) {
    return { chordLine: '', lyricLine }
  }

  const slots = Array.from({ length: Math.max(lyricLine.length, 8) }, () => ' ')
  let occupiedUntil = -1

  for (const item of anchors) {
    const label = item.chord
    let pos = Math.max(0, item.index)
    if (pos < occupiedUntil) pos = occupiedUntil
    while (slots.slice(pos, pos + label.length).some((ch) => ch !== ' ')) {
      pos += 1
    }
    while (pos + label.length > slots.length) slots.push(' ')
    for (let i = 0; i < label.length; i += 1) slots[pos + i] = label[i]
    occupiedUntil = pos + label.length + 1
  }

  return {
    chordLine: slots.join('').replace(/\s+$/g, ''),
    lyricLine,
  }
}

export function placeChordsByIndex(lyrics, chords) {
  if (!chords?.length || !lyrics) return ''
  return packChordsAboveLyrics(
    lyrics,
    chords.map((item) => ({
      chord: item.chord || item.text || '',
      index: item.index ?? item.column ?? 0,
    })),
  ).chordLine
}

function anchorsFromChordLine(line) {
  return chordTokens(line).map((match) => ({
    chord: match[0],
    index: match.index,
  }))
}

/**
 * Collapse glued slash bass inside a chord line WITHOUT shifting other columns.
 * "F/G G" at the glued bass slot → "F/G" with spaces filling the removed token.
 */
export function collapseGluedSlashInChordLine(line) {
  const raw = String(line || '')
  const anchors = anchorsFromChordLine(raw)
  const collapsed = collapseGluedSlashBassAnchors(anchors)
  if (collapsed.length === anchors.length) return raw.replace(/\s+$/g, '')
  const slots = Array.from({ length: Math.max(raw.length, 8) }, (_, i) => (raw[i] === undefined ? ' ' : ' '))
  for (const item of collapsed) {
    let pos = item.index
    while (pos + item.chord.length > slots.length) slots.push(' ')
    for (let i = 0; i < item.chord.length; i += 1) slots[pos + i] = item.chord[i]
  }
  return slots.join('').replace(/\s+$/g, '')
}

/**
 * Soft-reformat stored chart text WITHOUT destroying chord column spacing.
 * - Normalize section headers
 * - Collapse glued slash bass in place
 * - Keep lyric lines intact (trailing trim only)
 * Does NOT re-pack / push chords right (that caused SongSelect drift).
 */
/**
 * Attach chord-only orphan lines (e.g. "A A2 A" with no lyric beneath) onto the
 * previous lyric line's chord row, instead of leaving a free-floating chord row.
 */
export function attachOrphanChordLines(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const kind = classifyChartLine(line)
    if (kind !== 'chords') {
      out.push(line)
      continue
    }
    const next = lines[i + 1]
    const nextKind = next == null ? 'blank' : classifyChartLine(next)
    if (nextKind === 'lyrics') {
      out.push(line)
      continue
    }
    // Orphan chord line: merge into previous pair if possible
    let prevLyricIdx = -1
    let prevChordIdx = -1
    for (let j = out.length - 1; j >= 0; j -= 1) {
      const k = classifyChartLine(out[j])
      if (k === 'blank') continue
      if (k === 'lyrics') {
        prevLyricIdx = j
        if (j > 0 && classifyChartLine(out[j - 1]) === 'chords') prevChordIdx = j - 1
        break
      }
      break
    }
    if (prevChordIdx >= 0 && prevLyricIdx >= 0) {
      const lyric = out[prevLyricIdx]
      const prevChords = out[prevChordIdx]
      const orphan = line.trim()
      const targetCol = Math.max(lyric.length + 1, prevChords.length + 1)
      const pad = Math.max(0, targetCol - prevChords.length)
      out[prevChordIdx] = `${prevChords}${' '.repeat(pad)}${orphan}`.replace(/\s+$/g, '')
      continue
    }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function softFormatChordChart(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const out = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }

    if (isChartMetaLine(trimmed) || isChartSectionLine(trimmed)) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      const section = isChartSectionLine(trimmed)
        ? (trimmed.startsWith('[') ? trimmed : `[${trimmed.replace(/^\[|\]$/g, '').replace(/:$/, '').trim()}]`)
        : trimmed
      out.push(section)
      continue
    }

    if (isChordLine(line) || isChordLine(trimmed)) {
      const source = line.length >= trimmed.length ? line : trimmed
      out.push(collapseGluedSlashInChordLine(source))
      continue
    }

    out.push(line.replace(/\s+$/g, ''))
  }

  return attachOrphanChordLines(out.join('\n').replace(/\n{3,}/g, '\n\n').trim())
}

/**
 * Split a chord+lyric pair into word stacks for responsive ChordPro-style DOM.
 * Chord at column i attaches to the word that covers character i (or nearest).
 */
export function chordLyricToWordStacks(chordLine, lyricLine) {
  const lyrics = String(lyricLine || '')
  const chords = String(chordLine || '')
  const anchors = collapseGluedSlashBassAnchors(anchorsFromChordLine(chords))
  const words = []
  const wordRe = /\S+/g
  let match
  while ((match = wordRe.exec(lyrics))) {
    words.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  if (!words.length) {
    return anchors.length
      ? [{ chord: anchors.map((a) => a.chord).join(' '), word: '' }]
      : []
  }

  const stacks = words.map((word) => ({ chord: '', word: word.text, start: word.start }))
  for (const anchor of anchors) {
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i]
      const dist = anchor.index < word.start
        ? word.start - anchor.index
        : anchor.index >= word.end
          ? anchor.index - (word.end - 1)
          : 0
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    stacks[best].chord = stacks[best].chord
      ? `${stacks[best].chord} ${anchor.chord}`
      : anchor.chord
  }
  return stacks.map(({ chord, word }) => ({ chord, word }))
}

/**
 * Serialize word stacks back to monospace chord-over-lyrics lines.
 */
export function wordStacksToChordLyric(stacks) {
  const parts = (stacks || []).filter((item) => item && (item.word || item.chord))
  if (!parts.length) return { chordLine: '', lyricLine: '' }
  const lyricLine = parts.map((item) => item.word || '').join(' ').replace(/\s+$/g, '')
  const anchors = []
  let cursor = 0
  for (let i = 0; i < parts.length; i += 1) {
    const word = parts[i].word || ''
    const chord = String(parts[i].chord || '').trim()
    if (chord) {
      const pieces = chord.split(/\s+/).filter(Boolean)
      let offset = 0
      for (const piece of pieces) {
        anchors.push({ chord: piece, index: cursor + offset })
        offset += 1
      }
    }
    cursor += word.length + (i < parts.length - 1 ? 1 : 0)
  }
  return packChordsAboveLyrics(lyricLine, anchors)
}

/**
 * Wrap a chord+lyric pair at musical word boundaries so neither line exceeds
 * maxCols. Chords travel with their word (never orphan past the lyric).
 */
export function wrapChordLyricPair(chordLine, lyricLine, maxCols = 42) {
  const limit = Math.max(12, Number(maxCols) || 42)
  const stacks = chordLyricToWordStacks(chordLine, lyricLine)
  if (!stacks.length) return [{ chordLine: String(chordLine || ''), lyricLine: String(lyricLine || '') }]

  const rows = []
  let current = []
  let width = 0
  for (const stack of stacks) {
    const piece = stack.word || ''
    const chordExtra = Math.max(0, String(stack.chord || '').length - piece.length)
    const add = piece.length + (current.length ? 1 : 0) + chordExtra
    if (current.length && width + add > limit) {
      rows.push(wordStacksToChordLyric(current))
      current = [stack]
      width = piece.length + chordExtra
    } else {
      current.push(stack)
      width += add
    }
  }
  if (current.length) rows.push(wordStacksToChordLyric(current))
  return rows
}

/**
 * Detect and deinterleave SongSelect-style 2-column pdftotext -layout pages.
 * When many lines have a large mid-page gap, split into left then right columns
 * (reading order) instead of interleaving words across the gutter.
 */
export function deinterleaveTwoColumnLayout(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  if (lines.length < 4) return String(text || '')

  const widths = lines.map((line) => line.length).filter((n) => n > 20)
  if (widths.length < 3) return String(text || '')
  const pageWidth = Math.max(...widths)

  const gutters = []
  for (const line of lines) {
    if (line.length < pageWidth * 0.55) continue
    const re = /[ \t]{4,}/g
    let match
    while ((match = re.exec(line))) {
      const mid = match.index + match[0].length / 2
      if (mid >= pageWidth * 0.32 && mid <= pageWidth * 0.78 && match[0].length >= 4) {
        gutters.push({ index: match.index, length: match[0].length, mid })
      }
    }
  }
  if (gutters.length < Math.max(3, Math.floor(lines.length * 0.3))) {
    return String(text || '')
  }

  gutters.sort((a, b) => a.mid - b.mid)
  const gutterMid = gutters[Math.floor(gutters.length / 2)].mid
  const leftLines = []
  const rightLines = []

  for (const line of lines) {
    if (!line.trim()) {
      leftLines.push('')
      rightLines.push('')
      continue
    }
    if (line.length <= gutterMid) {
      leftLines.push(line.replace(/\s+$/g, ''))
      rightLines.push('')
      continue
    }

    // Prefer the largest whitespace run whose center is near the page gutter.
    // Never cut mid-token (Em7 / Asus must stay intact).
    let best = null
    const re = /[ \t]{2,}/g
    let match
    while ((match = re.exec(line))) {
      const mid = match.index + match[0].length / 2
      // Only consider gutters near the page column split — do not cut inside
      // a left-column chord run (large gaps between G … Asus are musical spacing).
      if (Math.abs(mid - gutterMid) > Math.max(pageWidth * 0.14, 18)) continue
      if (mid < line.length * 0.28 || mid > line.length * 0.85) continue
      const score = match[0].length * 5 - Math.abs(mid - gutterMid) * 2
      if (!best || score > best.score) {
        best = { index: match.index, end: match.index + match[0].length, score }
      }
    }
    if (!best) {
      // Fallback: snap to nearest whitespace around gutterMid
      let cut = Math.min(Math.max(Math.round(gutterMid), 0), line.length)
      while (cut > 0 && line[cut - 1] !== ' ' && line[cut - 1] !== '\t') cut -= 1
      while (cut < line.length && (line[cut] === ' ' || line[cut] === '\t')) cut += 1
      leftLines.push(line.slice(0, cut).replace(/\s+$/g, ''))
      rightLines.push(line.slice(cut).replace(/^\s+/, '').replace(/\s+$/g, ''))
      continue
    }
    leftLines.push(line.slice(0, best.index).replace(/\s+$/g, ''))
    rightLines.push(line.slice(best.end).replace(/^\s+/, '').replace(/\s+$/g, ''))
  }

  const compact = (arr) => arr.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const left = compact(leftLines)
  const right = compact(rightLines)
  if (!right) return String(text || '')
  return `${left}\n\n${right}`.trim()
}

export function classifyChartLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return 'blank'
  if (isChartMetaLine(trimmed)) return 'meta'
  if (isChartSectionLine(trimmed)) return 'section'
  if (isChordLine(line) || isChordLine(trimmed)) return 'chords'
  return 'lyrics'
}

/**
 * Parse chart into display blocks. Chord+lyric pairs become one 'pair' block
 * so CSS columns / wrap cannot split a chord from its lyric (scatter fix).
 */
export function parseChartBlocks(text, { maxCols = 0 } = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const kind = classifyChartLine(line)
    if (kind === 'blank') {
      blocks.push({ kind: 'blank', text: '' })
      continue
    }
    if (kind === 'section' || kind === 'meta') {
      blocks.push({ kind, text: line })
      continue
    }
    if (kind === 'chords') {
      const next = lines[i + 1]
      const nextKind = next == null ? 'blank' : classifyChartLine(next)
      if (nextKind === 'lyrics') {
        const chordLine = line
        const lyricLine = next
        const wrapped = maxCols > 0
          ? wrapChordLyricPair(chordLine, lyricLine, maxCols)
          : [{ chordLine, lyricLine }]
        for (const row of wrapped) {
          blocks.push({
            kind: 'pair',
            chordLine: row.chordLine,
            lyricLine: row.lyricLine,
            stacks: chordLyricToWordStacks(row.chordLine, row.lyricLine),
          })
        }
        i += 1
        continue
      }
      blocks.push({ kind: 'chords', text: line })
      continue
    }
    blocks.push({ kind: 'lyrics', text: line })
  }
  return blocks
}

export function parseChartRows(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map((line) => ({
    text: line,
    kind: classifyChartLine(line),
  }))
}

export function normalizeChartInnerText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/**
 * Serialize chart DOM / innerText from pair-aware rendering back to plain text.
 * Pair rows emit chord line then lyric line.
 */
export function serializeChartBlocks(blocks) {
  const out = []
  for (const block of blocks || []) {
    if (!block) continue
    if (block.kind === 'blank') {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (block.kind === 'pair') {
      if (block.chordLine?.trim()) out.push(block.chordLine.replace(/\s+$/g, ''))
      out.push(String(block.lyricLine || '').replace(/\s+$/g, ''))
      continue
    }
    out.push(String(block.text || '').replace(/\s+$/g, ''))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
