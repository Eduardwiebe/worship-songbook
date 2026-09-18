/**
 * Lyric ↔ HOMR/Audiveris note linkage.
 *
 * A token is verified only when it has real note linkage fields.
 * Never mark the first N tokens verified without matches.
 */

function centerX(item) {
  if (Number.isFinite(item?.x)) return item.x
  const bbox = item?.bbox
  if (Array.isArray(bbox) && bbox.length >= 4) return (bbox[0] + bbox[2]) / 2
  return null
}

function centerY(item) {
  if (Number.isFinite(item?.y)) return item.y
  const bbox = item?.bbox
  if (Array.isArray(bbox) && bbox.length >= 4) return (bbox[1] + bbox[3]) / 2
  return null
}

function noteIdOf(note, index) {
  return String(note?.id || note?.noteId || `note-${index}`)
}

function hasRealNoteFields(note, index) {
  if (!note || typeof note !== 'object') return false
  const id = noteIdOf(note, index)
  const measure = note.measure ?? note.measureIndex ?? note.measure_id
  const onset = note.onset ?? note.beat ?? note.onsetBeat
  const staff = note.staff ?? note.staffIndex ?? note.staff_id
  if (!id || measure == null || measure === '') return false
  if (onset == null || onset === '') return false
  if (staff == null || staff === '') return false
  return true
}

function sameStaff(lyric, note) {
  const ls = lyric?.staff ?? lyric?.staffIndex
  const ns = note?.staff ?? note?.staffIndex
  if (ls == null || ns == null) return true
  return String(ls) === String(ns)
}

/**
 * Match each lyric token to at most one note by staff + onset/X proximity.
 * Unmatched tokens are omitted from `verified` (not auto-filled).
 *
 * @returns {{
 *   verified: Array<{ tokenIndex, text, noteId, measure, onset, staff, pitch, dx }>,
 *   unmatched: number[],
 *   rejectedFakePrefix: boolean
 * }}
 */
export function lyricsToHomrNoteVerified(lyricTokens = [], notes = [], { maxDx = 36 } = {}) {
  const lyrics = Array.isArray(lyricTokens) ? lyricTokens : []
  const usableNotes = (Array.isArray(notes) ? notes : [])
    .map((note, index) => ({ note, index }))
    .filter(({ note, index }) => hasRealNoteFields(note, index))

  const usedNotes = new Set()
  const verified = []
  const unmatched = []

  for (let tokenIndex = 0; tokenIndex < lyrics.length; tokenIndex += 1) {
    const token = lyrics[tokenIndex]
    const text = String(token?.text || '').trim()
    if (!text) {
      unmatched.push(tokenIndex)
      continue
    }
    const tx = centerX(token)
    let best = null
    let bestDx = Infinity
    for (const { note, index } of usableNotes) {
      if (usedNotes.has(index)) continue
      if (!sameStaff(token, note)) continue
      const nx = centerX(note)
      if (tx == null || nx == null) continue
      const dx = Math.abs(nx - tx)
      const ty = centerY(token)
      const ny = centerY(note)
      const dy = ty == null || ny == null ? 0 : Math.abs(ny - ty)
      if (dx <= maxDx && dx < bestDx && dy < 140) {
        best = { note, index, dx }
        bestDx = dx
      }
    }
    if (!best) {
      unmatched.push(tokenIndex)
      continue
    }
    usedNotes.add(best.index)
    const note = best.note
    verified.push({
      tokenIndex,
      text,
      noteId: noteIdOf(note, best.index),
      measure: note.measure ?? note.measureIndex,
      onset: note.onset ?? note.beat ?? note.onsetBeat,
      staff: note.staff ?? note.staffIndex,
      pitch: note.pitch || note.step || null,
      dx: best.dx,
    })
  }

  return {
    verified,
    unmatched,
    rejectedFakePrefix: true,
  }
}

/**
 * Guard: reject any "verified" list that is just the first N lyrics with no linkage.
 */
export function assertRealNoteLinkage(verified = []) {
  for (const item of verified) {
    if (!item || item.noteId == null || item.measure == null || item.onset == null || item.staff == null) {
      throw new Error('verified lyric is missing real note linkage fields')
    }
  }
  return true
}

export const lyrics_to_homr_note_verified = lyricsToHomrNoteVerified
