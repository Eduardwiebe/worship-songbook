/**
 * Real lead-sheet MusicXML — melody on staff, chords above, lyrics under notes.
 * Never synthesize a leadsheet from chord-view (rehydrated) text.
 */

import { editorPitchMap, editorPitchName, normalizeEditorKey } from './editorKey.mjs'
import { chordPattern, pitchMap } from './leadsheetAnalysis.mjs'
import { lyricsToHomrNoteVerified } from './lyricsToHomrNotes.mjs'

function isExactChordSymbol(raw) {
  const text = String(raw || '').trim()
  if (!text || text.length > 18) return false
  const matches = [...text.matchAll(new RegExp(chordPattern.source, 'gu'))]
  return matches.length === 1 && matches[0][0] === text && matches[0][1] in pitchMap
}

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

function escapeXml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => XML_ESC[char] || char)
}

function fifthsForKey(key) {
  const map = {
    C: 0, G: 1, D: 2, A: 3, E: 4, H: 5, Fis: 6,
    F: -1, Bb: -2, Es: -3, As: -4, Des: -5, Ges: -6,
  }
  return map[normalizeEditorKey(key)] ?? 0
}

function parsePitchName(raw) {
  const text = String(raw || '')
  const match = text.match(/^(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])(.*)$/)
  if (!match) return { step: 'C', alter: 0, rest: raw }
  const german = {
    Cis: ['C', 1], Des: ['D', -1], Dis: ['D', 1], Es: ['E', -1],
    Fis: ['F', 1], Ges: ['G', -1], Gis: ['G', 1], As: ['A', -1], Ais: ['A', 1],
    'C#': ['C', 1], Db: ['D', -1], 'D#': ['D', 1], Eb: ['E', -1],
    'F#': ['F', 1], Gb: ['G', -1], 'G#': ['G', 1], Ab: ['A', -1], 'A#': ['A', 1],
    Bb: ['B', -1], H: ['B', 0], B: ['B', 0],
  }
  const mapped = german[match[1]] || [match[1], 0]
  return { step: mapped[0], alter: mapped[1], rest: match[2] }
}

function durationToType(quarters) {
  if (quarters >= 3.5) return 'whole'
  if (quarters >= 1.75) return 'half'
  if (quarters >= 0.75) return 'quarter'
  if (quarters >= 0.4) return 'eighth'
  return '16th'
}

function divisions() {
  return 4
}

function toDivisions(quarters) {
  return Math.max(1, Math.round((Number(quarters) || 1) * divisions()))
}

/**
 * Classify chord placement against note onsets.
 * onset-safe → exact; measure-only → keep + review; never fake X→beat certainty.
 */
export function classifyChordPlacement(chord, notes = [], { onsetPx = 28 } = {}) {
  const cx = Number.isFinite(chord?.x) ? chord.x : ((chord?.bbox?.[0] || 0) + (chord?.bbox?.[2] || 0)) / 2
  let best = null
  let bestDx = Infinity
  for (const note of notes) {
    const nx = Number.isFinite(note?.x) ? note.x : ((note?.bbox?.[0] || 0) + (note?.bbox?.[2] || 0)) / 2
    const dx = Math.abs(nx - cx)
    if (dx < bestDx) {
      best = note
      bestDx = dx
    }
  }
  const text = String(chord?.text || '').trim()
  if (best && bestDx <= onsetPx) {
    return {
      text,
      placement: 'onset',
      review: false,
      noteId: best.id || best.noteId || null,
      measure: best.measure ?? best.measureIndex,
      onset: best.onset ?? best.beat,
      dx: bestDx,
    }
  }
  if (chord?.measure != null || best?.measure != null) {
    return {
      text,
      placement: 'measure',
      review: true,
      noteId: null,
      measure: chord.measure ?? best?.measure ?? best?.measureIndex ?? null,
      onset: null,
      dx: bestDx,
    }
  }
  return {
    text,
    placement: 'review',
    review: true,
    noteId: null,
    measure: null,
    onset: null,
    dx: bestDx,
  }
}

function harmonyElement(chordText, { printFrame = false } = {}) {
  const { step, alter, rest } = parsePitchName(chordText)
  const kind = /m(?!aj)/.test(rest) ? 'minor'
    : /maj7/.test(rest) ? 'major-seventh'
      : /7/.test(rest) && !/maj/.test(rest) ? 'dominant'
        : /sus/.test(rest) ? 'suspended-fourth'
          : 'major'
  const bassMatch = rest.match(/\/(.+)$/)
  const alterXml = alter ? `<alter>${alter}</alter>` : ''
  const bassXml = bassMatch ? (() => {
    const bass = parsePitchName(bassMatch[1])
    const bassAlter = bass.alter ? `<alter>${bass.alter}</alter>` : ''
    return `<bass><bass-step>${bass.step}</bass-step>${bassAlter}</bass>`
  })() : ''
  // Keep printed symbol exact (b/m/maj7/sus/slash) via offset text when needed.
  return `<harmony print-frame="${printFrame ? 'yes' : 'no'}"><root><root-step>${step}</root-step>${alterXml}</root><kind>${kind}</kind>${bassXml}<staff>1</staff></harmony>`
}

function noteElement(note, lyric, syllabic = 'single') {
  const duration = toDivisions(note.duration || note.quarters || 1)
  const type = durationToType((note.duration || note.quarters || 1))
  const rest = note.rest ? '<rest/>' : ''
  let pitch = ''
  if (!note.rest) {
    const step = String(note.step || note.pitch?.[0] || 'G')
    const octave = Number(note.octave != null ? note.octave : 4)
    const alter = Number(note.alter || 0)
    const alterXml = alter ? `<alter>${alter}</alter>` : ''
    pitch = `<pitch><step>${escapeXml(step)}</step>${alterXml}<octave>${octave}</octave></pitch>`
  }
  const lyricXml = lyric
    ? `<lyric number="1"><syllabic>${syllabic}</syllabic><text>${escapeXml(lyric)}</text></lyric>`
    : ''
  return `<note>${rest}${pitch}<duration>${duration}</duration><voice>1</voice><type>${type}</type><stem>up</stem>${lyricXml}</note>`
}

function groupByMeasure(notes) {
  const map = new Map()
  for (const note of notes) {
    const measure = Number(note.measure ?? note.measureIndex ?? 1) || 1
    if (!map.has(measure)) map.set(measure, [])
    map.get(measure).push(note)
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
}

/**
 * Build a playable lead-sheet MusicXML document from OMR notes + native chords.
 * Lyrics stay syllabic under notes.
 */
export function buildLeadSheetMusicXml({
  title = '',
  key = 'C',
  time = '4/4',
  notes = [],
  chords = [],
  lyricTokens = [],
  sourceMusicXml = '',
} = {}) {
  const sourceHasMelody = sourceMusicXml && /<score-partwise/i.test(sourceMusicXml) && /<note[\s>]/i.test(sourceMusicXml)
  const sourceHasLyrics = /<lyric[\s>]/i.test(sourceMusicXml || '')
  // Keep Audiveris notation when it already has lyrics under notes.
  // If lyrics are missing, rebuild from parsed notes so underlay uses real note linkage
  // (never first-N sequential assignment).
  if (sourceHasMelody && (sourceHasLyrics || !notes.length)) {
    return overlayNativeChordsOnMusicXml(sourceMusicXml, chords, { title, key })
  }

  const usableNotes = (notes || []).filter((note) => note && (note.rest || note.step || note.pitch))
  const linkage = lyricsToHomrNoteVerified(lyricTokens, usableNotes)
  const lyricByNote = new Map(linkage.verified.map((item) => [String(item.noteId), item.text]))
  const placedChords = (chords || [])
    .filter((chord) => isExactChordSymbol(chord.text || chord.chord || ''))
    .map((chord) => classifyChordPlacement({
      ...chord,
      text: chord.text || chord.chord,
    }, usableNotes))

  const [beats, beatType] = String(time || '4/4').split('/').map((value) => Number(value) || 4)
  const fifths = fifthsForKey(key)
  const measures = groupByMeasure(usableNotes.length ? usableNotes : [{
    id: 'rest-1', measure: 1, rest: true, duration: 4, onset: 0, staff: 1, x: 0,
  }])

  const body = []
  measures.forEach(([number, measureNotes], index) => {
    const attrs = index === 0
      ? `<attributes><divisions>${divisions()}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>`
      : ''
    const chunks = []
    const measureChords = placedChords.filter((chord) => Number(chord.measure) === Number(number))
    let chordCursor = 0
    measureNotes
      .sort((a, b) => (Number(a.onset) || 0) - (Number(b.onset) || 0) || (a.x || 0) - (b.x || 0))
      .forEach((note, noteIndex) => {
        const onsetChord = measureChords.find((chord) => (
          chord.placement === 'onset' && String(chord.noteId) === String(note.id || note.noteId)
        ))
        const fallbackChord = !onsetChord && chordCursor < measureChords.length && noteIndex === 0
          ? measureChords.find((chord) => chord.placement === 'measure')
          : null
        const chosen = onsetChord || fallbackChord
        if (chosen) {
          chunks.push(harmonyElement(chosen.text))
          chordCursor += 1
        }
        const lyric = lyricByNote.get(String(note.id || note.noteId)) || note.lyric || ''
        const syllabic = lyric && /-$/.test(lyric) ? 'begin' : (note.syllabic || 'single')
        chunks.push(noteElement(note, String(lyric).replace(/-$/, ''), syllabic))
      })
    body.push(`<measure number="${number}">${attrs}${chunks.join('')}</measure>`)
  })

  const work = title ? `<work><work-title>${escapeXml(title)}</work-title></work>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">${work}<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1">${body.join('')}</part></score-partwise>`
}

function insertAfter(haystack, marker, insert) {
  const idx = haystack.indexOf(marker)
  if (idx < 0) return haystack
  const at = idx + marker.length
  return haystack.slice(0, at) + insert + haystack.slice(at)
}

/**
 * Keep Audiveris/HOMR melody; attach native PDF chord symbols exactly.
 */
export function overlayNativeChordsOnMusicXml(xml, chords = [], { title = '', key = '' } = {}) {
  let out = String(xml || '')
  if (title && /<work-title>/.test(out)) {
    out = out.replace(/<work-title>[^<]*<\/work-title>/, `<work-title>${escapeXml(title)}</work-title>`)
  } else if (title && /<score-partwise/.test(out) && !/<work>/.test(out)) {
    out = out.replace(/(<score-partwise[^>]*>)/, `$1<work><work-title>${escapeXml(title)}</work-title></work>`)
  }
  if (key && /<fifths>-?\d+<\/fifths>/.test(out)) {
    out = out.replace(/<fifths>-?\d+<\/fifths>/, `<fifths>${fifthsForKey(key)}</fifths>`)
  }

  const usable = (chords || []).filter((chord) => isExactChordSymbol(chord.text || chord.chord || ''))
  if (!usable.length) return out

  // Strip existing harmony so native symbols win (exact b/m/maj7/sus/slash).
  out = out.replace(/<harmony\b[\s\S]*?<\/harmony>/g, '')

  const measureRe = /<measure\b[^>]*number="(\d+)"[^>]*>/g
  const measureStarts = []
  let match
  while ((match = measureRe.exec(out))) {
    measureStarts.push({ number: Number(match[1]), index: match.index, tag: match[0] })
  }

  const byMeasure = new Map()
  for (const chord of usable) {
    const placed = classifyChordPlacement(chord, [])
    const measure = Number(chord.measure ?? placed.measure ?? 1) || 1
    if (!byMeasure.has(measure)) byMeasure.set(measure, [])
    byMeasure.get(measure).push({ ...chord, text: chord.text || chord.chord, ...placed })
  }

  // Insert from the end so indices stay valid.
  for (let i = measureStarts.length - 1; i >= 0; i -= 1) {
    const entry = measureStarts[i]
    const list = byMeasure.get(entry.number)
    if (!list?.length) continue
    // Onset-safe first; measure-only kept but still emitted (review flag is data, not dropped).
    const xmlHarmonies = list.map((chord) => harmonyElement(chord.text)).join('')
    out = insertAfter(out, entry.tag, xmlHarmonies)
  }
  return out
}

function transposePitchXml(xml, shift, targetKey) {
  return xml.replace(/<pitch>([\s\S]*?)<\/pitch>/g, (full, inner) => {
    const step = (inner.match(/<step>([A-G])<\/step>/) || [])[1]
    const alter = Number((inner.match(/<alter>(-?\d+)<\/alter>/) || [])[1] || 0)
    const octave = Number((inner.match(/<octave>(-?\d+)<\/octave>/) || [])[1] || 4)
    if (!step) return full
    const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + alter + shift + 1200) % 12
    const name = editorPitchName(semitone, targetKey)
    const parsed = parsePitchName(name)
    let oct = octave
    const raw = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + alter + shift
    oct += Math.floor(raw / 12)
    const alterXml = parsed.alter ? `<alter>${parsed.alter}</alter>` : ''
    return `<pitch><step>${parsed.step}</step>${alterXml}<octave>${oct}</octave></pitch>`
  })
}

function transposeHarmonyXml(xml, shift, targetKey) {
  return xml.replace(/<harmony\b[\s\S]*?<\/harmony>/g, (block) => {
    const root = (block.match(/<root-step>([A-G])<\/root-step>/) || [])[1]
    const rootAlter = Number((block.match(/<root>[\s\S]*?<alter>(-?\d+)<\/alter>/) || [])[1] || 0)
    if (!root) return block
    const semitone = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[root] + rootAlter + shift + 1200) % 12
    const name = editorPitchName(semitone, targetKey)
    const parsed = parsePitchName(name)
    let next = block.replace(/<root-step>[A-G]<\/root-step>/, `<root-step>${parsed.step}</root-step>`)
    next = next.replace(/<root>([\s\S]*?)<\/root>/, (full, inner) => {
      const withoutAlter = inner.replace(/<alter>-?\d+<\/alter>/, '')
      const alterXml = parsed.alter ? `<alter>${parsed.alter}</alter>` : ''
      return `<root>${withoutAlter.replace(/<root-step>[A-G]<\/root-step>/, `<root-step>${parsed.step}</root-step>`)}${alterXml}</root>`
    })
    return next.replace(/<bass-step>([A-G])<\/bass-step>/, (full, step) => {
      const bassAlter = Number((block.match(/<bass>[\s\S]*?<alter>(-?\d+)<\/alter>/) || [])[1] || 0)
      const bassSemi = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + bassAlter + shift + 1200) % 12
      const bassName = editorPitchName(bassSemi, targetKey)
      const bass = parsePitchName(bassName)
      return `<bass-step>${bass.step}</bass-step>`
    })
  })
}

/**
 * Transpose melody + chord symbols; lyrics unchanged. Enharmonics follow Bb/Eb/Ab.
 */
export function transposeMusicXml(xml, sourceKey, targetKey) {
  const source = normalizeEditorKey(sourceKey)
  const target = normalizeEditorKey(targetKey)
  if (!xml || !source || !target || source === target) return String(xml || '')
  const shift = ((editorPitchMap[target] - editorPitchMap[source]) + 120) % 12
  let out = String(xml)
  out = transposePitchXml(out, shift, target)
  out = transposeHarmonyXml(out, shift, target)
  out = out.replace(/<fifths>-?\d+<\/fifths>/, `<fifths>${fifthsForKey(target)}</fifths>`)
  return out
}

export function musicXmlHasMelody(xml) {
  const raw = String(xml || '')
  return /<score-partwise/i.test(raw) && /<note[\s>]/i.test(raw)
}
