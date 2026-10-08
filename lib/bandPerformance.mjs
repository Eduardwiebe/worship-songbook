import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const colors = ['#d32f2f', '#1565c0', '#111111', '#2e7d32']
const fail = (status, message) => Object.assign(new Error(message), { status })
export function initializeBandPerformance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS song_annotations (song_id TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(song_id,scope));
    CREATE TABLE IF NOT EXISTS set_performances (id TEXT PRIMARY KEY,set_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(set_id,version));
    CREATE TABLE IF NOT EXISTS performance_receipts (performance_id TEXT NOT NULL,user_id TEXT NOT NULL,device_id TEXT NOT NULL,prepared_at TEXT NOT NULL,PRIMARY KEY(performance_id,user_id,device_id));`)
}
export function normalizeAnnotations(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 2_000_000) throw fail(400, 'Die Notizen sind zu groß oder ungültig.')
  const pages = {}
  const unit = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  if (!value.pages || typeof value.pages !== 'object' || Array.isArray(value.pages)) throw fail(400, 'Ungültige Notizseiten.')
  if (Object.keys(value.pages).length > 200) throw fail(400, 'Zu viele Notizseiten.')
  for (const [page, marks] of Object.entries(value.pages)) {
    if (!/^(0|[1-9]\d{0,2})$/.test(page) || !Array.isArray(marks) || marks.length > 500) throw fail(400, 'Ungültige Notizseite.')
    pages[page] = marks.map((mark) => {
      if (!mark || !colors.includes(mark.color) || typeof mark.id !== 'string' || mark.id.length > 80) throw fail(400, 'Ungültige Markierung.')
      if (mark.kind === 'stroke' && Array.isArray(mark.points) && mark.points.length > 0 && mark.points.length <= 2000 && mark.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(unit)) && unit(mark.width) && mark.width >= .001 && mark.width <= .02) return { id: mark.id, kind: 'stroke', points: mark.points, color: mark.color, width: mark.width }
      if (mark.kind === 'text' && unit(mark.x) && unit(mark.y) && typeof mark.text === 'string' && mark.text.length <= 300) return { id: mark.id, kind: 'text', x: mark.x, y: mark.y, text: mark.text, color: mark.color }
      throw fail(400, 'Ungültige Stift- oder Textnotiz.')
    })
  }
  if (typeof value.notes !== 'string' || value.notes.length > 5000 || !/^[a-f0-9]{64}$/.test(value.sourceHash || '')) throw fail(400, 'Ungültiger Notiztext oder Originalstand.')
  return { format: 1, sourceHash: value.sourceHash, pages, notes: value.notes }
}
async function renderPages(pdfPath) {
  const dir = await mkdtemp(join(tmpdir(), 'songbook-performance-pages-'))
  try {
    await run('/usr/bin/pdftoppm', ['-jpeg', '-r', '144', pdfPath, join(dir, 'page')], { timeout: 60000, maxBuffer: 30 * 1024 * 1024 })
    const files = (await readdir(dir)).filter((name) => /\.jpe?g$/.test(name)).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!files.length) throw fail(422, 'Das Original hat keine lesbaren Seiten.')
    return Promise.all(files.map(async (file) => ({ mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${(await readFile(join(dir, file))).toString('base64')}` })))
  } finally { await rm(dir, { recursive: true, force: true }) }
}
function setDocument(row) {
  return { id: row.id, revision: row.revision, title: row.title, date: row.date, band: row.band, venue: row.venue, theme: row.theme, eventTime: row.event_time, arrivalTime: row.arrival_time, techNotes: row.tech_notes, technicianId: row.technician_id, songIds: JSON.parse(row.song_ids), leaders: JSON.parse(row.leaders || '{}'), songBriefings: JSON.parse(row.song_briefings || '{}') }
}
export async function routeBandPerformance({ req, res, url, user, bandId, db, root, json, bodyJson }) {
  const annotation = url.pathname.match(/^\/api\/songs\/([^/]+)\/annotations$/)
  const performance = url.pathname.match(/^\/api\/sets\/([^/]+)\/performances(?:\/([^/]+)(?:\/(receipts|songs\/([^/]+)\/(pages|pdf)))?)?$/)
  if (!annotation && !performance) return false
  const scope = bandId ? `band:${bandId}` : `user:${user.id}`
  const accessSong = (id) => bandId ? db.prepare('SELECT s.* FROM songs s JOIN band_songs b ON b.song_id=s.id WHERE s.id=? AND b.band_id=?').get(id, bandId) : db.prepare('SELECT * FROM songs WHERE id=? AND owner_id=?').get(id, user.id)
  const accessSet = (id) => bandId ? db.prepare('SELECT * FROM sets WHERE id=? AND band_id=?').get(id, bandId) : db.prepare('SELECT * FROM sets WHERE id=? AND owner_id=? AND band_id IS NULL').get(id, user.id)
  const annotationsFor = (id, sourceHash) => {
    const row = db.prepare('SELECT * FROM song_annotations WHERE song_id=? AND scope=?').get(id, scope)
    return row ? { ...JSON.parse(row.document), revision: row.revision, currentSourceHash: sourceHash, updatedAt: row.updated_at } : { format: 1, revision: 0, sourceHash, currentSourceHash: sourceHash, pages: {}, notes: '' }
  }
  try {
    if (annotation) {
      const song = accessSong(annotation[1])
      if (!song?.pdf_path) throw fail(404, 'Original nicht gefunden.')
      const sourceHash = hash(await readFile(song.pdf_path))
      if (req.method === 'GET') { json(res, 200, annotationsFor(song.id, sourceHash)); return true }
      if (req.method === 'PUT') {
        const body = await bodyJson(req)
        const document = normalizeAnnotations(body)
        if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw fail(400, 'Eine gültige Notizrevision ist erforderlich.')
        if (document.sourceHash !== sourceHash) throw fail(409, 'Das Original wurde geändert. Notizen zuerst prüfen.')
        if (!accessSong(song.id) || (bandId && !db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandId,user.id))) throw fail(403, 'Kein Zugriff mehr.')
        const now = new Date().toISOString()
        const changed = db.prepare(`INSERT INTO song_annotations (song_id,scope,revision,document,updated_by,updated_at) SELECT ?,?,1,?,?,? WHERE ?=0
          ON CONFLICT(song_id,scope) DO UPDATE SET revision=song_annotations.revision+1,document=excluded.document,updated_by=excluded.updated_by,updated_at=excluded.updated_at WHERE song_annotations.revision=?`).run(song.id,scope,JSON.stringify(document),user.id,now,body.revision,body.revision)
        // For nonzero revisions use a direct CAS update: INSERT's WHERE deliberately refuses creating a missing document.
        const updated = body.revision === 0 ? changed : db.prepare('UPDATE song_annotations SET revision=revision+1,document=?,updated_by=?,updated_at=? WHERE song_id=? AND scope=? AND revision=?').run(JSON.stringify(document),user.id,now,song.id,scope,body.revision)
        if (!updated.changes) throw fail(409, 'Ein anderes Bandmitglied hat die Notizen geändert. Dein Entwurf bleibt erhalten.')
        json(res, 200, annotationsFor(song.id, sourceHash)); return true
      }
      throw fail(405, 'Methode nicht erlaubt.')
    }
    const set = accessSet(performance[1])
    if (!set) throw fail(404, 'Set nicht gefunden.')
    const id = performance[2]
    if (!id && req.method === 'GET') {
      const rows = db.prepare('SELECT snapshot FROM set_performances WHERE set_id=? ORDER BY version DESC').all(set.id)
      json(res, 200, rows.map((row) => JSON.parse(row.snapshot))); return true
    }
    if (!id && req.method === 'POST') {
      const body = await bodyJson(req)
      if (!Number.isSafeInteger(body.revision) || body.revision !== set.revision) throw fail(409, 'Das Set wurde geändert oder noch nicht gespeichert. Bitte neu laden.')
      const frozenSet = setDocument(set)
      if (!frozenSet.songIds.length) throw fail(400, 'Ein leeres Set kann nicht freigegeben werden.')
      const publicationId = randomUUID()
      const dir = join(root, 'performances', publicationId)
      await mkdir(dir, { recursive: true })
      try {
        const songs = []
        for (const songId of [...new Set(frozenSet.songIds)]) {
          const song = accessSong(songId)
          if (!song?.pdf_path) throw fail(409, 'Ein Original fehlt. Bitte zuerst den Set-Check klären.')
          const bytes = await readFile(song.pdf_path)
          const sourceHash = hash(bytes)
          const annotations = annotationsFor(songId, sourceHash)
          if (annotations.sourceHash !== sourceHash) throw fail(409, 'Notizen gehören zu einem älteren Original. Bitte zuerst prüfen.')
          const pdfPath = join(dir, `${songs.length}.pdf`)
          await writeFile(pdfPath, bytes)
          const pages = await renderPages(pdfPath)
          await writeFile(join(dir, `${songs.length}.json`), JSON.stringify({ pages, sourceHash }))
          const base = `/api/sets/${set.id}/performances/${publicationId}/songs/${songId}`
          const leaderId = frozenSet.leaders[songId]
          const leader = leaderId === 'group' ? 'Alle gemeinsam' : db.prepare('SELECT name FROM team WHERE id=?').get(leaderId || '')?.name || ''
          songs.push({ id: songId, hasPdf: true, title: song.title, artist: song.artist, key: song.song_key, bpm: song.bpm, fileName: song.file_name, fileSize: bytes.length, pdfUrl: `${base}/pdf`, pagesUrl: `${base}/pages`, sourceHash, annotations, leader, archiveIndex: songs.length, pageCount: pages.length })
        }
        // No await between final revision/access checks and insertion; draft edits cannot slip through here.
        const current = accessSet(set.id)
        if (!current || JSON.stringify(current) !== JSON.stringify(set) || (bandId && !db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandId,user.id))) throw fail(409, 'Das Set hat sich während der Freigabe geändert.')
        for (const song of songs) {
          const currentAnnotations = annotationsFor(song.id, song.sourceHash)
          if (!accessSong(song.id) || currentAnnotations.revision !== song.annotations.revision) throw fail(409, 'Die Notizen wurden während der Freigabe geändert. Bitte erneut freigeben.')
        }
        const version = (db.prepare('SELECT MAX(version) AS version FROM set_performances WHERE set_id=?').get(set.id).version || 0) + 1
        const snapshot = { id: publicationId, version, createdAt: new Date().toISOString(), set: frozenSet, songs }
        db.prepare('INSERT INTO set_performances VALUES (?,?,?,?,?,?)').run(publicationId,set.id,version,JSON.stringify(snapshot),user.id,snapshot.createdAt)
        json(res, 201, snapshot); return true
      } catch (error) { await rm(dir, { recursive: true, force: true }); throw error }
    }
    const stored = id && db.prepare('SELECT snapshot FROM set_performances WHERE id=? AND set_id=?').get(id,set.id)
    if (!stored) throw fail(404, 'Auftrittsfassung nicht gefunden.')
    const snapshot = JSON.parse(stored.snapshot)
    if (performance[3] === 'receipts') {
      if (req.method === 'POST') {
        const body = await bodyJson(req)
        if (typeof body.deviceId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.deviceId)) throw fail(400, 'Ungültiges Gerät.')
        const now = new Date().toISOString()
        db.prepare('INSERT INTO performance_receipts VALUES (?,?,?,?) ON CONFLICT(performance_id,user_id,device_id) DO UPDATE SET prepared_at=excluded.prepared_at').run(id,user.id,body.deviceId,now)
        json(res,200,{ preparedAt: now }); return true
      }
      if (req.method === 'GET') {
        json(res,200,db.prepare('SELECT u.name,r.device_id AS deviceId,r.prepared_at AS preparedAt FROM performance_receipts r JOIN users u ON u.id=r.user_id WHERE performance_id=?').all(id)); return true
      }
    } else if (performance[4] && req.method === 'GET') {
      const song = snapshot.songs.find((song) => song.id === performance[4])
      if (!song) throw fail(404, 'Original nicht gefunden.')
      const dir = join(root, 'performances', id)
      if (performance[5] === 'pages') json(res,200,JSON.parse(await readFile(join(dir, `${song.archiveIndex}.json`),'utf8')))
      else { res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'private, no-store' }); res.end(await readFile(join(dir, `${song.archiveIndex}.pdf`))) }
      return true
    } else if (!performance[3] && req.method === 'GET') { json(res,200,snapshot); return true }
    throw fail(405, 'Methode nicht erlaubt.')
  } catch (error) {
    if (!error.status) throw error
    json(res,error.status,{ error: error.message }); return true
  }
}
