/**
 * Chord-view (Akkordansicht) text repair.
 *
 * SongSelect / lead-sheet PDFs store lyrics as sung syllables
 * ("Bahnt ei nen Weg un serm Gott"). Guitar charts need real words.
 * This module never feeds MusicXML / lead-sheet underlay.
 */

import { isClosedClassWord, isProtectedWholeWord } from './ocrTextRefine.mjs'
import { isChordLine } from './leadsheetAnalysis.mjs'
import { isMetadataText, stripLeadSheetFilenameSuffix } from './songMetadata.mjs'

const VOWEL = /[aeiouyäöüAEIOUYÄÖÜ]/

const SHORT_WORD = new Set([
  'so', 'ja', 'nur', 'hin', 'her', 'vor', 'aus', 'auf', 'ob', 'da', 'na', 'nie',
  'neu', 'gut', 'hat', 'nun', 'weg', 'tod', 'tot', 'lob', 'ruh', 'oh', 'ah',
  'am', 'im', 'an', 'in', 'es', 'er', 'sie', 'wir', 'ihr', 'du', 'zu', 'um', 'ab',
  'nein', 'mein', 'dein', 'sein', 'uns', 'mir', 'dir', 'ich', 'und', 'als', 'der',
  'die', 'das', 'ein', 'mit', 'bei', 'von', 'für', 'fur', 'war', 'ist', 'den',
  'dem', 'des', 'sei', 'bin', 'o', 'gott', 'not', 'herr', 'volk', 'kreuz', 'macht',
  'reich', 'hier', 'bahn', 'bahnt', 'dich', 'euch', 'auch', 'noch', 'nur', 'mal',
  'schon', 'wenn', 'dass', 'daß', 'oder', 'aber', 'durch', 'nach', 'vom', 'zum',
  'zur', 'beim', 'ins', 'ans', 'aufs',
])

/** Concatenations that are real words when syllables sit apart. */
const JOIN_LEXICON = new Set([
  'einen', 'einem', 'einer', 'eines', 'unserm', 'unserem', 'unserer', 'unsere',
  'unser', 'unseren', 'unsre', 'ehre', 'heilig', 'herrlichkeit', 'herrlich',
  'halleluja', 'hallelujah', 'komme', 'kommen', 'öffnet', 'oeffnet', 'herzen',
  'herz', 'könig', 'koenig', 'könige', 'gesiegt', 'erhebe', 'deiner', 'deinem',
  'deinen', 'ewigkeit', 'herrschen', 'erwählt', 'erwaehlt', 'erlöst', 'erloest',
  'bereit', 'majestät', 'majestaet', 'barmherzig', 'geduld', 'sehnsucht',
  'seinen', 'seinem', 'seiner', 'öffnen', 'oeffnen',
])

const SECTION_LINE_RE = /^(?:\[)?\s*(?:Verse|Chorus|Bridge|Intro|Outro|Pre-?Chorus|Tag|Instrumental|Interlude|Turnaround|Ending|Vamp|Strophe|Refrain|VERS|CHORUS|BRIDGE|Zwischenspiel|Schluss|Coda|Hook|Break)(?:\s*\d+)?\s*(?:\])?\s*:?\s*$/i
const ENDING_RE = /^(?:keit|heit|lich|ung|chen|lein|zig|zen|nig|tät|taet)$/i
const WORD_RE = /\d+\.|[\p{L}]+[.,:;!?]*/gu

function core(raw) {
  return String(raw || '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase()
}

export function isStandaloneLyricWord(raw) {
  const value = core(raw)
  if (!value) return false
  if (isClosedClassWord(value) || SHORT_WORD.has(value) || isProtectedWholeWord(value)) return true
  if (value.length >= 5 && VOWEL.test(value)) return true
  if (value.length >= 4 && /^\p{Lu}/u.test(String(raw || '').trim())) return true
  return false
}

export function isLyricFragment(raw) {
  const text = String(raw || '').trim()
  if (!text || /^\d+\.$/.test(text)) return false
  if (isStandaloneLyricWord(text)) return false
  const value = core(text)
  if (!value) return false
  return value.length <= 4 || /-$/.test(text)
}

function isSectionLine(line) {
  return SECTION_LINE_RE.test(String(line || '').trim())
}

function isMetaLine(line) {
  return /^(?:TONART|KEY|TEMPO|CAPO|BPM)\b/i.test(String(line || '').trim())
}

export function isCreditLine(line) {
  const text = String(line || '').trim()
  if (!text || text.length > 90) return false
  if (/\btext und\b/i.test(text) && /\b(?:musik|melodie)\b/i.test(text)) return true
  if (/^(?:text|musik|melodie|words|music)\b/i.test(text) && /[:&]/.test(text) && text.length < 60) return true
  return false
}

export function isChordViewNoiseLine(line) {
  const text = String(line || '').trim()
  if (!text) return false
  const bare = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim()
  if (/^(?:♩\s*)?=\s*\d{2,3}$/.test(bare)) return true
  if (/^♩/.test(bare) && /\d{2,3}/.test(bare) && bare.length < 16) return true
  if (/^(?:tempo|bpm)\b/i.test(bare)) return true
  if (isMetadataText(text) || isCreditLine(text)) return true
  return false
}

function cleanTitleSuffixLine(line) {
  const text = String(line || '')
  if (!text.trim() || isChordLine(text) || isSectionLine(text)) return text
  if (!/[-–_]\s*lead(?:sheet)?/i.test(text)) return text
  const stripped = stripLeadSheetFilenameSuffix(text.trim())
  return stripped || text
}

function tokenizeLyric(line) {
  const raw = String(line ?? '')
  const tokens = []
  const re = new RegExp(WORD_RE.source, 'gu')
  let match
  while ((match = re.exec(raw))) {
    tokens.push({ raw: match[0], start: match.index, end: match.index + match[0].length })
  }
  return tokens
}

function endsSentence(token) {
  return /[.:;!?]$/.test(token.raw) && !/^\d+\.$/.test(token.raw)
}

function startsNewCapitalWord(token) {
  return /^\p{Lu}/u.test(token.raw) && isStandaloneLyricWord(token.raw)
}

function endingJoin(left, right) {
  const leftCore = core(left.raw)
  const rightCore = core(right.raw)
  if (!leftCore || !ENDING_RE.test(rightCore)) return false
  if (isClosedClassWord(leftCore)) return false
  if (endsSentence(left)) return false
  if (isStandaloneLyricWord(right.raw)) return false
  if (/^\p{Lu}/u.test(right.raw)) return false
  return leftCore.length >= 2
}

function shouldMergeSlice(tokens) {
  if (tokens.length < 2) return false
  if (tokens.some((token) => /^\d+\.$/.test(token.raw))) return false
  for (let i = 1; i < tokens.length; i += 1) {
    if (endsSentence(tokens[i - 1])) return false
    if (startsNewCapitalWord(tokens[i])) return false
  }
  const joined = tokens.map((token) => core(token.raw)).join('')
  if (!joined || !VOWEL.test(joined) || joined.length > 22) return false
  if (JOIN_LEXICON.has(joined)) {
    const standalone = tokens.map((token) => isStandaloneLyricWord(token.raw))
    if (!standalone.every(Boolean)) return true
    return tokens.every((token) => core(token.raw).length <= 3)
  }
  if (tokens.every((token) => isLyricFragment(token.raw) && core(token.raw).length <= 3)) return true
  if (tokens.length === 2 && endingJoin(tokens[0], tokens[1])) return true
  return false
}

function groupTokens(tokens) {
  const groups = []
  let i = 0
  while (i < tokens.length) {
    if (/^\d+\.$/.test(tokens[i].raw)) {
      groups.push([tokens[i]])
      i += 1
      continue
    }
    let best = i
    const max = Math.min(tokens.length - 1, i + 4)
    for (let j = i + 1; j <= max; j += 1) {
      if (endsSentence(tokens[j - 1]) || startsNewCapitalWord(tokens[j])) break
      if (shouldMergeSlice(tokens.slice(i, j + 1))) best = j
    }
    groups.push(tokens.slice(i, best + 1))
    i = best + 1
  }
  return groups
}

function mergeGroupText(group) {
  const cores = group.map((token) => token.raw.replace(/[.,:;!?]+$/u, ''))
  const punct = (group[group.length - 1].raw.match(/[.,:;!?]+$/u) || [''])[0]
  return `${cores.join('')}${punct}`
}

/**
 * Merge space-separated syllables on one lyric line.
 * @returns {{ text: string, map: number[], changed: boolean }}
 * map[oldIndex] is the index in the merged string.
 */
export function mergeSyllabicLyricLine(line) {
  const raw = String(line ?? '')
  const tokens = tokenizeLyric(raw)
  if (tokens.length < 2) {
    const map = Array.from({ length: raw.length + 1 }, (_, index) => index)
    return { text: raw, map, changed: false }
  }
  const groups = groupTokens(tokens)
  if (groups.every((group) => group.length === 1)) {
    const map = Array.from({ length: raw.length + 1 }, (_, index) => index)
    return { text: raw, map, changed: false }
  }

  let text = ''
  const map = new Array(raw.length + 1)
  let oldPos = 0
  for (const group of groups) {
    const start = group[0].start
    while (oldPos < start) {
      map[oldPos] = text.length
      text += raw[oldPos]
      oldPos += 1
    }
    const merged = mergeGroupText(group)
    const newStart = text.length
    text += merged
    let written = 0
    for (const token of group) {
      while (oldPos < token.start) {
        map[oldPos] = newStart + Math.min(written, Math.max(merged.length - 1, 0))
        oldPos += 1
      }
      const letters = token.raw.replace(/[.,:;!?]+$/u, '')
      for (let k = 0; k < letters.length && oldPos < token.end; k += 1) {
        map[oldPos] = newStart + written
        written += 1
        oldPos += 1
      }
    }
    const last = group[group.length - 1]
    while (oldPos < last.end) {
      map[oldPos] = newStart + Math.min(written, Math.max(merged.length - 1, 0))
      if (written < merged.length) written += 1
      oldPos += 1
    }
  }
  while (oldPos < raw.length) {
    map[oldPos] = text.length
    text += raw[oldPos]
    oldPos += 1
  }
  map[raw.length] = text.length
  return { text, map, changed: text !== raw }
}

function isPlainLyric(line) {
  const text = String(line || '')
  if (!text.trim()) return false
  if (isChordLine(text) || isChordLine(text.trim())) return false
  if (isSectionLine(text) || isMetaLine(text) || isChordViewNoiseLine(text)) return false
  return true
}

function isSingleChordLine(line) {
  if (!isChordLine(line) && !isChordLine(String(line || '').trim())) return false
  return String(line || '').trim().split(/\s+/).length === 1
}

function isCollapseLyric(line) {
  if (!isPlainLyric(line)) return false
  const text = line.trim()
  const words = text.split(/\s+/)
  return words.length <= 2 && text.length <= 14
}

function isSyllabicSoupLine(line) {
  if (!isPlainLyric(line)) return false
  const words = line.trim().split(/\s+/)
  if (!words.length || words.length > 3 || line.trim().length > 24) return false
  const fragments = words.filter((word) => isLyricFragment(word))
  return fragments.length * 2 >= words.length && fragments.length >= 1
}

function placeChordsOnWords(chords, words) {
  const lyric = words.join(' ')
  const slots = []
  let cursor = 0
  let occupied = -1
  const anchors = []
  for (let i = 0; i < words.length; i += 1) {
    const chord = String(chords[i] || '').trim()
    if (chord) {
      const index = Math.max(cursor, occupied)
      anchors.push({ chord, index })
      occupied = index + chord.length + 1
    }
    cursor += words[i].length + 1
  }
  if (!anchors.length) return { chordLine: '', lyricLine: lyric }
  for (const anchor of anchors) {
    while (slots.length < anchor.index + anchor.chord.length) slots.push(' ')
    for (let i = 0; i < anchor.chord.length; i += 1) slots[anchor.index + i] = anchor.chord[i]
  }
  return { chordLine: slots.join('').replace(/\s+$/g, ''), lyricLine: lyric }
}

function flushCollapsedPairs(pairs) {
  const out = []
  let words = []
  let chords = []
  let width = 0
  const flush = () => {
    if (!words.length) return
    const placed = placeChordsOnWords(chords, words)
    if (placed.chordLine.trim()) out.push(placed.chordLine)
    out.push(placed.lyricLine)
    words = []
    chords = []
    width = 0
  }
  for (const pair of pairs) {
    const add = pair.lyric.length + (words.length ? 1 : 0)
    if (words.length && width + add > 42) flush()
    words.push(pair.lyric)
    chords.push(pair.chord)
    width += pair.lyric.length + (words.length > 1 ? 1 : 0)
  }
  flush()
  return out
}

/**
 * Join one-token-per-line chord/word stacks into a single playable row.
 * "G / Dein / Dsus / Macht." → chords above "Dein Macht."
 */
export function collapseVerticalTokenLines(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    if (isSingleChordLine(lines[i]) && isCollapseLyric(lines[i + 1] || '')) {
      const pairs = []
      let j = i
      while (j < lines.length && isSingleChordLine(lines[j]) && isCollapseLyric(lines[j + 1] || '')) {
        pairs.push({ chord: lines[j].trim(), lyric: lines[j + 1].trim() })
        j += 2
      }
      if (pairs.length >= 2) {
        out.push(...flushCollapsedPairs(pairs))
        i = j
        continue
      }
    }
    if (isSyllabicSoupLine(lines[i])) {
      const soup = [lines[i].trim()]
      let j = i + 1
      while (j < lines.length && isSyllabicSoupLine(lines[j])) {
        soup.push(lines[j].trim())
        j += 1
      }
      if (soup.length >= 2) {
        out.push(soup.join(' '))
        i = j
        continue
      }
    }
    out.push(lines[i])
    i += 1
  }
  return out
}

function lastWord(line) {
  const words = String(line || '').trim().split(/\s+/)
  return words[words.length - 1] || ''
}

/**
 * Glue a leftover syllable ("ner") back onto the lyric it fell off of.
 */
export function stitchOrphanFragments(lines) {
  const out = []
  for (const line of lines) {
    const lone = String(line || '').trim()
    const words = lone.split(/\s+/).filter(Boolean)
    const fragment = words.length === 1 && isLyricFragment(words[0]) && core(words[0]).length <= 4
    if (fragment && out.length) {
      let lyricIdx = out.length - 1
      let pendingChord = null
      if (isChordLine(out[lyricIdx]) || isChordLine(String(out[lyricIdx] || '').trim())) {
        pendingChord = out[lyricIdx]
        lyricIdx -= 1
      }
      if (lyricIdx >= 0 && isPlainLyric(out[lyricIdx]) && isLyricFragment(lastWord(out[lyricIdx]))) {
        const wordStart = `${out[lyricIdx].replace(/\s+$/g, '')} `.length
        out[lyricIdx] = `${out[lyricIdx].replace(/\s+$/g, '')} ${lone}`
        if (pendingChord != null) {
          out.pop()
          const chordIdx = lyricIdx - 1
          if (chordIdx >= 0 && (isChordLine(out[chordIdx]) || isChordLine(String(out[chordIdx]).trim()))) {
            const prev = out[chordIdx].replace(/\s+$/g, '')
            const pad = Math.max(1, wordStart - prev.length)
            out[chordIdx] = `${prev}${' '.repeat(pad)}${pendingChord.trim()}`.replace(/\s+$/g, '')
          } else {
            out.splice(lyricIdx, 0, pendingChord)
          }
        }
        continue
      }
    }
    out.push(line)
  }
  return out
}

/**
 * Strip tempo/CCLI/credits and join vertical syllable stacks.
 * Syllable merging with chord remap happens in chartLayout (needs pack).
 */
export function prepareChordViewStructure(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .filter((line) => !isChordViewNoiseLine(line))
    .map(cleanTitleSuffixLine)
  return stitchOrphanFragments(collapseVerticalTokenLines(lines))
}
