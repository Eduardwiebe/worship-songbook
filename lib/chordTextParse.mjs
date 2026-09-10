/**
 * Parse chord-over-lyrics text / .txt into the same lead-sheet text model
 * used by scan OCR (chord lines above lyrics, section markers, optional TONART).
 */

import {
  cleanOcrText,
  isChordLine,
  scoreLeadsheetQuality,
} from './leadsheetAnalysis.mjs'
import {
  inferKeyFromChords,
  inferKeyFromLeadsheet,
  normalizeEditorKey,
} from './editorKey.mjs'

const SECTION_RE = /^(?:\[)?\s*(Verse|Chorus|Bridge|Intro|Outro|Pre-?Chorus|Tag|Instrumental|Interlude|Turnaround|Ending|Vamp|Strophe|Refrain|Zwischenspiel|Schluss|Coda|Hook|Break)(?:\s*(\d+|[A-Z]))?\s*(?:[:.\]])?\s*$/i
const TITLE_HINT_RE = /^(?:title|titel)\s*[:·]\s*(.+)$/i
const ARTIST_HINT_RE = /^(?:artist|interpret|by)\s*[:·]\s*(.+)$/i

export function isSectionHeader(line) {
  return SECTION_RE.test(String(line || '').trim())
}

export function normalizeSectionHeader(line) {
  const match = String(line || '').trim().match(SECTION_RE)
  if (!match) return String(line || '').trim()
  const rawLabel = match[1]
  const numbered = match[2] ? ` ${match[2]}` : ''
  let label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)
  if (/^pre-?chorus$/i.test(rawLabel)) label = 'Pre-Chorus'
  return `${label}${numbered}`
}

function preserveChordSpacing(line) {
  return String(line || '').replace(/\s+$/g, '')
}

function looksLikeTitleCandidate(line, index, lines) {
  if (!line || isChordLine(line) || isSectionHeader(line)) return false
  if (/(?:TONART|Tonart|KEY|Key)\s*[:·]/i.test(line)) return false
  if (TITLE_HINT_RE.test(line) || ARTIST_HINT_RE.test(line)) return false
  if (line.length > 80) return false
  if (/^\d+\s*$/.test(line)) return false
  if (index > 4) return false
  const laterHasChords = lines.slice(index + 1, index + 8).some(isChordLine)
  return laterHasChords || index === 0
}

/**
 * @param {string} raw
 * @param {{ titleHint?: string, injectTonart?: boolean }} [options]
 */
export function parseChordOverLyricsText(raw, { titleHint = '', injectTonart = true } = {}) {
  const cleaned = cleanOcrText(raw)
  const sourceLines = cleaned.split('\n')
  const trimmedLines = sourceLines.map((line) => line.trim())
  const out = []
  let title = String(titleHint || '').trim()
  let sawContent = false
  const sections = []

  for (let i = 0; i < sourceLines.length; i += 1) {
    const original = sourceLines[i]
    const trimmed = trimmedLines[i]
    if (!trimmed) {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }

    const titleHintMatch = trimmed.match(TITLE_HINT_RE)
    if (titleHintMatch) {
      if (!title) title = titleHintMatch[1].trim()
      continue
    }
    if (ARTIST_HINT_RE.test(trimmed)) continue

    if (isSectionHeader(trimmed)) {
      const header = normalizeSectionHeader(trimmed)
      sections.push(header)
      if (out.length && out[out.length - 1] !== '') out.push('')
      out.push(header)
      sawContent = true
      continue
    }

    if (isChordLine(trimmed) || isChordLine(original)) {
      out.push(preserveChordSpacing(original.length >= trimmed.length ? original : trimmed))
      sawContent = true
      continue
    }

    if (!sawContent && !title && looksLikeTitleCandidate(trimmed, i, trimmedLines)) {
      title = trimmed
      continue
    }

    out.push(trimmed)
    sawContent = true
  }

  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  let key = inferKeyFromLeadsheet(text)
  const chords = inferKeyFromChords(text)
  if (!key && chords.key) key = chords.key

  if (injectTonart && key && !inferKeyFromLeadsheet(text)) {
    text = `TONART: ${key}\n\n${text}`
  }

  const quality = scoreLeadsheetQuality(text)
  return {
    text,
    title,
    key: normalizeEditorKey(key) || '',
    chordKey: normalizeEditorKey(chords.key) || '',
    chordConfidence: chords.confidence || 0,
    sections,
    quality,
    needsReview: Boolean(quality.needsReview) || !normalizeEditorKey(key),
    method: 'Text-Import',
  }
}

/**
 * Suggest which 0-based page indices likely belong to one song.
 */
export function suggestSongPageIndices(pageSummaries) {
  const pages = (pageSummaries || []).map((page, index) => ({
    index: Number.isInteger(page?.index) ? page.index : index,
    score: Number(page?.score) || 0,
    hasMusic: Boolean(page?.hasMusic),
  }))
  if (!pages.length) return []
  if (pages.length === 1) return [pages[0].index]

  const musical = pages.filter((page) => page.hasMusic || page.score >= 25)
  if (!musical.length) return [pages[0].index]

  let best = { start: 0, end: 0, score: -1 }
  let runStart = 0
  for (let i = 0; i < musical.length; i += 1) {
    const prev = musical[i - 1]
    const cur = musical[i]
    if (i > 0 && cur.index !== prev.index + 1) runStart = i
    const slice = musical.slice(runStart, i + 1)
    const score = slice.reduce((sum, page) => sum + page.score, 0)
    if (score > best.score || (score === best.score && slice.length < best.end - best.start + 1)) {
      best = { start: runStart, end: i, score }
    }
  }
  return musical.slice(best.start, best.end + 1).map((page) => page.index)
}

export function analyzePdfPageText(pageText) {
  const cleaned = cleanOcrText(pageText)
  const quality = scoreLeadsheetQuality(cleaned)
  const hasMusic = quality.chordLineCount > 0 || quality.lyricLineCount >= 2
  return {
    text: cleaned,
    score: quality.score,
    hasMusic,
    quality,
  }
}
