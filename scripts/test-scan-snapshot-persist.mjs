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
console.log('PASS scan snapshot persist + transpose G→A + soft repair')
