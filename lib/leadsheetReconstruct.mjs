/**
 * Geometric leadsheet reconstruction from structured OCR tokens.
 * Input tokens: { text, bbox:[x0,y0,x1,y1], confidence, line_index }
 */

import { chordPattern, cleanOcrText, isChordLine, pitchMap, scoreLeadsheetQuality } from './leadsheetAnalysis.mjs'

const SECTION_RE = /^(verse|strophe|chorus|refrain|bridge|intro|outro|pre-?chorus|ending|coda|tag|interlude)\b/i
const TEMPO_RE = /^(tempo|bpm|♩|=)\b/i
const META_RE = /^(capo|key|tonart|words|music|text|melodie|copyright|©|cc\s*li)/i
const MUSIC_JUNK = /^[|¦\[\]{}♪♫♩♬ coc·•]+$/u
const OCR_GARBAGE_TOKEN = /^(sss+|ss+|ce|ow|oh+|ah+|mm+|hm+|<3|~+|_+|=+)$/i
const SYLLABLE_JOIN = /^[\p{L}]{1,4}-$/u

/** Strict chord validator — rejects SSS, ce, ow, 66, <3, etc. */
export function isValidChordToken(raw) {
  const text = String(raw || '').trim()
  if (!text || text.length > 18) return false
  if (/^[0-9]+$/.test(text)) return false
  if (/[<>_=~]/.test(text)) return false
  if (OCR_GARBAGE_TOKEN.test(text)) return false

  const matches = [...text.matchAll(new RegExp(chordPattern.source, 'gu'))]
  if (matches.length !== 1) return false
  const full = matches[0][0]
  if (full !== text) return false

  const root = matches[0][1]
  if (!(root in pitchMap)) return false

  // Reject single lowercase letters mistaken as chords
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

function classifyToken(token) {
  const text = token.text.trim()
  if (!text) return 'empty'
  if (MUSIC_JUNK.test(text) || OCR_GARBAGE_TOKEN.test(text)) return 'music'
  if (/^\d{1,3}\.?$/.test(text) && token.bbox[0] < 120) return 'verse_number'
  if (SECTION_RE.test(text)) return 'section'
  if (TEMPO_RE.test(text) || META_RE.test(text)) return 'meta'
  if (isValidChordToken(text)) return 'chord'
  // Staff-like fragments: dense short symbols
  if (text.length <= 2 && /[^A-Za-zÄÖÜäöüß0-9]/.test(text)) return 'music'
  if (/^[\p{L}]{1,6}-$/u.test(text)) return 'syllable'
  return 'lyric'
}

function groupByLine(tokens) {
  const map = new Map()
  for (const token of tokens) {
    const key = token.line_index ?? Math.round(tokenCenterY(token) / 8)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(token)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lineIndex, items]) => ({
      lineIndex,
      tokens: items.sort((a, b) => a.bbox[0] - b.bbox[0]),
      y: items.reduce((s, t) => s + tokenCenterY(t), 0) / items.length,
    }))
}

function joinSyllables(parts) {
  const out = []
  for (const part of parts) {
    const text = part.trim()
    if (!text) continue
    if (out.length && /-$/.test(out[out.length - 1])) {
      out[out.length - 1] = out[out.length - 1].replace(/-$/, '') + text.replace(/^-/, '')
    } else if (out.length && /^-/.test(text)) {
      out[out.length - 1] += text.replace(/^-/, '')
    } else {
      out.push(text)
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function lineText(line, kinds) {
  const parts = line.tokens
    .filter((t) => kinds.has(classifyToken(t)))
    .map((t) => t.text)
  return joinSyllables(parts)
}

function isMostlyChords(line) {
  const classified = line.tokens.map(classifyToken).filter((k) => k !== 'empty' && k !== 'music')
  if (!classified.length) return false
  const chords = classified.filter((k) => k === 'chord').length
  return chords / classified.length >= 0.6 && chords >= 1
}

function isMostlyLyrics(line) {
  const classified = line.tokens.map(classifyToken)
  const lyrics = classified.filter((k) => k === 'lyric' || k === 'syllable').length
  const chords = classified.filter((k) => k === 'chord').length
  return lyrics >= 1 && lyrics > chords
}

/**
 * Place chords above a lyric line using relative X positions.
 * Returns a chord line string with spaces approximating positions.
 */
export function placeChordsAboveLyric(chords, lyricLine, lyricText) {
  if (!chords.length || !lyricText) return { chordLine: '', lyricLine: lyricText }

  const lyricTokens = lyricLine.tokens.filter((t) => {
    const kind = classifyToken(t)
    return kind === 'lyric' || kind === 'syllable' || kind === 'verse_number'
  })
  const x0 = lyricTokens.length
    ? Math.min(...lyricTokens.map((t) => t.bbox[0]))
    : lyricLine.tokens[0]?.bbox[0] || 0
  const x1 = lyricTokens.length
    ? Math.max(...lyricTokens.map((t) => t.bbox[2]))
    : lyricLine.tokens[lyricLine.tokens.length - 1]?.bbox[2] || 1
  const width = Math.max(x1 - x0, 1)
  const targetLen = Math.max(lyricText.length, 8)

  const slots = Array.from({ length: targetLen }, () => ' ')
  const sorted = [...chords].sort((a, b) => tokenCenterX(a) - tokenCenterX(b))

  for (const chord of sorted) {
    const rel = (tokenCenterX(chord) - x0) / width
    let pos = Math.round(Math.max(0, Math.min(1, rel)) * (targetLen - 1))
    const label = chord.text.trim()
    // Avoid overlapping previous chord text
    while (pos > 0 && slots.slice(pos, pos + label.length).some((c) => c !== ' ')) {
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

function detectTitle(lines) {
  for (const line of lines.slice(0, 6)) {
    const text = lineText(line, new Set(['lyric', 'section', 'meta', 'verse_number']))
    if (!text) continue
    if (SECTION_RE.test(text) || TEMPO_RE.test(text) || META_RE.test(text)) continue
    if (isMostlyChords(line)) continue
    // Title-ish: short, few words, larger boxes
    const avgH = line.tokens.reduce((s, t) => s + (t.bbox[3] - t.bbox[1]), 0) / Math.max(line.tokens.length, 1)
    if (text.length <= 60 && avgH >= 28) return text.replace(/^\d+\s+/, '').trim()
  }
  return ''
}

/**
 * Reconstruct editor text from structured OCR pages.
 */
export function reconstructLeadsheet(structured, { titleHint = '' } = {}) {
  const pages = structured?.pages || []
  const allTokens = []
  for (const page of pages) {
    for (const token of page.tokens || []) {
      allTokens.push({ ...token, page_index: page.page_index || 0 })
    }
  }

  const lines = groupByLine(allTokens)
  const title = titleHint || detectTitle(lines)
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const kinds = line.tokens.map(classifyToken)
    if (kinds.every((k) => k === 'music' || k === 'empty' || k === 'meta')) {
      i += 1
      continue
    }

    const sectionText = lineText(line, new Set(['section']))
    if (sectionText && SECTION_RE.test(sectionText)) {
      const label = sectionText.replace(/[:.\s]+$/g, '')
      // Only emit when confident single-token section header
      if (line.tokens.length <= 3) {
        blocks.push({ type: 'section', text: label })
        i += 1
        continue
      }
    }

    if (isMostlyChords(line)) {
      const chords = line.tokens.filter((t) => classifyToken(t) === 'chord')
      const next = lines[i + 1]
      if (next && isMostlyLyrics(next)) {
        const lyric = lineText(next, new Set(['lyric', 'syllable', 'verse_number']))
        const placed = placeChordsAboveLyric(chords, next, lyric)
        if (placed.chordLine) blocks.push({ type: 'chords', text: placed.chordLine })
        if (placed.lyricLine) blocks.push({ type: 'lyrics', text: placed.lyricLine })
        i += 2
        continue
      }
      // Chord-only line with no lyric below
      const chordLine = chords.map((c) => c.text).join('  ')
      if (chordLine) blocks.push({ type: 'chords', text: chordLine })
      i += 1
      continue
    }

    if (isMostlyLyrics(line)) {
      // Look for chords slightly above (same cluster already handled); orphan lyric
      const lyric = lineText(line, new Set(['lyric', 'syllable', 'verse_number']))
      // Skip if this is the detected/hinted title (with optional leading song number)
      const normalizedLyric = lyric.replace(/^\d+\s+/, '').trim().toLowerCase()
      const normalizedTitle = title.replace(/^\d+\s+/, '').trim().toLowerCase()
      if (title && (lyric === title || normalizedLyric === normalizedTitle)) {
        i += 1
        continue
      }
      if (lyric) blocks.push({ type: 'lyrics', text: lyric })
      i += 1
      continue
    }

    // Mixed line: extract chords + lyrics separately without hallucinating structure
    const chords = line.tokens.filter((t) => classifyToken(t) === 'chord')
    const lyric = lineText(line, new Set(['lyric', 'syllable', 'verse_number']))
    if (chords.length && lyric) {
      const placed = placeChordsAboveLyric(chords, line, lyric)
      if (placed.chordLine) blocks.push({ type: 'chords', text: placed.chordLine })
      blocks.push({ type: 'lyrics', text: placed.lyricLine })
    } else if (lyric) {
      blocks.push({ type: 'lyrics', text: lyric })
    }
    i += 1
  }

  const body = []
  for (const block of blocks) {
    if (block.type === 'section') {
      if (body.length) body.push('')
      body.push(`[${block.text}]`)
    } else {
      body.push(block.text)
    }
  }

  let text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (title && !text.startsWith(title)) {
    text = `${title}\n\n${text}`.trim()
  }
  text = cleanOcrText(text)

  const confidences = allTokens.map((t) => Number(t.confidence) || 0).filter((n) => n > 0)
  const avgConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0

  const quality = scoreLeadsheetQuality(text)
  const chordTokensInText = text.split(/\s+/).filter(isValidChordToken)
  const falseChordCandidates = allTokens
    .filter((t) => /^[A-Ga-g]/.test(t.text) && !isValidChordToken(t.text) && classifyToken(t) !== 'lyric')
    .map((t) => t.text)

  const needsReview =
    quality.needsReview
    || avgConfidence < 0.55
    || (quality.chordLineCount === 0 && quality.lyricLineCount < 2)

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
    },
    needsReview,
    blocks,
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
