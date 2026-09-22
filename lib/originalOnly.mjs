/**
 * Songbook Band product flag: digital ORIGINAL songbook only.
 * Chord / LeadSheet / transpose reconstruction belongs in lyruma.de, not here.
 */
import { inferKeyFromLeadsheet, normalizeEditorKey } from './editorKey.mjs'
import { parseTempoBpm } from './leadsheetAnalysis.mjs'

export const ORIGINAL_ONLY_SONGBOOK = true

/**
 * Light metadata from printed sheet text only.
 * - Key: only explicit TONART / Key headers (never invent from chords).
 * - BPM: only TEMPO / BPM / ♩= patterns (never invent / lookup).
 */
export function extractPrintedMetadataFromText(text = '') {
  const raw = String(text || '')
  const key = normalizeEditorKey(inferKeyFromLeadsheet(raw)) || ''
  const bpm = parseTempoBpm(raw)
  return {
    key,
    bpm: bpm == null ? null : bpm,
    hasPrintedKey: Boolean(key),
    hasPrintedBpm: bpm != null,
  }
}

export function originalOnlyDisabledMessage(feature = 'Akkorde') {
  return `${feature} ist in Songbook Band nicht mehr verfügbar. Die App zeigt nur das Original-Notenblatt. Tonart-Analyse gehört zu lyruma.de.`
}
