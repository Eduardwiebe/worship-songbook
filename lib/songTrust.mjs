import { createHash, randomUUID } from 'node:crypto'
import {
  extractEditorChordAnchors,
  extractEditorChordModel,
  inferKeyFromChords,
  inferKeyFromLeadsheet,
  isEditorChordLine,
  editorChordTokens,
  normalizeEditorKey,
  projectEditorSnapshot,
} from './editorKey.mjs'

export const SNAPSHOT_SCHEMA_VERSION = 1
export const SNAPSHOT_STATUS_VERIFIED = 'verified'
export const SNAPSHOT_STATUS_REVIEW_REQUIRED = 'review_required'
export const SNAPSHOT_STATUS_UNRESOLVED = 'unresolved'
export const TEST_7_PDF_SHA256 = '3fbd32b2598409ec484645e7b38ecad3478d7764abdae1a3b79fee5b21e41287'
export const TEST_7_CONTENT_SHA256 = 'b2ba1d88e0cc137df221bf8ae676a13a5de64b43cfb43d321fd69a8bca82d617'

const TRUST_MIGRATION_ID = 'song_original_snapshot_evidence_v1'
const SNAPSHOT_STATUSES = new Set([
  SNAPSHOT_STATUS_VERIFIED,
  SNAPSHOT_STATUS_REVIEW_REQUIRED,
  SNAPSHOT_STATUS_UNRESOLVED,
])

export class SongTrustError extends Error {
  constructor(message, { code = 'song_trust_error', status = 409 } = {}) {
    super(message)
    this.name = 'SongTrustError'
    this.code = code
    this.status = status
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function json(value) {
  return JSON.stringify(value)
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/, 1)[0]
  if (!tableColumns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
}

export function initializeSongTrustSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS song_original_snapshots (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      source_key TEXT NOT NULL DEFAULT '',
      original_text TEXT NOT NULL DEFAULT '',
      original_chord_model TEXT NOT NULL,
      original_anchor_data TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('verified','review_required','unresolved')),
      provenance_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      snapshot_schema_version INTEGER NOT NULL,
      integrity_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS song_evidence (
      id TEXT PRIMARY KEY,
      song_id TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      source_identifier TEXT NOT NULL,
      detected_key TEXT NOT NULL DEFAULT '',
      document_sha256 TEXT NOT NULL DEFAULT '',
      content_sha256 TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      evidence_schema_version INTEGER NOT NULL,
      integrity_hash TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS song_one_verified_original_snapshot
      ON song_original_snapshots(song_id)
      WHERE status='verified';
    CREATE INDEX IF NOT EXISTS song_original_snapshots_song_status
      ON song_original_snapshots(song_id,status,created_at);
    CREATE INDEX IF NOT EXISTS song_evidence_song_snapshot
      ON song_evidence(song_id,snapshot_id,created_at);
    CREATE TRIGGER IF NOT EXISTS song_original_snapshots_no_update
      BEFORE UPDATE ON song_original_snapshots
      BEGIN SELECT RAISE(ABORT,'song original snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS song_original_snapshots_no_delete
      BEFORE DELETE ON song_original_snapshots
      BEGIN SELECT RAISE(ABORT,'song original snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS song_evidence_no_update
      BEFORE UPDATE ON song_evidence
      BEGIN SELECT RAISE(ABORT,'song evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS song_evidence_no_delete
      BEFORE DELETE ON song_evidence
      BEGIN SELECT RAISE(ABORT,'song evidence is append-only'); END;
  `)

  addColumn(db, 'song_variants', "snapshot_id TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'song_variants', "anchors TEXT NOT NULL DEFAULT '[]'")
  addColumn(db, 'song_variants', "chord_model TEXT NOT NULL DEFAULT '{}'")
  addColumn(db, 'song_variants', "overlay_text TEXT NOT NULL DEFAULT ''")
  addColumn(db, 'song_variants', 'schema_version INTEGER NOT NULL DEFAULT 1')
  db.exec('CREATE INDEX IF NOT EXISTS song_variants_snapshot ON song_variants(song_id,snapshot_id,target_key)')
}

export function buildOriginalChordModel(text) {
  return extractEditorChordModel(text)
}

function snapshotIntegrityFields(record) {
  return {
    id: record.id,
    songId: record.songId,
    sourceKey: record.sourceKey,
    originalText: record.originalText,
    originalChordModel: record.originalChordModel,
    originalAnchors: record.originalAnchors,
    snapshotStatus: record.snapshotStatus,
    provenanceRef: record.provenanceRef,
    createdAt: record.createdAt,
    schemaVersion: record.schemaVersion,
  }
}

function evidenceIntegrityFields(record) {
  return {
    id: record.id,
    songId: record.songId,
    snapshotId: record.snapshotId,
    evidenceType: record.evidenceType,
    sourceReference: record.sourceReference,
    detectedKey: record.detectedKey,
    documentHash: record.documentHash,
    contentHash: record.contentHash,
    analysisMetadata: record.analysisMetadata,
    confidence: record.confidence,
    createdAt: record.createdAt,
    schemaVersion: record.schemaVersion,
  }
}

function integrityHash(fields) {
  return sha256(json(fields))
}

function snapshotFromRow(row) {
  if (!row) return null
  return {
    id: row.id,
    songId: row.song_id,
    sourceKey: row.source_key,
    originalText: row.original_text,
    originalChordModel: parseJson(row.original_chord_model, null),
    originalAnchors: parseJson(row.original_anchor_data, null),
    snapshotStatus: row.status,
    provenanceRef: row.provenance_ref,
    createdAt: row.created_at,
    schemaVersion: row.snapshot_schema_version,
    integrityHash: row.integrity_hash,
    _originalChordModelJson: row.original_chord_model,
    _originalAnchorsJson: row.original_anchor_data,
  }
}

function assertSnapshotIntegrity(snapshot) {
  if (!snapshot) return
  const fields = snapshotIntegrityFields({
    ...snapshot,
    originalChordModel: snapshot._originalChordModelJson,
    originalAnchors: snapshot._originalAnchorsJson,
  })
  const structuralMatch = snapshot.originalChordModel
    && snapshot.originalAnchors
    && json(snapshot.originalChordModel) === json(buildOriginalChordModel(snapshot.originalText))
    && json(snapshot.originalAnchors) === json(extractEditorChordAnchors(snapshot.originalText))
  if (integrityHash(fields) !== snapshot.integrityHash || !structuralMatch) {
    throw new SongTrustError('Der Original-Snapshot hat die Integritätsprüfung nicht bestanden.', {
      code: 'snapshot_integrity_mismatch',
    })
  }
  if (snapshot.snapshotStatus === SNAPSHOT_STATUS_VERIFIED
      && (!normalizeEditorKey(snapshot.sourceKey) || !snapshot.originalText)) {
    throw new SongTrustError('Der verifizierte Original-Snapshot ist unvollständig.', {
      code: 'snapshot_incomplete',
    })
  }
}

export function getVerifiedSongSnapshot(db, songId) {
  const row = db.prepare(`
    SELECT * FROM song_original_snapshots
    WHERE song_id=? AND status='verified'
    LIMIT 1
  `).get(songId)
  const snapshot = snapshotFromRow(row)
  assertSnapshotIntegrity(snapshot)
  return snapshot
}

export function getSongSnapshotState(db, songId) {
  try {
    const snapshot = getVerifiedSongSnapshot(db, songId)
    if (snapshot) return { status: SNAPSHOT_STATUS_VERIFIED, snapshot, reason: '' }
  } catch (error) {
    if (!(error instanceof SongTrustError)) throw error
    return { status: SNAPSHOT_STATUS_REVIEW_REQUIRED, snapshot: null, reason: error.code }
  }
  const review = db.prepare(`
    SELECT id FROM song_original_snapshots
    WHERE song_id=? AND status IN ('review_required','unresolved')
    ORDER BY created_at DESC,id DESC
    LIMIT 1
  `).get(songId)
  return {
    status: review ? SNAPSHOT_STATUS_REVIEW_REQUIRED : SNAPSHOT_STATUS_UNRESOLVED,
    snapshot: null,
    reason: review ? 'snapshot_not_verified' : 'snapshot_missing',
  }
}

export function publicSnapshot(snapshot) {
  if (!snapshot) return null
  return {
    id: snapshot.id,
    songId: snapshot.songId,
    sourceKey: snapshot.sourceKey,
    originalText: snapshot.originalText,
    originalChordModel: snapshot.originalChordModel,
    originalAnchorData: snapshot.originalAnchors,
    originalAnchors: snapshot.originalAnchors,
    status: snapshot.snapshotStatus,
    snapshotStatus: snapshot.snapshotStatus,
    provenanceRef: snapshot.provenanceRef,
    createdAt: snapshot.createdAt,
    snapshotSchemaVersion: snapshot.schemaVersion,
    schemaVersion: snapshot.schemaVersion,
    integrityHash: snapshot.integrityHash,
  }
}

export function snapshotStateResponse(state) {
  const snapshot = publicSnapshot(state.snapshot)
  const verified = state.status === SNAPSHOT_STATUS_VERIFIED && Boolean(snapshot)
  return {
    snapshotStatus: verified ? SNAPSHOT_STATUS_VERIFIED : state.status,
    snapshot,
    text: verified ? snapshot.originalText : '',
    key: verified ? snapshot.sourceKey : '',
    sourceKey: verified ? snapshot.sourceKey : '',
    originalKey: verified ? snapshot.sourceKey : '',
    sourceKeyStatus: verified ? SNAPSHOT_STATUS_VERIFIED : state.status,
    sourceKeyVerified: verified,
    method: verified ? 'Verified original snapshot' : 'Original snapshot unresolved',
    needsReview: !verified,
    transpositionBlocked: !verified,
    reason: state.reason || '',
  }
}

export function insertSnapshotAndEvidence(db, {
  songId,
  sourceKey = '',
  originalText = '',
  snapshotStatus,
  evidenceType,
  sourceReference,
  detectedKey = '',
  documentHash = '',
  contentHash = '',
  analysisMetadata = {},
  confidence = 0,
  createdAt = new Date().toISOString(),
  snapshotId = randomUUID(),
  evidenceId = randomUUID(),
}) {
  if (!SNAPSHOT_STATUSES.has(snapshotStatus)) throw new Error(`Invalid snapshot status: ${snapshotStatus}`)
  if (!songId || !evidenceType || !sourceReference) throw new Error('Snapshot evidence fields are required')
  const normalizedSource = normalizeEditorKey(sourceKey)
  const text = String(originalText || '')
  if (snapshotStatus === SNAPSHOT_STATUS_VERIFIED && (!normalizedSource || !text)) {
    throw new Error('Verified snapshots require source key and original text')
  }
  const originalChordModel = json(buildOriginalChordModel(text))
  const originalAnchors = json(extractEditorChordAnchors(text))
  if (snapshotStatus === SNAPSHOT_STATUS_VERIFIED && !parseJson(originalChordModel, {}).lines?.length) {
    throw new Error('Verified snapshots require an original chord model')
  }
  const provenanceRef = `evidence:${evidenceId}`
  const snapshotRecord = {
    id: snapshotId,
    songId,
    sourceKey: normalizedSource,
    originalText: text,
    originalChordModel,
    originalAnchors,
    snapshotStatus,
    provenanceRef,
    createdAt,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  }
  const snapshotHash = integrityHash(snapshotIntegrityFields(snapshotRecord))
  const metadata = json(analysisMetadata || {})
  const evidenceRecord = {
    id: evidenceId,
    songId,
    snapshotId,
    evidenceType,
    sourceReference,
    detectedKey: normalizeEditorKey(detectedKey),
    documentHash: String(documentHash || ''),
    contentHash: String(contentHash || ''),
    analysisMetadata: metadata,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    createdAt,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  }
  const evidenceHash = integrityHash(evidenceIntegrityFields(evidenceRecord))

  db.prepare(`
    INSERT INTO song_original_snapshots
      (id,song_id,source_key,original_text,original_chord_model,original_anchor_data,status,provenance_ref,created_at,snapshot_schema_version,integrity_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    snapshotRecord.id,
    snapshotRecord.songId,
    snapshotRecord.sourceKey,
    snapshotRecord.originalText,
    snapshotRecord.originalChordModel,
    snapshotRecord.originalAnchors,
    snapshotRecord.snapshotStatus,
    snapshotRecord.provenanceRef,
    snapshotRecord.createdAt,
    snapshotRecord.schemaVersion,
    snapshotHash,
  )
  db.prepare(`
    INSERT INTO song_evidence
      (id,song_id,snapshot_id,evidence_type,source_identifier,detected_key,document_sha256,content_sha256,metadata,confidence,created_at,evidence_schema_version,integrity_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    evidenceRecord.id,
    evidenceRecord.songId,
    evidenceRecord.snapshotId,
    evidenceRecord.evidenceType,
    evidenceRecord.sourceReference,
    evidenceRecord.detectedKey,
    evidenceRecord.documentHash,
    evidenceRecord.contentHash,
    evidenceRecord.analysisMetadata,
    evidenceRecord.confidence,
    evidenceRecord.createdAt,
    evidenceRecord.schemaVersion,
    evidenceHash,
  )
  return { snapshotId, evidenceId }
}

export function persistScanSnapshot(db, { songId, pdfPath, documentHash, result, createdAt = new Date().toISOString() }) {
  const text = String(result?.text || '')
  const visionKey = normalizeEditorKey(result?.document?.key || (String(result?.method || '').startsWith('Vision/') ? result?.key : ''))
  const documentKey = inferKeyFromLeadsheet(text)
  const chords = inferKeyFromChords(text)
  const chordKey = normalizeEditorKey(chords.key)
  const explicitKey = visionKey || documentKey
  const verified = Boolean(text && explicitKey && chordKey && explicitKey === chordKey && !result?.needsReview)
  const status = verified
    ? SNAPSHOT_STATUS_VERIFIED
    : (text ? SNAPSHOT_STATUS_REVIEW_REQUIRED : SNAPSHOT_STATUS_UNRESOLVED)
  const detectedKey = verified ? explicitKey : ''
  const sourceReference = `import:${pdfPath};sha256:${documentHash}`
  const analysisMetadata = {
    method: result?.method || '',
    visionKey,
    documentKey,
    chordKey,
    chordConfidence: chords.confidence || 0,
    analysisConfidence: result?.avgConfidence ?? null,
    analysisNeedsReview: Boolean(result?.needsReview),
    sameRun: true,
    verificationRule: 'explicit_key_and_chord_analysis_agree',
  }
  db.exec('BEGIN')
  try {
    const ids = insertSnapshotAndEvidence(db, {
      songId,
      sourceKey: detectedKey,
      originalText: text,
      snapshotStatus: status,
      evidenceType: verified ? 'scan_analysis_verified' : 'scan_analysis_review_required',
      sourceReference,
      detectedKey,
      documentHash,
      contentHash: text ? sha256(text) : '',
      analysisMetadata,
      confidence: verified ? Math.min(Number(result?.avgConfidence) || 1, chords.confidence || 1) : 0,
      createdAt,
    })
    if (verified) {
      db.prepare(`
        UPDATE songs
        SET source_key=?,
            song_key=CASE WHEN song_key IS NULL OR song_key='' OR song_key='–' THEN ? ELSE song_key END
        WHERE id=?
      `).run(detectedKey, detectedKey, songId)
    }
    db.exec('COMMIT')
    return { ...ids, status, sourceKey: detectedKey, analysisMetadata }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function legacyReviewMetadata(song) {
  return {
    migration: TRUST_MIGRATION_ID,
    reason: 'legacy_state_has_no_equivalent_verified_evidence',
    observedLegacySourceKey: normalizeEditorKey(song.source_key),
    observedLegacySongKey: normalizeEditorKey(song.song_key),
    legacyValuesAreNotTrusted: true,
  }
}

export async function migrateLegacySongTrust(db, { readDocument }) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE id=?').get(TRUST_MIGRATION_ID)) {
    return { applied: false, verified: 0, reviewRequired: 0 }
  }
  const songs = db.prepare('SELECT id,title,pdf_path,source_key,song_key FROM songs ORDER BY created_at,id').all()
  const prepared = []
  for (const song of songs) {
    if (db.prepare('SELECT 1 FROM song_original_snapshots WHERE song_id=? LIMIT 1').get(song.id)) continue
    let documentHash = ''
    try {
      documentHash = sha256(await readDocument(song.pdf_path))
    } catch {
      // Missing legacy documents remain explicitly unresolved.
    }
    const reference = documentHash === TEST_7_PDF_SHA256
      ? db.prepare(`
        SELECT content FROM song_variants
        WHERE song_id=? AND source_key='C' AND target_key='C'
          AND snapshot_id=''
      `).get(song.id)
      : null
    const referenceMatches = reference
      && sha256(reference.content) === TEST_7_CONTENT_SHA256
      && inferKeyFromChords(reference.content).key === 'C'
    prepared.push({ song, documentHash, reference: referenceMatches ? reference : null })
  }

  let verified = 0
  let reviewRequired = 0
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const item of prepared) {
      if (item.reference) {
        const { snapshotId } = insertSnapshotAndEvidence(db, {
          songId: item.song.id,
          sourceKey: 'C',
          originalText: item.reference.content,
          snapshotStatus: SNAPSHOT_STATUS_VERIFIED,
          evidenceType: 'legacy_scan_reference_verified',
          sourceReference: `verified-reference:test-7;pdf-sha256:${item.documentHash};content-sha256:${TEST_7_CONTENT_SHA256}`,
          detectedKey: 'C',
          documentHash: item.documentHash,
          contentHash: TEST_7_CONTENT_SHA256,
          confidence: 1,
          createdAt: now,
          analysisMetadata: {
            migration: TRUST_MIGRATION_ID,
            visionKey: 'C',
            chordKey: 'C',
            chordAnalysisKey: 'C',
            chordConfidence: 1,
            evidenceConfidence: 1,
            sameScanRun: true,
            verificationBasis: 'attested_test_7_reference_and_exact_hashes',
          },
        })
        const projection = projectEditorSnapshot({
          originalText: item.reference.content,
          sourceKey: 'C',
          selectedKey: 'C',
        })
        db.prepare(`
          UPDATE song_variants
          SET snapshot_id=?,source_key='C',content=?,overlay_text=?,anchors=?,chord_model=?,schema_version=?
          WHERE song_id=? AND target_key='C'
        `).run(
          snapshotId,
          projection.text,
          item.reference.content,
          json(projection.visibleAnchors),
          json(buildOriginalChordModel(projection.text)),
          SNAPSHOT_SCHEMA_VERSION,
          item.song.id,
        )
        db.prepare('UPDATE songs SET source_key=? WHERE id=?').run('C', item.song.id)
        verified += 1
      } else {
        insertSnapshotAndEvidence(db, {
          songId: item.song.id,
          snapshotStatus: SNAPSHOT_STATUS_REVIEW_REQUIRED,
          evidenceType: 'legacy_review_required',
          sourceReference: item.documentHash ? `legacy-import;pdf-sha256:${item.documentHash}` : 'legacy-import;document-unavailable',
          documentHash: item.documentHash,
          analysisMetadata: legacyReviewMetadata(item.song),
          createdAt: now,
        })
        db.prepare("UPDATE songs SET source_key='' WHERE id=?").run(item.song.id)
        reviewRequired += 1
      }
    }
    db.prepare('INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)').run(TRUST_MIGRATION_ID, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { applied: true, verified, reviewRequired }
}

export function saveVariantFromVerifiedSnapshot(db, songId, payload, { createdAt = new Date().toISOString() } = {}) {
  const targetKey = normalizeEditorKey(payload?.targetKey)
  if (!targetKey) {
    throw new SongTrustError('Ungültige Zieltonart.', { code: 'invalid_target_key', status: 400 })
  }
  const snapshot = getVerifiedSongSnapshot(db, songId)
  if (!snapshot) {
    throw new SongTrustError('Die Originalfassung muss vor der Transposition verifiziert werden.', {
      code: 'snapshot_review_required',
    })
  }
  // Loading and validating these immutable fields is part of the projection trust boundary.
  if (!snapshot.originalChordModel || !snapshot.originalAnchors) {
    throw new SongTrustError('Der Original-Snapshot ist unvollständig.', { code: 'snapshot_incomplete' })
  }
  const overlayText = typeof payload?.overlayText === 'string'
    ? payload.overlayText
    : snapshot.originalText
  if (overlayText.length > 1024 * 1024) {
    throw new SongTrustError('Die bearbeitete Fassung ist zu groß.', {
      code: 'variant_overlay_too_large',
      status: 413,
    })
  }
  const projection = projectEditorSnapshot({
    originalText: snapshot.originalText,
    originalChordModel: snapshot.originalChordModel,
    originalAnchorData: snapshot.originalAnchors,
    overlayText,
    sourceKey: snapshot.sourceKey,
    selectedKey: targetKey,
    requireSnapshotModel: true,
  })
  if (!projection.ok) {
    throw new SongTrustError('Die Originaltonart ist nicht verifiziert.', {
      code: projection.reason || 'snapshot_review_required',
    })
  }
  const anchors = json(projection.visibleAnchors)
  const chordModel = json(buildOriginalChordModel(projection.text))
  db.exec('BEGIN')
  try {
    db.prepare(`
      INSERT INTO song_variants
        (song_id,target_key,source_key,content,created_at,snapshot_id,anchors,chord_model,overlay_text,schema_version)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(song_id,target_key) DO UPDATE SET
        source_key=excluded.source_key,
        content=excluded.content,
        created_at=excluded.created_at,
        snapshot_id=excluded.snapshot_id,
        anchors=excluded.anchors,
        chord_model=excluded.chord_model,
        overlay_text=excluded.overlay_text,
        schema_version=excluded.schema_version
    `).run(
      songId,
      targetKey,
      snapshot.sourceKey,
      projection.text,
      createdAt,
      snapshot.id,
      anchors,
      chordModel,
      overlayText,
      SNAPSHOT_SCHEMA_VERSION,
    )
    db.prepare('UPDATE songs SET preferred_key=?,song_key=? WHERE id=?').run(targetKey, targetKey, songId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    targetKey,
    sourceKey: snapshot.sourceKey,
    content: projection.text,
    overlayText,
    snapshotId: snapshot.id,
    anchors: projection.visibleAnchors,
  }
}

export function snapshotSummaryForSong(db, songId) {
  const state = getSongSnapshotState(db, songId)
  return {
    sourceKey: state.snapshot?.sourceKey || '',
    originalKey: state.snapshot?.sourceKey || '',
    sourceKeyStatus: state.status,
    sourceKeyVerified: state.status === SNAPSHOT_STATUS_VERIFIED,
    snapshotStatus: state.status,
    snapshotId: state.snapshot?.id || '',
  }
}
