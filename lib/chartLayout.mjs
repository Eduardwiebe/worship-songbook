/**
 * SongSelect / ChordPro-style chord-over-lyrics packing and chart soft-format.
 * Slash chords stay one token. Column padding survives transpose when used with
 * editorKey.transposeChordLinePreservingAnchors.
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
    // Adjacent plain roots that already form a known slash token later in list
    // are left alone — slash synthesis belongs to OMR/vision merge.
    out.push(cur)
  }
  return out
}

/**
 * Pack chord tokens above a lyric line (ChordPro → chord-over-lyrics).
 * Chord start column ≈ syllable index; multi-char chords never overwrite neighbors.
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
    occupiedUntil = pos + label.length
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
 * Soft-reformat stored chart text: keep lyric lines, re-pack chord columns,
 * collapse glued slash bass, keep section/meta lines readable.
 * Safe for display; chord *names* stay in order (structure-compatible when only
 * glued bass duplicates are removed).
 */
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
      const next = lines[i + 1]
      const nextTrimmed = next == null ? '' : next.trim()
      const lyricFollows = next != null
        && nextTrimmed
        && !isChordLine(next)
        && !isChordLine(nextTrimmed)
        && !isChartSectionLine(nextTrimmed)
        && !isChartMetaLine(nextTrimmed)
      const anchors = collapseGluedSlashBassAnchors(anchorsFromChordLine(line.length >= trimmed.length ? line : trimmed))
      if (lyricFollows) {
        const packed = packChordsAboveLyrics(nextTrimmed, anchors)
        if (packed.chordLine.trim()) out.push(packed.chordLine)
        out.push(packed.lyricLine)
        i += 1
      } else {
        const packed = packChordsAboveLyrics(' '.repeat(Math.max(...anchors.map((a) => a.index + a.chord.length), 8)), anchors)
        if (packed.chordLine.trim()) out.push(packed.chordLine)
      }
      continue
    }

    out.push(trimmed)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function classifyChartLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return 'blank'
  if (isChartMetaLine(trimmed)) return 'meta'
  if (isChartSectionLine(trimmed)) return 'section'
  if (isChordLine(line) || isChordLine(trimmed)) return 'chords'
  return 'lyrics'
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
