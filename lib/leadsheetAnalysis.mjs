/**
 * Shared leadsheet / chord-line analysis for scan OCR quality gates.
 * Used by server.mjs (analyze-chords) and test scripts.
 */

export const pitchMap = {
  C: 0, Cis: 1, 'C#': 1, Des: 1, Db: 1,
  D: 2, Dis: 3, 'D#': 3, Es: 3, Eb: 3,
  E: 4, F: 5, Fis: 6, 'F#': 6, Ges: 6, Gb: 6,
  G: 7, Gis: 8, 'G#': 8, As: 8, Ab: 8,
  A: 9, Ais: 10, 'A#': 10, Bb: 10, B: 11, H: 11,
}

export const chordPattern = /(?<![\p{L}\d])(Cis|Des|Dis|Es(?!us)|Fis|Ges|Gis|As(?!us)|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°-]\d*)*(?:\([^)]{1,12}\))?(?:\/(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)(?![\p{L}\d])/gu

export function chordTokens(line) {
  return [...String(line || '').matchAll(chordPattern)]
}

export function isChordLine(line) {
  const matches = chordTokens(line)
  if (!matches.length) return false
  return line.replace(chordPattern, '').replace(/[\s|,:()[\]{}-]/g, '').length === 0
}

const GARBAGE_CHAR = /[^\p{L}\p{N}\sÄÖÜäöüß.,;:'"()\-\/#°+]/u
const OCR_JUNK = /[~=_<>{}|\\^`]|(?:\b[A-Za-z]\b\s*){4,}|(?:SS\s*){2,}|[^\x20-\x7EäöüÄÖÜß]{3,}/

export function cleanOcrText(text) {
  // Keep leading spaces on chord lines so columns still sit over syllables
  // (SongSelect / ChordPro). Only trim trailing whitespace per line.
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}


/**
 * Parse BPM/tempo from chart header text.
 * Accepts: "Tempo - 60", "TEMPO: 60 BPM", "BPM: 72", "♩ = 80", etc.
 */
export function parseTempoBpm(text, { min = 40, max = 240 } = {}) {
  const raw = String(text || '')
  const patterns = [
    /\bTEMPO\s*[=:\-–]\s*(\d{2,3})(?:\s*BPM)?\b/i,
    /\bBPM\s*[=:\-–]?\s*(\d{2,3})\b/i,
    /♩\s*=\s*(\d{2,3})\b/,
    /\bTempo\s+(\d{2,3})\b/i,
  ]
  for (const re of patterns) {
    const match = raw.match(re)
    if (!match) continue
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= min && value <= max) return value
  }
  return null
}

/**
 * Clamp a tempo for commit (blur). Empty / non-numeric → null (caller keeps prior or default).
 */
export function clampTempoBpm(value, { min = 40, max = 240, fallback = null } = {}) {
  if (value === '' || value == null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Score 0..100 — higher is better leadsheet OCR/text quality.
 */
export function scoreLeadsheetQuality(text) {
  const raw = cleanOcrText(text)
  if (!raw) {
    return { score: 0, needsReview: true, chordLineCount: 0, lyricLineCount: 0, garbageRatio: 1, reasons: ['empty'] }
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const chordLines = lines.filter(isChordLine)
  const lyricLines = lines.filter((l) => !isChordLine(l) && /[\p{L}]{3,}/u.test(l))

  let garbageLines = 0
  let specialHeavy = 0
  for (const line of lines) {
    if (isChordLine(line)) continue
    const stripped = line.replace(/[\s\d.,;:'"()-]/g, '')
    if (!stripped) continue
    const special = (line.match(GARBAGE_CHAR) || []).length
    const ratio = special / Math.max(line.length, 1)
    if (OCR_JUNK.test(line) || ratio > 0.35) garbageLines += 1
    if (ratio > 0.2) specialHeavy += 1
  }

  const garbageRatio = lines.length ? garbageLines / lines.length : 1
  const chordTokensTotal = chordLines.reduce((sum, line) => sum + chordTokens(line).length, 0)

  let score = 0
  const reasons = []

  if (chordLines.length >= 2) score += 25
  else if (chordLines.length === 1) score += 10
  else reasons.push('few_chord_lines')

  if (lyricLines.length >= 3) score += 25
  else if (lyricLines.length >= 1) score += 10
  else reasons.push('few_lyric_lines')

  if (chordTokensTotal >= 4) score += 20
  else if (chordTokensTotal >= 2) score += 10

  score += Math.round((1 - Math.min(garbageRatio, 1)) * 30)

  if (raw.length > 40 && lyricLines.length === 0 && chordLines.length === 0) {
    score -= 30
    reasons.push('unstructured')
  }

  score = Math.max(0, Math.min(100, score))
  const needsReview =
    score < 50
    || garbageRatio >= 0.25
    || (chordLines.length === 0 && lyricLines.length < 2)
    || (chordLines.length === 0 && lines.length >= 4 && chordTokensTotal === 0)

  return {
    score,
    needsReview,
    chordLineCount: chordLines.length,
    lyricLineCount: lyricLines.length,
    chordTokenCount: chordTokensTotal,
    garbageRatio: Number(garbageRatio.toFixed(3)),
    specialHeavy,
    reasons,
  }
}

export function pickBestTextCandidate(candidates) {
  let best = { text: '', method: 'none', quality: scoreLeadsheetQuality('') }
  for (const candidate of candidates) {
    if (!candidate?.text) continue
    const cleaned = cleanOcrText(candidate.text)
    const quality = scoreLeadsheetQuality(cleaned)
    if (quality.score > best.quality.score || (quality.score === best.quality.score && cleaned.length > best.text.length)) {
      best = { text: cleaned, method: candidate.method || 'unknown', quality }
    }
  }
  return best
}

/** Prefer OCR when pdftotext output looks empty or low quality (typical for camera scans). */
export function shouldRunOcr(pdfText, { forceScan = false } = {}) {
  if (forceScan) return true
  const cleaned = cleanOcrText(pdfText)
  if (!cleaned || cleaned.length < 24) return true
  const quality = scoreLeadsheetQuality(cleaned)
  return quality.score < 40 || (quality.chordLineCount === 0 && quality.lyricLineCount < 2)
}
