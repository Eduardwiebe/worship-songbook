/**
 * Song metadata vs lyrics: titles, CCLI/SongSelect footers, authors, BPM.
 * Metadata must never appear as reconstructed lyric lines.
 */

const LEAD_SUFFIX_RE = /(?:\s*[-–_]\s*lead(?:sheet)?\s*[-–_]?\s*)(?:[A-H](?:is|es|#|b)?(?:m|min|maj)?|Bb|Eb|Ab|Cis|Fis|Gis|Des|Ges|As|Es)(?:\s*[-–_]?\s*\d+)?$/i
const LEAD_BARE_RE = /\s*[-–_]\s*lead(?:sheet)?$/i
const PDF_EXT_RE = /\.pdf$/i

export const SONGSELECT_RE = /songselect|ccli|praisecharts|worshiptogether|essentialworship|multitracks/i
export const CCLI_SONG_RE = /\bccli(?:\s+song)?(?:\s*(?:#|nr\.?|no\.?|number))?\s*[:#]?\s*(\d{5,})/i
export const CCLI_LICENSE_RE = /\b(?:ccli\s+)?(?:licence|license|lizenz)(?:\s*(?:#|nr\.?|no\.?))?\s*[:#]?\s*(\d{5,})/i
export const COPYRIGHT_MARK_RE = /(?:©|\(c\)|copyright|&copy;)/i
export const WEBSITE_RE = /(?:https?:\/\/|www\.)|\b[\w.-]+\.(?:com|de|org|net|info)\b/i
export const PAGE_NUMBER_RE = /^(?:page|seite)?\s*\d{1,3}\s*(?:\/\s*\d{1,3})?$/i
export const AUTHOR_LABEL_RE = /^(?:text|words|lyrics|musik|music|melodie|melody|weise|composer|komponist|autor|author|übersetz(?:er|ung)|translator|translation|nach\s+psalm)\b/i
export const TERMS_RE = /terms of use|nur für den|for use solely|all rights reserved|alle rechte vorbehalten|used by permission|mit freundlicher genehmigung/i

/**
 * Strip SongSelect-style "-lead-G" / "-lead-Bb" filename suffixes.
 */
export function stripLeadSheetFilenameSuffix(raw) {
  let text = String(raw || '').replace(PDF_EXT_RE, '').trim()
  text = text.replace(LEAD_SUFFIX_RE, '')
  text = text.replace(LEAD_BARE_RE, '')
  return text.replace(/\s+/g, ' ').trim()
}

export function titleFromFilename(filename) {
  return stripLeadSheetFilenameSuffix(String(filename || '').split(/[/\\]/).pop() || '')
}

const KEY_FROM_LEAD_RE = /[-–_]\s*lead(?:sheet)?\s*[-–_]?\s*([A-H](?:is|es|#|b)?m?|Bb|Eb|Ab)(?:\s*[-–_]?\s*\d+)?(?:\.pdf)?$/i

/** Filename suffix like `-lead-Bb` is a key hint, never a title fragment. */
export function keyFromLeadSheetFilename(filename) {
  const match = String(filename || '').match(KEY_FROM_LEAD_RE)
  return match ? match[1] : ''
}

function looksLikeTitle(text) {
  const value = String(text || '').trim()
  if (!value || value.length > 80) return false
  if (isMetadataText(value)) return false
  if (/^\[.+\]$/.test(value)) return false
  if (/^\d+$/.test(value)) return false
  return /[\p{L}]{3,}/u.test(value)
}

/**
 * Prefer native PDF title; else filename without -lead-G / -lead-A / -lead-Bb.
 * Never keep a title that is only a filename suffix or metadata line.
 */
export function preferSongTitle({ nativeTitle = '', filename = '', hint = '' } = {}) {
  const native = String(nativeTitle || '').replace(/\s+/g, ' ').trim()
  const strippedNative = stripLeadSheetFilenameSuffix(native)
  if (looksLikeTitle(native) && !LEAD_SUFFIX_RE.test(native)) return native
  const fromFile = titleFromFilename(filename)
  if (looksLikeTitle(fromFile)) return fromFile
  const cleanedHint = stripLeadSheetFilenameSuffix(hint)
  if (looksLikeTitle(cleanedHint)) return cleanedHint
  if (looksLikeTitle(strippedNative)) return strippedNative
  return native || fromFile || cleanedHint || ''
}

export function isHeaderMetaText(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim()
  return /^(?:key|tonart|tempo|bpm|time|capo)\s*[-–:=]/i.test(value)
}

export function isMetadataText(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!value) return false
  if (SONGSELECT_RE.test(value)) return true
  if (CCLI_SONG_RE.test(value) || CCLI_LICENSE_RE.test(value) || /\bccli\b/i.test(value)) return true
  if (COPYRIGHT_MARK_RE.test(value)) return true
  if (WEBSITE_RE.test(value)) return true
  if (TERMS_RE.test(value)) return true
  if (AUTHOR_LABEL_RE.test(value)) return true
  if (PAGE_NUMBER_RE.test(value)) return true
  if (/^(?:©\s*)?(?:19|20)\d{2}\b/.test(value) && /(?:verlag|music|gmbh|inc|ltd|publishing|kirchen|song)/i.test(value)) {
    return true
  }
  return false
}

export function classifyMetadataField(raw) {
  const value = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!value) return null
  if (CCLI_SONG_RE.test(value)) return 'ccliSongNumber'
  if (CCLI_LICENSE_RE.test(value)) return 'ccliLicense'
  if (AUTHOR_LABEL_RE.test(value) && /übersetz|translat/i.test(value)) return 'translator'
  if (AUTHOR_LABEL_RE.test(value) && /musik|music|melodie|melody|weise|composer|komponist/i.test(value)) return 'composer'
  if (AUTHOR_LABEL_RE.test(value) && /text|words|lyrics|autor|author/i.test(value)) return 'author'
  if (COPYRIGHT_MARK_RE.test(value) || /(?:19|20)\d{2}/.test(value) && /verlag|music|publishing/i.test(value)) {
    return 'copyright'
  }
  if (SONGSELECT_RE.test(value) || WEBSITE_RE.test(value) || TERMS_RE.test(value)) return 'copyright'
  if (PAGE_NUMBER_RE.test(value)) return 'pageNumber'
  if (/^(?:tempo|bpm)\b/i.test(value)) return 'bpm'
  if (/^(?:key|tonart)\b/i.test(value)) return 'key'
  if (isMetadataText(value)) return 'copyright'
  return null
}

function valueAfterLabel(raw) {
  return String(raw || '').replace(/^(?:text|words|lyrics|musik|music|melodie|melody|weise|composer|komponist|autor|author|übersetz(?:er|ung)|translator|translation)\s*(?:und\s+melodie)?\s*[:\-–]\s*/i, '').trim()
}

export function emptySongMetadata() {
  return {
    title: '',
    author: '',
    composer: '',
    translator: '',
    copyright: '',
    ccliSongNumber: '',
    ccliLicense: '',
    bpm: null,
    key: '',
  }
}

/**
 * Pull metadata fields from tokens or free text. Never returns lyric lines.
 */
export function extractSongMetadata(source, { filename = '', titleHint = '' } = {}) {
  const meta = emptySongMetadata()
  const lines = []
  if (Array.isArray(source)) {
    for (const token of source) {
      const text = String(token?.text || '').trim()
      if (text) lines.push(text)
    }
  } else {
    String(source || '').split(/\n+/).forEach((line) => {
      const text = line.trim()
      if (text) lines.push(text)
    })
  }

  const copyrightParts = []
  for (const line of lines) {
    const field = classifyMetadataField(line)
    if (field === 'ccliSongNumber') {
      meta.ccliSongNumber = (line.match(CCLI_SONG_RE) || [])[1] || meta.ccliSongNumber
    } else if (field === 'ccliLicense') {
      meta.ccliLicense = (line.match(CCLI_LICENSE_RE) || [])[1] || meta.ccliLicense
    } else if (field === 'author' && !meta.author) {
      meta.author = valueAfterLabel(line)
    } else if (field === 'composer' && !meta.composer) {
      meta.composer = valueAfterLabel(line)
    } else if (field === 'translator' && !meta.translator) {
      meta.translator = valueAfterLabel(line)
    } else if (field === 'copyright') {
      copyrightParts.push(line)
    }
  }
  if (copyrightParts.length) meta.copyright = [...new Set(copyrightParts)].join(' · ')

  const nativeTitle = lines.find((line) => looksLikeTitle(line) && !isMetadataText(line) && line.length > 8) || ''
  meta.title = preferSongTitle({ nativeTitle, filename, hint: titleHint })
  return meta
}

export function filterMetadataLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      return !isMetadataText(trimmed)
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
