#!/usr/bin/env node
/**
 * Persist scan snapshots even when analysis left a stale needsReview flag,
 * as long as document/vision key and chord analysis agree.
 */
import { DatabaseSync } from 'node:sqlite'
import {
  applyEditorKeyChange,
  inferKeyFromLeadsheet,
  resolveEditorSnapshot,
} from '../lib/editorKey.mjs'
import {
  evaluateScanSnapshotVerification,
  initializeSongTrustSchema,
  persistScanSnapshot,
  repairSongSnapshotFromStoredText,
  snapshotStateResponse,
  getSongSnapshotState,
} from '../lib/songTrust.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const sampleG = `TONART: G

[Verse]
G                 D
Sample lyric line here
Em                C
Another lyric line
`

const sampleD = `TONART: D

[Verse]
D                 A
Sample lyric line here
Bm                G
Another lyric line
`

const staleNeedsReview = {
  text: sampleG,
  key: 'G',
  method: 'PDF-Text',
  needsReview: true,
  avgConfidence: 0.9,
}

const evaluation = evaluateScanSnapshotVerification(staleNeedsReview)
assert(evaluation.verified === true, 'stale needsReview must not block key agreement')
assert(evaluation.detectedKey === 'G', 'detected key is G')

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    file_name TEXT,
    file_size INTEGER,
    pdf_path TEXT,
    sort_order INTEGER,
    created_at TEXT,
    song_key TEXT DEFAULT '–',
    source_key TEXT DEFAULT '',
    preferred_key TEXT DEFAULT '',
    owner_id TEXT
  );
  CREATE TABLE song_variants (
    song_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    source_key TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT,
    PRIMARY KEY(song_id, target_key)
  );
`)
initializeSongTrustSchema(db)
db.prepare(`
  INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,source_key,owner_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`).run('song-g', 'Sample G', 'Text-Import', 'sample.pdf', 100, '/tmp/sample.pdf', 1, new Date().toISOString(), '–', '', 'user')

persistScanSnapshot(db, {
  songId: 'song-g',
  pdfPath: '/tmp/sample.pdf',
  documentHash: 'abc',
  result: staleNeedsReview,
})

const state = snapshotStateResponse(getSongSnapshotState(db, 'song-g'))
assert(state.sourceKeyVerified === true, 'persisted snapshot is verified')
assert(state.sourceKey === 'G', 'persisted source key is G')
const resolved = resolveEditorSnapshot(state)
assert(resolved.ok === true && resolved.sourceKey === 'G', 'editor resolves verified G snapshot')

const transposed = applyEditorKeyChange(resolved.originalText, resolved.sourceKey, 'A')
assert(!transposed.blocked, 'transpose G→A not blocked')
assert(/\bA\b/.test(transposed.text), 'contains A chord after transpose')
assert(/\bE\b/.test(transposed.text), 'D becomes E')
assert(/F#m|Fis/.test(transposed.text), 'Em becomes F#m')
assert(/\bD\b/.test(transposed.text), 'C becomes D')

db.prepare(`
  INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,source_key,owner_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`).run('song-repair', 'Repair Me', 'PDF-Import', 'repair.pdf', 100, '/tmp/repair.pdf', 2, new Date().toISOString(), '–', '', 'user')

persistScanSnapshot(db, {
  songId: 'song-repair',
  pdfPath: '/tmp/repair.pdf',
  documentHash: 'def',
  result: {
    text: sampleD,
    key: 'D',
    method: 'PDF-Text',
    needsReview: true,
    document: { key: 'C' },
  },
})

let repairState = getSongSnapshotState(db, 'song-repair')
if (repairState.status !== 'verified') {
  const soft = repairSongSnapshotFromStoredText(db, 'song-repair')
  assert(soft.repaired === true, 'soft repair upgrades agreeing stored text')
  const repaired = snapshotStateResponse(soft.state)
  assert(repaired.sourceKey === 'D' && repaired.sourceKeyVerified, 'soft repair yields verified D')
} else {
  // Conflict path chose chords and still verified after our rule change; acceptable.
  assert(snapshotStateResponse(repairState).sourceKey === 'D', 'conflict path stored D from chords')
}

assert(inferKeyFromLeadsheet('Key - D | Time - 4/4') === 'D', 'Key - D header')
// SongSelect headers with borrowed chords must still verify (Key - C / Key - E).
const songSelectC = `Key - C | Time - 4/4

[VERS 1]
    C        Bb/C   C
Ich trau auf dich o Herr
    Em   Am           Dm Gsus
Ich sage Du bist mein Gott
   Am     Em         F  G
In deiner Hand steht meine Zeit
   Dm                F/G    C Csus
In deiner Hand steht meine Zeit
`
const songSelectE = `Key - E | Time - 4/4

[Refrain]
E           B/D#             C#m C#m/B
Würdig und herrlich ist das Lamm
E/G#        F#/A#    B
Jesus dir allein sei Ehre
E         E7               A
Du der du sitzt auf deinem Thron
E/B     B           E
Dir sei Ruhm in Ewigkeit

[BRIDGE]
     D           A/E     E
Halleluja sei erhoben o Herr
        D             A/E        E
Du bist König und wir beugen uns Herr
      C#m    C#m/B         B
In Anbetung singen wir zu dir
`

assert(inferKeyFromLeadsheet('Key - E | Time - 4/4') === 'E', 'Key - E header')
assert(inferKeyFromLeadsheet('Key - C | Time - 4/4') === 'C', 'Key - C header')

const evalC = evaluateScanSnapshotVerification({
  text: songSelectC,
  key: 'C',
  method: 'PDF-Text',
  needsReview: true,
  avgConfidence: 0.9,
})
assert(evalC.documentKey === 'C', 'SongSelect C documentKey')
assert(evalC.chordKey === 'F', 'borrowed Bb makes chord scorer prefer F')
assert(evalC.resolved.key === 'C', 'document Key - C wins over chord F')
assert(evalC.resolved.needsReview === false, 'document key conflict is not review-blocking')
assert(evalC.verified === true, 'SongSelect C verifies despite chord conflict')
assert(evalC.detectedKey === 'C', 'detectedKey C')

const evalE = evaluateScanSnapshotVerification({
  text: songSelectE,
  key: 'E',
  method: 'PDF-Text',
  needsReview: true,
  avgConfidence: 0.9,
})
assert(evalE.documentKey === 'E', 'SongSelect E documentKey')
assert(evalE.chordKey === 'A', 'borrowed D makes chord scorer prefer A')
assert(evalE.resolved.key === 'E', 'document Key - E wins over chord A')
assert(evalE.verified === true && evalE.detectedKey === 'E', 'SongSelect E verifies')

db.prepare(`
  INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,source_key,owner_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
`).run('song-e', 'Würdig', 'PDF-Import', 'e.pdf', 100, '/tmp/e.pdf', 3, new Date().toISOString(), '–', '', 'user')

persistScanSnapshot(db, {
  songId: 'song-e',
  pdfPath: '/tmp/e.pdf',
  documentHash: 'eee',
  result: { text: songSelectE, key: 'E', method: 'PDF-Text', needsReview: true },
})
const stateE = snapshotStateResponse(getSongSnapshotState(db, 'song-e'))
assert(stateE.sourceKeyVerified === true && stateE.sourceKey === 'E', 'persisted SongSelect E verified')
const softE = repairSongSnapshotFromStoredText(db, 'song-e')
assert(softE.repaired === false && softE.reason === 'already_verified', 'soft repair no-op when verified')

console.log('PASS scan snapshot persist + transpose G→A + soft repair + SongSelect Key - C/E')

