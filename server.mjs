import http from 'node:http'
import { Readable } from 'node:stream'
import { mkdir, writeFile, readFile, unlink, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { createAuth, initializeAuth } from './auth.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chordTokens,
  cleanOcrText,
  isChordLine,
  pickBestTextCandidate,
  scoreLeadsheetQuality,
  shouldRunOcr,
} from './lib/leadsheetAnalysis.mjs'
import { inferKeyFromChords, inferKeyFromLeadsheet, normalizeEditorKey, resolveScanSourceKey } from './lib/editorKey.mjs'
import { reconstructFromFlatText, reconstructLeadsheet, reconstructFromPdfBBox } from './lib/leadsheetReconstruct.mjs'
import {
  analyzePdfPageText,
  parseChordOverLyricsText,
  suggestSongPageIndices,
} from './lib/chordTextParse.mjs'
import { deinterleaveTwoColumnLayout, softFormatChordChart } from './lib/chartLayout.mjs'
import { normalizeSheetColumns, renderChartHtmlDocument } from './lib/chartHtml.mjs'
import { visionAvailable, recognizeMusicPages } from './lib/visionProviders/index.mjs'
import { visionResultToApi } from './lib/visionLeadsheet.mjs'
import {
  persistSongCover,
  queueResolveSongCover,
} from './lib/songCover.mjs'
import {
  persistSongYoutube,
  queueResolveSongYoutube,
} from './lib/songYoutube.mjs'
import {
  SongTrustError,
  getSongSnapshotState,
  initializeSongTrustSchema,
  migrateLegacySongTrust,
  persistScanSnapshot,
  repairSongSnapshotFromStoredText,
  replaceScanSnapshot,
  saveVariantFromVerifiedSnapshot,
  sha256,
  snapshotStateResponse,
  snapshotSummaryForSong,
} from './lib/songTrust.mjs'
const execFileAsync=promisify(execFile)

const OCR_PYTHON = process.env.SONGBOOK_OCR_PYTHON || '/var/www/songbook/.venv-ocr/bin/python'
const OCR_SCRIPT = '/var/www/songbook/ocr_structured.py'
const OMR_SCRIPT = process.env.SONGBOOK_OMR_SCRIPT || '/var/www/songbook/omr_structured.py'

const root = '/var/www/songbook/data'
await mkdir(`${root}/pdfs`, {recursive: true})
await mkdir(`${root}/covers`, {recursive: true})
const db = new DatabaseSync(`${root}/songbook.sqlite`)
db.exec(`CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT,file_name TEXT,file_size INTEGER,pdf_path TEXT,sort_order INTEGER,created_at TEXT,song_key TEXT DEFAULT '–');
CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT,song_ids TEXT NOT NULL,created_at TEXT,leaders TEXT DEFAULT '{}',event_time TEXT DEFAULT '',tech_notes TEXT DEFAULT '',technician_id TEXT DEFAULT '',band TEXT DEFAULT '',theme TEXT DEFAULT '',venue TEXT DEFAULT '',arrival_time TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS team (id TEXT PRIMARY KEY,name TEXT NOT NULL,initials TEXT,roles TEXT NOT NULL,is_leader INTEGER,is_organizer INTEGER,photo_path TEXT,photo_mime TEXT,created_at TEXT,is_designer INTEGER DEFAULT 0,is_technician INTEGER DEFAULT 0);`)
db.exec(`CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY,set_id TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,time TEXT,location TEXT,notes TEXT,created_at TEXT);`)
db.exec(`CREATE TABLE IF NOT EXISTS song_variants (song_id TEXT NOT NULL,target_key TEXT NOT NULL,source_key TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT,PRIMARY KEY(song_id,target_key));`)
try { db.exec("ALTER TABLE songs ADD COLUMN song_key TEXT DEFAULT '–'") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN leaders TEXT DEFAULT '{}'") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN song_keys TEXT DEFAULT '{}'") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN initials TEXT") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN is_designer INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN is_technician INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN event_time TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN tech_notes TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN technician_id TEXT DEFAULT ''") } catch {}
for(const column of ['band','theme','venue','arrival_time']){try{db.exec(`ALTER TABLE sets ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
for(const column of ['source_key','preferred_key']){try{db.exec(`ALTER TABLE songs ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
for(const column of ['cover_path','cover_mime','cover_source']){try{db.exec(`ALTER TABLE songs ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
for(const column of ['youtube_url','youtube_video_id','youtube_source']){try{db.exec(`ALTER TABLE songs ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
try { db.exec('ALTER TABLE songs ADD COLUMN sheet_columns INTEGER NOT NULL DEFAULT 1') } catch {}
try { db.exec('ALTER TABLE songs ADD COLUMN sheet_font_size INTEGER NOT NULL DEFAULT 16') } catch {}
initializeAuth(db)
db.exec(`CREATE TABLE IF NOT EXISTS bands (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS band_members (band_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',joined_at TEXT NOT NULL,PRIMARY KEY(band_id,user_id));
CREATE TABLE IF NOT EXISTS band_songs (band_id TEXT NOT NULL,song_id TEXT NOT NULL,PRIMARY KEY(band_id,song_id));
CREATE TABLE IF NOT EXISTS band_team (band_id TEXT NOT NULL,team_id TEXT NOT NULL,PRIMARY KEY(band_id,team_id));`)
db.exec(`CREATE TABLE IF NOT EXISTS band_join_requests (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(band_id,user_id)
);
CREATE TABLE IF NOT EXISTS band_invites (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at TEXT,
  max_uses INTEGER NOT NULL DEFAULT 25,
  use_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS band_join_requests_owner_status
  ON band_join_requests(band_id,status,created_at);
CREATE INDEX IF NOT EXISTS band_join_requests_user
  ON band_join_requests(user_id,created_at);
CREATE INDEX IF NOT EXISTS band_invites_band
  ON band_invites(band_id,created_at);`)
for(const column of ['logo_path TEXT','logo_mime TEXT']){try{db.exec(`ALTER TABLE bands ADD COLUMN ${column}`)}catch{}}
  for(const table of ['sets','appointments']){try{db.exec(`ALTER TABLE ${table} ADD COLUMN band_id TEXT`)}catch{}}
db.exec(`CREATE TABLE IF NOT EXISTS onboarding_state (
  user_id TEXT PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`)
try{db.exec(`ALTER TABLE onboarding_state ADD COLUMN manual_restart INTEGER NOT NULL DEFAULT 0`)}catch{}

initializeSongTrustSchema(db)
const songTrustMigration = await migrateLegacySongTrust(db, { readDocument: readFile })
if (songTrustMigration.applied) console.log('song trust migration', JSON.stringify(songTrustMigration))

const getOnboardingState=userId=>{
  const row=db.prepare(`
    SELECT step,completed,mode,state_json,manual_restart
    FROM onboarding_state
    WHERE user_id=?
  `).get(userId)

  // Legacy accounts without a row must NOT be treated as new users.
  if(!row)return {
    step:0,
    completed:true,
    manualRestart:false,
    mode:'',
    data:{}
  }

  let data={}
  try{data=JSON.parse(row.state_json||'{}')}catch{}

  return {
    step:Number(row.step)||0,
    completed:Boolean(row.completed),
    manualRestart:Boolean(row.manual_restart),
    mode:row.mode||'',
    data
  }
}

// One-time: existing accounts skip the wizard; only new registrations start incomplete.
if(!db.prepare(`SELECT 1 FROM schema_migrations WHERE id='onboarding_legacy_complete_v1'`).get()){
  const now=new Date().toISOString()
  const users=db.prepare('SELECT id FROM users').all()
  const insert=db.prepare(`
    INSERT INTO onboarding_state
      (user_id,step,completed,mode,state_json,created_at,updated_at)
    VALUES (?,?,1,'','{}',?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      completed=1,
      updated_at=excluded.updated_at
  `)
  for(const user of users)insert.run(user.id,0,now,now)
  db.prepare(`INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)`)
    .run('onboarding_legacy_complete_v1',now)
}

const saveOnboardingState=(userId,value)=>{
  const now=new Date().toISOString()
  const step=Math.max(0,Math.min(20,Number(value.step)||0))
  const completed=value.completed?1:0
  const manualRestart=value.manualRestart?1:0
  const mode=['','create','join','personal'].includes(value.mode)?value.mode:''
  const data=value.data&&typeof value.data==='object'?value.data:{}

  db.prepare(`
    INSERT INTO onboarding_state
      (user_id,step,completed,manual_restart,mode,state_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      step=excluded.step,
      completed=excluded.completed,
      manual_restart=excluded.manual_restart,
      mode=excluded.mode,
      state_json=excluded.state_json,
      updated_at=excluded.updated_at
  `).run(
    userId,
    step,
    completed,
    manualRestart,
    mode,
    JSON.stringify(data),
    now,
    now
  )

  return getOnboardingState(userId)
}

const makeInitials=(name)=>{const parts=name.trim().split(/\s+/).filter(Boolean);return parts.length>1?(parts[0][0]+parts.at(-1)[0]).toUpperCase():parts[0]?.slice(0,2).toUpperCase()||''}
const json = (res, status, body) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)) }
const bodyJson = async (req) => { const chunks=[]; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString() || '{}') }
const songRows = (ownerId,bandId='') => (bandId
  ? db.prepare('SELECT s.id,s.title,s.artist,s.song_key AS key,s.preferred_key AS preferredKey,s.file_name AS fileName,s.file_size AS fileSize,s.sort_order AS sortOrder,s.created_at AS createdAt,s.is_protected AS isProtected,1 AS hasPdf,s.cover_path AS coverPath,s.cover_source AS coverSource,s.youtube_url AS youtubeUrl,s.youtube_video_id AS youtubeVideoId,s.youtube_source AS youtubeSource,s.sheet_columns AS sheetColumns,s.sheet_font_size AS sheetFontSize FROM songs s JOIN band_songs bs ON bs.song_id=s.id WHERE bs.band_id=? ORDER BY s.sort_order DESC').all(bandId)
  : db.prepare('SELECT id,title,artist,song_key AS key,preferred_key AS preferredKey,file_name AS fileName,file_size AS fileSize,sort_order AS sortOrder,created_at AS createdAt,is_protected AS isProtected,1 AS hasPdf,cover_path AS coverPath,cover_source AS coverSource,youtube_url AS youtubeUrl,youtube_video_id AS youtubeVideoId,youtube_source AS youtubeSource,sheet_columns AS sheetColumns,sheet_font_size AS sheetFontSize FROM songs WHERE owner_id=? ORDER BY sort_order DESC').all(ownerId)
).map((song) => {
  const trust = snapshotSummaryForSong(db, song.id)
  const variantKeys = trust.snapshotId
    ? db.prepare('SELECT target_key FROM song_variants WHERE song_id=? AND snapshot_id=? ORDER BY created_at DESC').all(song.id, trust.snapshotId).map((row) => row.target_key)
    : []
  return {
    ...song,
    ...trust,
    isProtected: Boolean(song.isProtected),
    variantKeys,
    hasCover: Boolean(song.coverPath),
    coverUrl: song.coverPath ? `/api/songs/${song.id}/cover` : '',
    coverSource: song.coverSource || '',
    coverPath: undefined,
    youtubeUrl: song.youtubeUrl || '',
    youtubeVideoId: song.youtubeVideoId || '',
    youtubeSource: song.youtubeSource || '',
    sheetColumns: normalizeSheetColumns(song.sheetColumns),
    sheetFontSize: Math.min(28, Math.max(11, Number(song.sheetFontSize) || 16)),
  }
})

async function extractPdfText(pdfPath) {
  try {
    // Prefer geometric bbox reconstruction for SongSelect-style charts (accurate chord X).
    try {
      const bbox = await execFileAsync('/usr/bin/pdftotext', ['-bbox', '-nopgbrk', pdfPath, '-'], { maxBuffer: 30 * 1024 * 1024 })
      const rebuilt = reconstructFromPdfBBox(bbox.stdout || '')
      if (rebuilt?.text && scoreLeadsheetQuality(rebuilt.text).score >= 40) {
        return softFormatChordChart(rebuilt.text)
      }
    } catch (bboxError) {
      console.warn('pdftotext bbox reconstruct failed:', bboxError?.message || bboxError)
    }
    const result = await execFileAsync('/usr/bin/pdftotext', ['-layout', '-nopgbrk', pdfPath, '-'], { maxBuffer: 20 * 1024 * 1024 })
    return softFormatChordChart(deinterleaveTwoColumnLayout(cleanOcrText(result.stdout)))
  } catch {
    return ''
  }
}

async function ocrPdfPagesLegacy(pdfPath) {
  const dir = await mkdtemp(join(tmpdir(), 'songbook-ocr-'))
  try {
    await execFileAsync('/usr/bin/pdftoppm', ['-png', '-r', '400', pdfPath, join(dir, 'page')], { maxBuffer: 10 * 1024 * 1024 })
    const pages = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort()
    const outputs = []
    for (const page of pages) {
      const pagePath = join(dir, page)
      const configs = [
        ['-l', 'deu+eng', '--psm', '4', '-c', 'preserve_interword_spaces=1'],
        ['-l', 'deu+eng', '--psm', '6', '-c', 'preserve_interword_spaces=1'],
        ['-l', 'eng', '--psm', '4', '-c', 'preserve_interword_spaces=1'],
      ]
      for (const cfg of configs) {
        try {
          const result = await execFileAsync('/usr/bin/tesseract', [pagePath, 'stdout', ...cfg], { maxBuffer: 20 * 1024 * 1024 })
          outputs.push({ text: result.stdout, method: `OCR/${cfg.join('-')}` })
        } catch { /* try next */ }
      }
    }
    const merged = outputs.reduce((acc, item) => {
      if (!item.text?.trim()) return acc
      return acc ? `${acc}\n\n${cleanOcrText(item.text)}` : cleanOcrText(item.text)
    }, '')
    return pickBestTextCandidate([
      ...outputs.map((item) => ({ text: item.text, method: item.method })),
      { text: merged, method: 'OCR/merged' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function renderPdfPngs(pdfPath) {
  const dir = await mkdtemp(join(tmpdir(), 'songbook-ocr-struct-'))
  await execFileAsync('/usr/bin/pdftoppm', ['-png', '-r', '300', pdfPath, join(dir, 'page')], { maxBuffer: 20 * 1024 * 1024 })
  const pages = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort().map((name) => join(dir, name))
  return { dir, pages }
}

async function structuredOcrFromPngs(pagePaths) {
  if (!pagePaths.length) return null
  const result = await execFileAsync(OCR_PYTHON, [OMR_SCRIPT, ...pagePaths], {
    maxBuffer: 40 * 1024 * 1024,
    timeout: 240000,
    env: {
      ...process.env,
      SONGBOOK_OCR_PYTHON: OCR_PYTHON,
      PYTHONPATH: '/var/www/songbook',
    },
  })
  return JSON.parse(result.stdout)
}

async function structuredOcrFromPdf(pdfPath) {
  const rendered = await renderPdfPngs(pdfPath)
  try {
    return await structuredOcrFromPngs(rendered.pages)
  } catch (error) {
    console.error('structured OCR failed:', error?.message || error)
    return null
  } finally {
    await rm(rendered.dir, { recursive: true, force: true })
  }
}


async function extractPdfTextForPage(pdfPath, pageNumber) {
  try {
    try {
      const bbox = await execFileAsync('/usr/bin/pdftotext', ['-f', String(pageNumber), '-l', String(pageNumber), '-bbox', '-nopgbrk', pdfPath, '-'], { maxBuffer: 12 * 1024 * 1024 })
      const rebuilt = reconstructFromPdfBBox(bbox.stdout || '')
      if (rebuilt?.text && scoreLeadsheetQuality(rebuilt.text).score >= 40) {
        return softFormatChordChart(rebuilt.text)
      }
    } catch (bboxError) {
      console.warn('pdftotext bbox page reconstruct failed:', bboxError?.message || bboxError)
    }
    const result = await execFileAsync('/usr/bin/pdftotext', ['-f', String(pageNumber), '-l', String(pageNumber), '-layout', '-nopgbrk', pdfPath, '-'], { maxBuffer: 8 * 1024 * 1024 })
    return softFormatChordChart(deinterleaveTwoColumnLayout(cleanOcrText(result.stdout)))
  } catch {
    return ''
  }
}

async function pdfPageCount(pdfPath) {
  try {
    const result = await execFileAsync('/usr/bin/pdfinfo', [pdfPath], { maxBuffer: 2 * 1024 * 1024 })
    const match = String(result.stdout || '').match(/Pages:\s*(\d+)/i)
    return match ? Number(match[1]) : 0
  } catch {
    return 0
  }
}

async function extractPdfPages(pdfPath, selectedPages, outputPath) {
  const dir = await mkdtemp(join(tmpdir(), 'songbook-pdf-pages-'))
  try {
    await execFileAsync('/usr/bin/pdfseparate', [pdfPath, join(dir, 'page-%d.pdf')], { maxBuffer: 20 * 1024 * 1024 })
    const files = (await readdir(dir)).filter((name) => name.endsWith('.pdf')).sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] || 0)
      const nb = Number(b.match(/(\d+)/)?.[1] || 0)
      return na - nb
    })
    const picks = selectedPages.map((index) => files[index]).filter(Boolean)
    if (!picks.length) throw new Error('Keine gültigen PDF-Seiten ausgewählt.')
    if (picks.length === 1) {
      await writeFile(outputPath, await readFile(join(dir, picks[0])))
    } else {
      await execFileAsync('/usr/bin/pdfunite', [...picks.map((name) => join(dir, name)), outputPath], { maxBuffer: 30 * 1024 * 1024 })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function textToReferencePdf(text, outputPath, title = 'Lead Sheet') {
  const dir = await mkdtemp(join(tmpdir(), 'songbook-text-pdf-'))
  try {
    const lines = String(text || '').split('\n')
    const linesPerPage = 52
    const pagePaths = []
    for (let start = 0; start < Math.max(lines.length, 1); start += linesPerPage) {
      const chunk = lines.slice(start, start + linesPerPage)
      const pageIndex = Math.floor(start / linesPerPage) + 1
      const pngPath = join(dir, `page-${String(pageIndex).padStart(2, '0')}.png`)
      const pyPath = join(dir, `render-${pageIndex}.py`)
      const script = [
        'from PIL import Image, ImageDraw, ImageFont',
        'img = Image.new("RGB", (1654, 2339), "white")',
        'draw = ImageDraw.Draw(img)',
        'try:',
        '    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 28)',
        'except Exception:',
        '    font = ImageFont.load_default()',
        `title = ${JSON.stringify(String(title || 'Lead Sheet'))}`,
        'draw.text((72, 48), title[:80], fill=(30,30,30), font=font)',
        `lines = ${JSON.stringify(chunk)}`,
        'y = 110',
        'for line in lines:',
        '    draw.text((72, y), line[:110], fill=(20,20,20), font=font)',
        '    y += 36',
        `img.save(${JSON.stringify(pngPath)})`,
      ].join('\n')
      await writeFile(pyPath, script)
      await execFileAsync('/usr/bin/python3', [pyPath], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
      pagePaths.push(pngPath)
    }
    await execFileAsync('/usr/bin/python3', ['/var/www/songbook/scan_to_pdf.py', outputPath, ...pagePaths], { maxBuffer: 30 * 1024 * 1024, timeout: 90000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function previewPdfImport(pdfPath) {
  const count = await pdfPageCount(pdfPath)
  const pageCount = Math.max(count || 1, 1)
  const summaries = []
  for (let page = 1; page <= pageCount; page += 1) {
    const pageText = await extractPdfTextForPage(pdfPath, page)
    const analysis = analyzePdfPageText(pageText)
    summaries.push({
      index: page - 1,
      pageNumber: page,
      score: analysis.score,
      hasMusic: analysis.hasMusic,
      hasTextLayer: Boolean(analysis.text),
      previewText: analysis.text.slice(0, 280),
    })
  }
  const suggested = suggestSongPageIndices(summaries)
  const dir = await mkdtemp(join(tmpdir(), 'songbook-pdf-preview-'))
  try {
    await execFileAsync('/usr/bin/pdftoppm', ['-jpeg', '-r', '72', pdfPath, join(dir, 'page')], { maxBuffer: 40 * 1024 * 1024, timeout: 90000 })
    const files = (await readdir(dir)).filter((name) => name.endsWith('.jpg') || name.endsWith('.jpeg')).sort()
    const pages = []
    for (let i = 0; i < files.length; i += 1) {
      const data = await readFile(join(dir, files[i]))
      const summary = summaries[i] || { index: i, pageNumber: i + 1, score: 0, hasMusic: false, hasTextLayer: false, previewText: '' }
      pages.push({
        ...summary,
        mime: 'image/jpeg',
        dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
        suggested: suggested.includes(summary.index),
      })
    }
    return { pageCount: pages.length || pageCount, pages, suggested }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function analyzeSongPdf(pdfPath, { forceScan = false, titleHint = '' } = {}) {
  const pdfText = await extractPdfText(pdfPath)
  const pdfQuality = scoreLeadsheetQuality(pdfText)
  const candidates = []

  if (pdfText && !forceScan) {
    candidates.push({ text: pdfText, method: 'PDF-Text', quality: pdfQuality })
  }

  let structured = null
  let reconstructed = null

  if (shouldRunOcr(pdfText, { forceScan }) || forceScan) {
    const rendered = await renderPdfPngs(pdfPath).catch((error) => {
      console.error('page render failed:', error?.message || error)
      return null
    })
    try {
      const omrTask = rendered?.pages?.length
        ? structuredOcrFromPngs(rendered.pages).catch((error) => {
          console.error('structured OCR failed:', error?.message || error)
          return null
        })
        : Promise.resolve(null)
      const visionTask = rendered?.pages?.length && visionAvailable()
        ? recognizeMusicPages(rendered.pages).catch((error) => {
          console.error('vision recognition failed:', error?.message || error)
          return null
        })
        : Promise.resolve(null)
      const [omr, visionDoc] = await Promise.all([omrTask, visionTask])
      structured = omr
      if (visionDoc?.sections?.length) {
        const visionApi = visionResultToApi(visionDoc, {
          structured,
          elapsedMs: visionDoc.usage?.elapsedMs || null,
        })
        if (visionDoc.usage) console.log('vision recognition', JSON.stringify(visionDoc.usage))
        if (visionApi.text) {
          return {
            ...visionApi,
            pdfTextQuality: pdfQuality.score,
          }
        }
      }
      if (structured?.pages?.length) {
        reconstructed = reconstructLeadsheet(structured, { titleHint })
        if (reconstructed.text) {
          candidates.push({
            text: reconstructed.text,
            method: `Structured/${structured.engine}`,
            quality: reconstructed.quality,
          })
        }
      }
    } finally {
      if (rendered?.dir) await rm(rendered.dir, { recursive: true, force: true })
    }

    const structuredScore = reconstructed?.quality?.score ?? 0
    if (!reconstructed?.text || structuredScore < 45) {
      const legacy = await ocrPdfPagesLegacy(pdfPath)
      if (legacy?.text) {
        const flat = reconstructFromFlatText(legacy.text)
        candidates.push({
          text: flat.text,
          method: `Legacy/${legacy.method || 'OCR'}`,
          quality: flat.quality,
        })
      }
    }
  }

  if (!candidates.length && pdfText) {
    candidates.push({ text: pdfText, method: 'PDF-Text', quality: pdfQuality })
  }

  const best = pickBestTextCandidate(candidates.map((c) => ({ text: c.text, method: c.method })))
  // Prefer structured reconstruction when its score is within 5 points of best (geometry wins ties)
  if (reconstructed?.text) {
    const structuredScore = reconstructed.quality?.score ?? 0
    if (structuredScore >= (best.quality?.score ?? 0) - 5) {
      best.text = reconstructed.text
      best.method = `Structured/${structured?.engine || 'ocr'}`
      best.quality = reconstructed.quality
    }
  }

  const text = best.text
  const quality = best.quality || scoreLeadsheetQuality(text)
  const chordLines = text.split('\n').filter(isChordLine)
  const key = inferKeyFromLeadsheet(text)

  return {
    text,
    key,
    method: best.method,
    chordCount: chordLines.reduce((sum, line) => sum + chordTokens(line).length, 0),
    chordLines: chordLines.length,
    quality,
    needsReview: quality.needsReview || !key,
    pdfTextQuality: pdfQuality.score,
    engine: structured?.engine || null,
    avgConfidence: reconstructed?.avgConfidence ?? quality.avgConfidence ?? null,
    elapsedMs: structured?.elapsed_ms ?? null,
  }
}

function finalizeScanResult(scanResult) {
  if (!scanResult?.text) {
    return scanResult || { method: 'import_failed', needsReview: true, text: '', key: '' }
  }
  let text = String(scanResult.text || '')
  const chords = inferKeyFromChords(text)
  const visionKey = normalizeEditorKey(
    scanResult?.document?.key
    || (String(scanResult?.method || '').startsWith('Vision/') ? scanResult?.key : ''),
  )
  let key = visionKey
    || normalizeEditorKey(scanResult.key)
    || inferKeyFromLeadsheet(text)
    || normalizeEditorKey(chords.key)
  if (key && !inferKeyFromLeadsheet(text)) {
    text = `TONART: ${key}

${text}`
  }
  const resolved = resolveScanSourceKey({
    visionKey,
    text,
    visionConfidence: scanResult?.avgConfidence,
  })
  const finalKey = resolved.key || key || ''
  if (finalKey && !inferKeyFromLeadsheet(text)) {
    text = `TONART: ${finalKey}

${text}`
  }
  const qualityNeedsReview = Boolean(scanResult?.quality?.needsReview)
  // Preserve quality warnings only when the original key remains unresolved/conflicting.
  const needsReview = Boolean(resolved.needsReview || !finalKey || (qualityNeedsReview && !resolved.key))
  return {
    ...scanResult,
    text,
    key: finalKey,
    needsReview,
  }
}

const auth=createAuth(db,json)
const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(`${name}=`))?.slice(name.length+1)||''
const selectedBand=(req,user)=>{
  const fromCookie=cookieValue(req,'songbook_band')
  const fromHeader=String(req.headers['x-songbook-band']||'').trim()
  const id=fromCookie||fromHeader
  return id&&db.prepare('SELECT b.* FROM bands b JOIN band_members m ON m.band_id=b.id WHERE b.id=? AND m.user_id=?').get(id,user.id)
}
const bandCookie=(id,maxAge=2592000)=>`songbook_band=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`

http.createServer(async (req,res) => { try {
  const url = new URL(req.url, 'http://localhost')
  if (req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true})
  if (req.method==='GET' && url.pathname==='/api/version') {
    try {
      const raw = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'app/public/version.json'), 'utf8')
      return json(res, 200, JSON.parse(raw))
    } catch {
      return json(res, 200, { version: '1.0.1.3', releaseUrl: 'https://songbook.lyruma.app', channel: 'web', canReload: true })
    }
  }
  if(url.pathname.startsWith('/api/auth/'))return await auth.route(req,res,url,bodyJson)
  const access=auth.authenticate(req,res,url);if(!access)return;const user=access.user
  const band=selectedBand(req,user);const bandId=band?.id||''
  if(req.method==='GET'&&url.pathname==='/api/onboarding'){
    return json(res,200,getOnboardingState(user.id))
  }

  if(req.method==='PATCH'&&url.pathname==='/api/onboarding'){
    const b=await bodyJson(req)
    const current=getOnboardingState(user.id)
    const manualRestart=b.manualRestart!==undefined
      ? Boolean(b.manualRestart)
      : current.manualRestart
    // Manual restart must keep completed=true while the wizard is open.
    const completed=manualRestart
      ? true
      : Boolean(b.completed)

    return json(res,200,saveOnboardingState(user.id,{
      step:b.step,
      completed,
      manualRestart,
      mode:b.mode,
      data:b.data
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/reset'){
    return json(res,200,saveOnboardingState(user.id,{
      step:0,
      completed:true,
      manualRestart:true,
      mode:'',
      data:{}
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/dismiss'){
    const current=getOnboardingState(user.id)
    return json(res,200,saveOnboardingState(user.id,{
      ...current,
      step:0,
      completed:true,
      manualRestart:false,
      mode:'',
      data:{}
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/complete'){
    const current=getOnboardingState(user.id)
    return json(res,200,saveOnboardingState(user.id,{
      ...current,
      completed:true,
      manualRestart:false
    }))
  }

  // -------------------------------------------------------
  // Öffentliche, stark eingeschränkte Bandsuche
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/search'){
    const q=String(url.searchParams.get('q')||'').trim()

    if(q.length<3)
      return json(res,200,[])

    const rows=db.prepare(`
      SELECT id,name,description
      FROM bands
      WHERE lower(name) LIKE lower(?)
      ORDER BY name
      LIMIT 10
    `).all(`%${q}%`)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Eigene Beitrittsanfragen
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/join-requests/mine'){
    const rows=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        b.name AS bandName,
        r.status,
        r.created_at AS createdAt,
        r.updated_at AS updatedAt
      FROM band_join_requests r
      JOIN bands b ON b.id=r.band_id
      WHERE r.user_id=?
      ORDER BY r.created_at DESC
    `).all(user.id)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Beitritt beantragen
  // -------------------------------------------------------
  const bandJoinRequest=url.pathname.match(
    /^\/api\/bands\/([^/]+)\/join-request$/
  )

  if(req.method==='POST'&&bandJoinRequest){
    const bandId=bandJoinRequest[1]

    const band=db.prepare(
      'SELECT id,name FROM bands WHERE id=?'
    ).get(bandId)

    if(!band)
      return json(res,404,{error:'Band nicht gefunden.'})

    const alreadyMember=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandId,user.id)

    if(alreadyMember)
      return json(res,409,{error:'Du bist bereits Mitglied dieser Band.'})

    const existing=db.prepare(`
      SELECT id,status
      FROM band_join_requests
      WHERE band_id=? AND user_id=?
    `).get(bandId,user.id)

    const now=new Date().toISOString()

    if(existing?.status==='pending')
      return json(res,200,{
        id:existing.id,
        status:'pending',
        bandId,
        bandName:band.name
      })

    const id=existing?.id || crypto.randomUUID()

    if(existing){
      db.prepare(`
        UPDATE band_join_requests
        SET status='pending',updated_at=?
        WHERE id=?
      `).run(now,id)
    }else{
      db.prepare(`
        INSERT INTO band_join_requests
          (id,band_id,user_id,status,created_at,updated_at)
        VALUES (?,?,?,'pending',?,?)
      `).run(id,bandId,user.id,now,now)
    }

    return json(res,201,{
      id,
      status:'pending',
      bandId,
      bandName:band.name
    })
  }

  // -------------------------------------------------------
  // Anfragen für Bands, die der Nutzer besitzt
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/join-requests'){
    const rows=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        b.name AS bandName,
        r.user_id AS userId,
        u.name AS userName,
        u.username,
        r.status,
        r.created_at AS createdAt
      FROM band_join_requests r
      JOIN bands b ON b.id=r.band_id
      JOIN users u ON u.id=r.user_id
      JOIN band_members owner
        ON owner.band_id=r.band_id
       AND owner.user_id=?
       AND owner.role='owner'
      WHERE r.status='pending'
      ORDER BY r.created_at
    `).all(user.id)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Anfrage annehmen / ablehnen
  // -------------------------------------------------------
  const joinDecision=url.pathname.match(
    /^\/api\/bands\/join-requests\/([^/]+)\/(approve|reject)$/
  )

  if(req.method==='POST'&&joinDecision){
    const requestId=joinDecision[1]
    const action=joinDecision[2]

    const row=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        r.user_id AS userId,
        r.status
      FROM band_join_requests r
      JOIN band_members owner
        ON owner.band_id=r.band_id
       AND owner.user_id=?
       AND owner.role='owner'
      WHERE r.id=?
    `).get(user.id,requestId)

    if(!row)
      return json(res,404,{error:'Beitrittsanfrage nicht gefunden.'})

    if(row.status!=='pending')
      return json(res,409,{error:'Diese Anfrage wurde bereits bearbeitet.'})

    const now=new Date().toISOString()

    if(action==='approve'){
      db.prepare(`
        INSERT OR IGNORE INTO band_members
          (band_id,user_id,role,joined_at)
        VALUES (?,?,'member',?)
      `).run(row.bandId,row.userId,now)

      db.prepare(`
        UPDATE band_join_requests
        SET status='accepted',updated_at=?
        WHERE id=?
      `).run(now,requestId)

      return json(res,200,{ok:true,status:'accepted'})
    }

    db.prepare(`
      UPDATE band_join_requests
      SET status='rejected',updated_at=?
      WHERE id=?
    `).run(now,requestId)

    return json(res,200,{ok:true,status:'rejected'})
  }

  // -------------------------------------------------------
  // Einladung erzeugen
  // -------------------------------------------------------
  const bandInvites=url.pathname.match(
    /^\/api\/bands\/([^/]+)\/invites$/
  )

  if(req.method==='POST'&&bandInvites){
    const bandId=bandInvites[1]

    const owner=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=? AND role='owner'
    `).get(bandId,user.id)

    if(!owner)
      return json(res,403,{error:'Nur die Bandverwaltung darf Einladungen erstellen.'})

    const b=await bodyJson(req)

    const maxUses=Math.max(
      1,
      Math.min(100,Number(b.maxUses)||25)
    )

    const expiresDays=Math.max(
      1,
      Math.min(90,Number(b.expiresDays)||7)
    )

    let code

    do{
      code=db.prepare(
        "SELECT upper(hex(randomblob(4))) AS code"
      ).get().code
    }while(
      db.prepare('SELECT 1 FROM band_invites WHERE code=?').get(code)
    )

    const id=crypto.randomUUID()
    const createdAt=new Date().toISOString()
    const expiresAt=new Date(
      Date.now()+expiresDays*24*60*60*1000
    ).toISOString()

    db.prepare(`
      INSERT INTO band_invites
        (
          id,band_id,code,created_by,expires_at,
          max_uses,use_count,active,created_at
        )
      VALUES (?,?,?,?,?,?,0,1,?)
    `).run(
      id,
      bandId,
      code,
      user.id,
      expiresAt,
      maxUses,
      createdAt
    )

    return json(res,201,{
      id,
      code,
      bandId,
      expiresAt,
      maxUses,
      useCount:0,
      active:true,
      shareUrl:`https://songbook.lyruma.app/join?code=${code}`
    })
  }

  if(req.method==='GET'&&bandInvites){
    const bandId=bandInvites[1]

    const owner=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=? AND role='owner'
    `).get(bandId,user.id)

    if(!owner)
      return json(res,403,{error:'Kein Zugriff.'})

    const rows=db.prepare(`
      SELECT
        id,
        code,
        expires_at AS expiresAt,
        max_uses AS maxUses,
        use_count AS useCount,
        active,
        created_at AS createdAt
      FROM band_invites
      WHERE band_id=?
      ORDER BY created_at DESC
    `).all(bandId)

    return json(res,200,rows.map(item=>({
      ...item,
      active:Boolean(item.active),
      shareUrl:`https://songbook.lyruma.app/join?code=${item.code}`
    })))
  }

  // -------------------------------------------------------
  // Mit Einladungscode beitreten
  // -------------------------------------------------------
  if(req.method==='POST'&&url.pathname==='/api/bands/join-by-code'){
    const b=await bodyJson(req)
    const code=String(b.code||'')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g,'')

    if(!code)
      return json(res,400,{error:'Bitte Einladungscode eingeben.'})

    const invite=db.prepare(`
      SELECT
        i.*,
        b.name AS band_name
      FROM band_invites i
      JOIN bands b ON b.id=i.band_id
      WHERE i.code=?
    `).get(code)

    if(!invite)
      return json(res,404,{error:'Einladungscode nicht gefunden.'})

    if(!invite.active)
      return json(res,410,{error:'Diese Einladung ist nicht mehr aktiv.'})

    if(invite.expires_at && Date.parse(invite.expires_at)<Date.now())
      return json(res,410,{error:'Diese Einladung ist abgelaufen.'})

    if(invite.use_count>=invite.max_uses)
      return json(res,410,{error:'Diese Einladung wurde bereits zu oft verwendet.'})

    const existing=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(invite.band_id,user.id)

    if(!existing){
      db.prepare(`
        INSERT INTO band_members
          (band_id,user_id,role,joined_at)
        VALUES (?,?,'member',?)
      `).run(
        invite.band_id,
        user.id,
        new Date().toISOString()
      )

      db.prepare(`
        UPDATE band_invites
        SET use_count=use_count+1
        WHERE id=?
      `).run(invite.id)
    }

    db.prepare(`
      UPDATE band_join_requests
      SET status='accepted',updated_at=?
      WHERE band_id=? AND user_id=?
    `).run(
      new Date().toISOString(),
      invite.band_id,
      user.id
    )

    return json(res,200,{
      ok:true,
      band:{
        id:invite.band_id,
        name:invite.band_name
      }
    })
  }

  if(req.method==='GET'&&url.pathname==='/api/bands'){
    const rows=db.prepare(`SELECT b.id,b.name,b.description,b.logo_path IS NOT NULL AS hasLogo,m.role
      FROM bands b
      JOIN band_members m ON m.band_id=b.id
      WHERE m.user_id=?
      ORDER BY lower(b.name),b.name`).all(user.id).map(item=>({
        ...item,
        hasLogo:Boolean(item.hasLogo),
        joined:true,
        active:item.id===bandId,
        canEdit:item.role==='owner'
      }))
    return json(res,200,rows)
  }

  if(req.method==='POST'&&url.pathname==='/api/bands'){
    const b=await bodyJson(req)
    const name=String(b.name||'').trim()
    const description=String(b.description||'').trim()

    if(name.length<2||name.length>80)
      return json(res,400,{error:'Der Bandname muss zwischen 2 und 80 Zeichen lang sein.'})

    if(description.length>300)
      return json(res,400,{error:'Die Beschreibung darf höchstens 300 Zeichen enthalten.'})

    const duplicate=db.prepare(`
      SELECT 1 FROM bands
      WHERE created_by=? AND lower(name)=lower(?)
    `).get(user.id,name)

    if(duplicate)
      return json(res,409,{error:'Du hast bereits eine Band mit diesem Namen.'})

    const id=randomUUID()
    const now=new Date().toISOString()

    db.exec('BEGIN')
    try{
      db.prepare('INSERT INTO bands (id,name,description,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(id,name,description,user.id,now)

      db.prepare('INSERT INTO band_members (band_id,user_id,role,joined_at) VALUES (?,?,?,?)')
        .run(id,user.id,'owner',now)

      db.exec('COMMIT')
    }catch(e){
      db.exec('ROLLBACK')
      throw e
    }

    res.setHeader('set-cookie',bandCookie(id))
    return json(res,201,{
      id,
      name,
      description,
      role:'owner',
      joined:true,
      active:true,
      canEdit:true
    })
  }

  const bandEdit=url.pathname.match(/^\/api\/bands\/([^/]+)$/)

  if(req.method==='PATCH'&&bandEdit){
    const membership=db.prepare(`
      SELECT role FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandEdit[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf diese Band bearbeiten.'})

    const b=await bodyJson(req)
    const name=String(b.name||'').trim()
    const description=String(b.description||'').trim()

    if(name.length<2||name.length>80)
      return json(res,400,{error:'Der Bandname muss zwischen 2 und 80 Zeichen lang sein.'})

    if(description.length>300)
      return json(res,400,{error:'Die Beschreibung darf höchstens 300 Zeichen enthalten.'})

    const duplicate=db.prepare(`
      SELECT 1 FROM bands
      WHERE created_by=? AND lower(name)=lower(?) AND id<>?
    `).get(user.id,name,bandEdit[1])

    if(duplicate)
      return json(res,409,{error:'Du hast bereits eine andere Band mit diesem Namen.'})

    db.prepare('UPDATE bands SET name=?,description=? WHERE id=?')
      .run(name,description,bandEdit[1])

    return json(res,200,{
      id:bandEdit[1],
      name,
      description,
      role:'owner',
      joined:true,
      active:bandEdit[1]===bandId,
      canEdit:true
    })
  }

  if(req.method==='DELETE'&&bandEdit){
    const membership=db.prepare(`
      SELECT role FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandEdit[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf diese Band löschen.'})

    const bandRow=db.prepare('SELECT logo_path FROM bands WHERE id=?').get(bandEdit[1])

    db.exec('BEGIN')
    try{
      db.prepare('DELETE FROM appointments WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM sets WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_join_requests WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_invites WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_team WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_songs WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_members WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM bands WHERE id=?').run(bandEdit[1])
      db.exec('COMMIT')
    }catch(e){
      db.exec('ROLLBACK')
      throw e
    }

    if(bandRow?.logo_path)
      await unlink(bandRow.logo_path).catch(()=>{})

    if(bandEdit[1]===bandId)
      res.setHeader('set-cookie',bandCookie('',0))

    return json(res,200,{ok:true})
  }

  const bandLogo=url.pathname.match(/^\/api\/bands\/([^/]+)\/logo$/)

  if(req.method==='GET'&&bandLogo){
    const membership=db.prepare(
      'SELECT 1 FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership)return json(res,403,{error:'Kein Zugriff'})

    const row=db.prepare(
      'SELECT logo_path,logo_mime FROM bands WHERE id=?'
    ).get(bandLogo[1])

    if(!row?.logo_path)return json(res,404,{error:'Kein Band-Logo vorhanden.'})

    try{
      const data=await readFile(row.logo_path)
      res.writeHead(200,{
        'content-type':row.logo_mime||'image/png',
        'content-length':data.length,
        'cache-control':'private,max-age=3600'
      })
      return res.end(data)
    }catch{
      return json(res,404,{error:'Band-Logo nicht gefunden.'})
    }
  }

  if(req.method==='POST'&&bandLogo){
    const membership=db.prepare(
      'SELECT role FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf das Logo ändern.'})

    const request=new Request(url,{
      method:'POST',
      headers:req.headers,
      body:Readable.toWeb(req),
      duplex:'half'
    })

    const form=await request.formData()
    const logo=form.get('logo')

    if(!logo||!logo.size)
      return json(res,400,{error:'Bitte ein Band-Logo auswählen.'})

    const type=String(logo.type||'').toLowerCase()
    const allowed=['image/jpeg','image/png','image/webp']

    if(!allowed.includes(type))
      return json(res,400,{error:'Bitte JPG, PNG oder WebP verwenden.'})

    if(logo.size>30*1024*1024)
      return json(res,400,{error:'Das Band-Logo darf höchstens 30 MB groß sein.'})

    const logoPath=`${root}/band-logo-${bandLogo[1]}`

    await writeFile(
      logoPath,
      Buffer.from(await logo.arrayBuffer())
    )

    db.prepare(
      'UPDATE bands SET logo_path=?,logo_mime=? WHERE id=?'
    ).run(logoPath,type,bandLogo[1])

    return json(res,200,{ok:true})
  }

  if(req.method==='DELETE'&&bandLogo){
    const membership=db.prepare(
      'SELECT role FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf das Logo entfernen.'})

    const row=db.prepare(
      'SELECT logo_path FROM bands WHERE id=?'
    ).get(bandLogo[1])

    if(row?.logo_path)
      await unlink(row.logo_path).catch(()=>{})

    db.prepare(
      'UPDATE bands SET logo_path=NULL,logo_mime=NULL WHERE id=?'
    ).run(bandLogo[1])

    return json(res,200,{ok:true})
  }

  if(req.method==='POST'&&url.pathname==='/api/bands/personal/select'){
    res.setHeader('set-cookie',bandCookie('',0))
    return json(res,200,{ok:true,activeBandId:null})
  }

  const bandSelect=url.pathname.match(/^\/api\/bands\/([^/]+)\/select$/)
  if(req.method==='POST'&&bandSelect){
    if(!db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandSelect[1],user.id))
      return json(res,403,{error:'Kein Zugriff auf diese Band.'})

    res.setHeader('set-cookie',bandCookie(bandSelect[1]))
    return json(res,200,{ok:true,activeBandId:bandSelect[1]})
  }

  const bandMembers=url.pathname.match(/^\/api\/bands\/([^/]+)\/members$/);if(req.method==='GET'&&bandMembers){if(!db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandMembers[1],user.id))return json(res,403,{error:'Kein Zugriff'});const accounts=db.prepare('SELECT u.id,u.name,u.username,m.role FROM band_members m JOIN users u ON u.id=m.user_id WHERE m.band_id=? ORDER BY u.name').all(bandMembers[1]);const profiles=db.prepare('SELECT t.id,t.name,t.initials,t.roles FROM band_team bt JOIN team t ON t.id=bt.team_id WHERE bt.band_id=? ORDER BY t.name').all(bandMembers[1]).map(item=>({...item,roles:JSON.parse(item.roles),profile:true}));return json(res,200,{accounts,profiles})}
  if (req.method==='GET' && url.pathname==='/api/songs') return json(res,200,songRows(user.id,bandId))
  if (req.method==='POST' && url.pathname==='/api/songs') {
    const request = new Request(url, {method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'})
    const form = await request.formData(); const titles=JSON.parse(form.get('titles')||'[]'); const files=form.getAll('files'); const base=Date.now()
    if(!files.length||files.length>50)return json(res,400,{error:'Bitte 1 bis 50 PDF-Dateien auswählen.'})
    if(files.some(file=>(file.type&&file.type!=='application/pdf')||!file.name.toLowerCase().endsWith('.pdf')||file.size>20*1024*1024))return json(res,400,{error:'Bitte nur PDF-Dateien bis maximal 20 MB importieren.'})
    db.exec('BEGIN'); try { for (let i=0;i<files.length;i++) { const file=files[i]; const id=randomUUID(); const path=`${root}/pdfs/${id}.pdf`; await writeFile(path, Buffer.from(await file.arrayBuffer())); db.prepare('INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,titles[i]||file.name.replace(/\.pdf$/i,''),'Importierte PDF',file.name,file.size,path,base-i,new Date().toISOString(),'–',user.id);if(bandId)db.prepare('INSERT INTO band_songs VALUES (?,?)').run(bandId,id) } db.exec('COMMIT') } catch(e){db.exec('ROLLBACK');throw e}
    const createdSongs=songRows(user.id,bandId).slice(0,files.length)
    for (const song of createdSongs) {
      queueResolveSongCover(db,{songId:song.id,title:song.title,artist:song.artist,key:song.key||song.preferredKey||'',root})
      queueResolveSongYoutube(db,{songId:song.id,title:song.title,artist:song.artist||''})
    }
    return json(res,201,createdSongs) /* cover-bulk */
  }
  if(req.method==='POST'&&url.pathname==='/api/scans/preview'){
    const request=new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'})
    const form=await request.formData()
    const pdf=form.get('pdf')
    if(!pdf||typeof pdf==='string')return json(res,400,{error:'Bitte eine PDF-Datei hochladen.'})
    const name=String(pdf.name||'').toLowerCase()
    if((pdf.type&&pdf.type!=='application/pdf'&&pdf.type!=='application/x-pdf')||(!name.endsWith('.pdf')&&pdf.type!=='application/pdf'))return json(res,400,{error:'Bitte eine PDF-Datei auswählen.'})
    if(pdf.size>20*1024*1024)return json(res,400,{error:'PDF darf maximal 20 MB groß sein.'})
    const dir=await mkdtemp(join(tmpdir(),'songbook-scan-preview-'))
    const tempPdf=join(dir,'source.pdf')
    try{
      await writeFile(tempPdf,Buffer.from(await pdf.arrayBuffer()))
      const preview=await previewPdfImport(tempPdf)
      return json(res,200,preview)
    }catch(error){
      console.error('pdf preview failed:',error?.message||error)
      return json(res,422,{error:error?.message||'PDF-Vorschau fehlgeschlagen.'})
    }finally{
      await rm(dir,{recursive:true,force:true})
    }
  }
  if(req.method==='POST'&&url.pathname==='/api/scans'){
    const request=new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'})
    const form=await request.formData()
    const title=String(form.get('title')||'').trim()
    const pages=form.getAll('pages')
    const pdf=form.get('pdf')
    const textRaw=form.get('text')
    const selectedPagesRaw=String(form.get('selectedPages')||'').trim()
    let selectedPages=[]
    if(selectedPagesRaw){
      try{selectedPages=JSON.parse(selectedPagesRaw)}catch{return json(res,400,{error:'selectedPages ist ungültig.'})}
      if(!Array.isArray(selectedPages)||selectedPages.some((value)=>!Number.isInteger(value)||value<0))return json(res,400,{error:'selectedPages ist ungültig.'})
    }
    if(!title)return json(res,400,{error:'Bitte einen Songtitel angeben.'})

    const id=randomUUID()
    const path=`${root}/pdfs/${id}.pdf`
    let artist='Gescannter Import'
    let fileName=`${title}.pdf`
    let fileSize=0
    let scanResult=null
    let forceScan=true

    if(typeof textRaw==='string' && textRaw.trim()){
      const parsed=parseChordOverLyricsText(textRaw,{titleHint:title,injectTonart:true})
      if(!parsed.text)return json(res,422,{error:'Aus dem Text konnte kein Lead-Sheet erkannt werden.'})
      await textToReferencePdf(parsed.text,path,title)
      fileSize=Buffer.byteLength(parsed.text,'utf8')
      artist='Text-Import'
      scanResult=finalizeScanResult({
        text:parsed.text,
        key:parsed.key,
        method:parsed.method,
        quality:parsed.quality,
        needsReview:parsed.needsReview,
        avgConfidence:parsed.chordConfidence||null,
      })
      forceScan=false
    }else if(pdf && typeof pdf!=='string'){
      const name=String(pdf.name||'').toLowerCase()
      if((pdf.type&&pdf.type!=='application/pdf'&&pdf.type!=='application/x-pdf')||(!name.endsWith('.pdf')&&pdf.type!=='application/pdf'))return json(res,400,{error:'Bitte eine PDF-Datei auswählen.'})
      if(pdf.size>20*1024*1024)return json(res,400,{error:'PDF darf maximal 20 MB groß sein.'})
      const dir=await mkdtemp(join(tmpdir(),'songbook-scan-pdf-'))
      const sourcePdf=join(dir,'source.pdf')
      try{
        await writeFile(sourcePdf,Buffer.from(await pdf.arrayBuffer()))
        const count=await pdfPageCount(sourcePdf)
        if(count>1 && !selectedPages.length){
          const preview=await previewPdfImport(sourcePdf)
          return json(res,409,{error:'Mehrseitige PDF – bitte Seiten auswählen.',needsPageSelection:true,...preview})
        }
        const pagesToUse=selectedPages.length?selectedPages:(count<=1?[0]:[])
        if(!pagesToUse.length)return json(res,400,{error:'Bitte die Song-Seiten auswählen.'})
        if(pagesToUse.length>8)return json(res,400,{error:'Bitte höchstens 8 Seiten für einen Song auswählen.'})
        await extractPdfPages(sourcePdf,pagesToUse,path)
        fileSize=pdf.size
        artist='PDF-Import'
        fileName=String(pdf.name||`${title}.pdf`)
        // Prefer embedded text layer; OCR/vision only when needed.
        forceScan=false
        try{scanResult=finalizeScanResult(await analyzeSongPdf(path,{forceScan:false,titleHint:title}))}catch(error){console.error('pdf analyze failed:',error?.message||error)}
      }finally{
        await rm(dir,{recursive:true,force:true})
      }
    }else{
      if(!pages.length||pages.length>8)return json(res,400,{error:'Bitte Titel und 1 bis 8 Scan-Seiten angeben.'})
      if(pages.some(page=>!String(page.type).startsWith('image/')||page.size>20*1024*1024))return json(res,400,{error:'Bitte nur Bilder bis 20 MB pro Seite verwenden.'})
      const dir=await mkdtemp(join(tmpdir(),'songbook-scan-'))
      try{
        const inputs=[]
        for(let index=0;index<pages.length;index++){
          const input=join(dir,`page-${String(index).padStart(2,'0')}`)
          await writeFile(input,Buffer.from(await pages[index].arrayBuffer()))
          inputs.push(input)
        }
        await execFileAsync('/usr/bin/python3',['/var/www/songbook/scan_to_pdf.py',path,...inputs],{maxBuffer:20*1024*1024,timeout:90000})
      }finally{
        await rm(dir,{recursive:true,force:true})
      }
      fileSize=pages.reduce((sum,page)=>sum+page.size,0)
      forceScan=true
      try{scanResult=finalizeScanResult(await analyzeSongPdf(path,{forceScan:true,titleHint:title}))}catch(error){console.error('scan analyze failed:',error?.message||error)}
    }

    db.prepare('INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,source_key,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,title,artist,fileName,fileSize,path,Date.now(),new Date().toISOString(),'–','',user.id)
    if(bandId)db.prepare('INSERT INTO band_songs VALUES (?,?)').run(bandId,id)
    persistScanSnapshot(db,{
      songId:id,
      pdfPath:path,
      documentHash:sha256(await readFile(path)),
      result:scanResult||{method:forceScan?'scan_failed':'import_failed',needsReview:true},
    })
    const created=songRows(user.id,bandId).find(song=>song.id===id)
    queueResolveSongCover(db,{songId:id,title,artist,key:created?.key||created?.preferredKey||'',root})
    queueResolveSongYoutube(db,{songId:id,title,artist})
    return json(res,201,created) /* cover-scan */
  }
  const protectedSong=url.pathname.match(/^\/api\/songs\/([^/]+)/)
  if(protectedSong&&!(bandId?db.prepare('SELECT 1 FROM band_songs WHERE song_id=? AND band_id=?').get(protectedSong[1],bandId):db.prepare('SELECT 1 FROM songs WHERE id=? AND owner_id=?').get(protectedSong[1],user.id)))return json(res,404,{error:'Song nicht gefunden'})
  /* cover-endpoints */
  const coverMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/cover$/)
  if(req.method==='GET'&&coverMatch){
    const row=db.prepare('SELECT cover_path,cover_mime FROM songs WHERE id=?').get(coverMatch[1])
    if(!row?.cover_path)return json(res,404,{error:'Kein Cover'})
    const data=await readFile(row.cover_path)
    res.writeHead(200,{'content-type':row.cover_mime||'image/jpeg','cache-control':'private,max-age=86400'})
    return res.end(data)
  }
  const resolveCoverMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/resolve-cover$/)
  if(req.method==='POST'&&resolveCoverMatch){
    const row=db.prepare('SELECT id,title,artist,song_key,preferred_key,cover_path FROM songs WHERE id=?').get(resolveCoverMatch[1])
    if(!row)return json(res,404,{error:'Song nicht gefunden'})
    if(row.cover_path){
      return json(res,200,{ok:true,hasCover:true,coverUrl:`/api/songs/${row.id}/cover`,coverSource:db.prepare('SELECT cover_source FROM songs WHERE id=?').get(row.id)?.cover_source||''})
    }
    const resolved=await persistSongCover(db,{songId:row.id,title:row.title,artist:row.artist||'',key:row.preferred_key||row.song_key||'',root})
    return json(res,200,{ok:true,...resolved})
  }
  const resolveYoutubeMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/resolve-youtube$/)
  if(req.method==='POST'&&resolveYoutubeMatch){
    const row=db.prepare('SELECT id,title,artist,youtube_url,youtube_video_id,youtube_source FROM songs WHERE id=?').get(resolveYoutubeMatch[1])
    if(!row)return json(res,404,{error:'Song nicht gefunden'})
    if(row.youtube_url){
      return json(res,200,{ok:true,youtubeUrl:row.youtube_url,youtubeVideoId:row.youtube_video_id||'',youtubeSource:row.youtube_source||''})
    }
    const resolved=await persistSongYoutube(db,{songId:row.id,title:row.title,artist:row.artist||''})
    return json(res,200,{ok:true,...resolved})
  }
  const pdfMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/pdf$/)
  if(req.method==='GET'&&pdfMatch){const row=db.prepare('SELECT pdf_path,file_name FROM songs WHERE id=?').get(pdfMatch[1]);if(!row)return json(res,404,{error:'Nicht gefunden'});const data=await readFile(row.pdf_path);res.writeHead(200,{'content-type':'application/pdf','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`});return res.end(data)}
  const snapshotMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/snapshot$/)
  if(req.method==='GET'&&snapshotMatch){return json(res,200,snapshotStateResponse(getSongSnapshotState(db,snapshotMatch[1])))}
  const analyzeMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/analyze-chords$/)
  if(req.method==='POST'&&analyzeMatch){
    const songId=analyzeMatch[1]
    const soft=repairSongSnapshotFromStoredText(db,songId)
    if(soft.repaired){
      return json(res,200,{...snapshotStateResponse(soft.state),reanalyzed:true,mode:'soft_repair'})
    }
    const row=db.prepare('SELECT pdf_path,title FROM songs WHERE id=?').get(songId)
    if(!row?.pdf_path){
      return json(res,200,{...snapshotStateResponse(getSongSnapshotState(db,songId)),reanalyzed:false,mode:'no_pdf',reason:soft.reason||'no_pdf'})
    }
    let scanResult=null
    try{
      scanResult=finalizeScanResult(await analyzeSongPdf(row.pdf_path,{forceScan:true,titleHint:row.title||''}))
    }catch(error){
      console.error('reanalyze failed:',error?.message||error)
      return json(res,422,{error:error?.message||'Erneute Analyse fehlgeschlagen.',reanalyzed:false})
    }
    if(!scanResult?.text){
      return json(res,422,{error:'Aus dem Original-PDF konnte kein Lead-Sheet erkannt werden.',reanalyzed:false})
    }
    const documentHash=sha256(await readFile(row.pdf_path))
    replaceScanSnapshot(db,{
      songId,
      pdfPath:row.pdf_path,
      documentHash,
      result:scanResult,
    })
    return json(res,200,{...snapshotStateResponse(getSongSnapshotState(db,songId)),reanalyzed:true,mode:'pdf_reanalyze',method:scanResult.method||''})
  }
  const pagesMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/pages$/)
  if(req.method==='GET'&&pagesMatch){
    const row=db.prepare('SELECT pdf_path FROM songs WHERE id=?').get(pagesMatch[1])
    if(!row)return json(res,404,{error:'Nicht gefunden'})
    const dir=await mkdtemp(join(tmpdir(),'songbook-pages-'))
    try{
      await execFileAsync('/usr/bin/pdftoppm',['-jpeg','-r','144',row.pdf_path,join(dir,'page')],{maxBuffer:30*1024*1024,timeout:60000})
      const files=(await readdir(dir)).filter(name=>name.endsWith('.jpg')||name.endsWith('.jpeg')).sort()
      const pages=[]
      for(const file of files){
        const data=await readFile(join(dir,file))
        pages.push({mime:'image/jpeg',dataUrl:`data:image/jpeg;base64,${data.toString('base64')}`})
      }
      return json(res,200,{pages})
    }finally{
      await rm(dir,{recursive:true,force:true})
    }
  }
  const variantMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/variants$/)
  if(req.method==='POST'&&variantMatch){
    const b=await bodyJson(req)
    try{return json(res,201,saveVariantFromVerifiedSnapshot(db,variantMatch[1],{targetKey:b.targetKey,overlayText:b.overlayText,sheetColumns:b.sheetColumns,sheetFontSize:b.sheetFontSize}))}
    catch(error){if(error instanceof SongTrustError)return json(res,error.status,{error:error.message,code:error.code,snapshotStatus:'review_required'});throw error}
  }
  if(req.method==='GET'&&variantMatch){const snapshot=getSongSnapshotState(db,variantMatch[1]).snapshot;if(!snapshot)return json(res,200,[]);const rows=db.prepare('SELECT target_key AS targetKey,source_key AS sourceKey,snapshot_id AS snapshotId,overlay_text AS overlayText,created_at AS createdAt FROM song_variants WHERE song_id=? AND snapshot_id=? ORDER BY created_at DESC').all(variantMatch[1],snapshot.id);return json(res,200,rows)}
  const chartMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/chart$/)
  if(req.method==='GET'&&chartMatch){
    const key=url.searchParams.get('key')
    const row=db.prepare("SELECT s.title,s.sheet_columns AS sheetColumns,s.sheet_font_size AS sheetFontSize,v.content,v.target_key AS targetKey FROM song_variants v JOIN songs s ON s.id=v.song_id JOIN song_original_snapshots snap ON snap.id=v.snapshot_id AND snap.song_id=v.song_id AND snap.status='verified' WHERE v.song_id=? AND v.target_key=?").get(chartMatch[1],key)
    if(!row)return json(res,404,{error:'Fassung nicht gefunden'})
    const qCols=url.searchParams.get('columns')
    const qFont=url.searchParams.get('fontSize')
    const html=renderChartHtmlDocument({
      title:row.title,
      targetKey:row.targetKey,
      content:row.content,
      columns:qCols!=null?normalizeSheetColumns(qCols):normalizeSheetColumns(row.sheetColumns),
      fontSize:qFont!=null?Number(qFont):row.sheetFontSize,
    })
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'})
    return res.end(html)
  }
  const songMatch=url.pathname.match(/^\/api\/songs\/([^/]+)$/)
  if(req.method==='PATCH'&&songMatch){
    const b=await bodyJson(req)
    const current=db.prepare('SELECT title,artist,song_key,sheet_columns,sheet_font_size FROM songs WHERE id=?').get(songMatch[1])
    if(!current)return json(res,404,{error:'Song nicht gefunden'})
    const title=String(b.title??current?.title??'').trim()
    const artist=String(b.artist??current?.artist??'Importierte PDF').trim()||'Importierte PDF'
    const selectedKey=String(b.key??current?.song_key??'–').trim()||'–'
    const sheetColumns=b.sheetColumns!=null?normalizeSheetColumns(b.sheetColumns):normalizeSheetColumns(current.sheet_columns)
    const sheetFontSize=b.sheetFontSize!=null?Math.min(28,Math.max(11,Number(b.sheetFontSize)||16)):Math.min(28,Math.max(11,Number(current.sheet_font_size)||16))
    if(!title)return json(res,400,{error:'Der Songtitel darf nicht leer sein.'})
    const changed=bandId
      ? db.prepare('UPDATE songs SET title=?,artist=?,song_key=?,sheet_columns=?,sheet_font_size=? WHERE id=?').run(title,artist,selectedKey,sheetColumns,sheetFontSize,songMatch[1])
      : db.prepare('UPDATE songs SET title=?,artist=?,song_key=?,sheet_columns=?,sheet_font_size=? WHERE id=? AND owner_id=?').run(title,artist,selectedKey,sheetColumns,sheetFontSize,songMatch[1],user.id)
    if(!changed.changes)return json(res,404,{error:'Song nicht gefunden'})
    return json(res,200,songRows(user.id,bandId).find(song=>song.id===songMatch[1]))
  }
  if(req.method==='DELETE'&&songMatch){const row=db.prepare('SELECT pdf_path,cover_path,is_protected FROM songs WHERE id=? AND owner_id=?').get(songMatch[1],user.id);if(!row)return json(res,404,{error:'Nicht gefunden'});if(row.is_protected)return json(res,403,{error:'Dieser bestehende Admin-Song ist geschützt.'});db.exec('BEGIN');try{db.prepare('DELETE FROM song_variants WHERE song_id=?').run(songMatch[1]);db.prepare('DELETE FROM band_songs WHERE song_id=?').run(songMatch[1]);const all=db.prepare('SELECT id,song_ids,leaders,song_keys FROM sets').all();for(const set of all){const ids=JSON.parse(set.song_ids).filter(id=>id!==songMatch[1]);const leaders=JSON.parse(set.leaders||'{}');const songKeys=JSON.parse(set.song_keys||'{}');delete leaders[songMatch[1]];delete songKeys[songMatch[1]];db.prepare('UPDATE sets SET song_ids=?,leaders=?,song_keys=? WHERE id=?').run(JSON.stringify(ids),JSON.stringify(leaders),JSON.stringify(songKeys),set.id)}db.prepare('DELETE FROM songs WHERE id=? AND owner_id=?').run(songMatch[1],user.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}await unlink(row.pdf_path).catch(()=>{});await unlink(row.cover_path).catch(()=>{});return json(res,200,{ok:true})} /* cover-delete */
  if(req.method==='GET'&&url.pathname==='/api/sets'){const rows=(bandId?db.prepare('SELECT * FROM sets WHERE band_id=? ORDER BY created_at DESC').all(bandId):db.prepare('SELECT * FROM sets WHERE owner_id=? AND band_id IS NULL ORDER BY created_at DESC').all(user.id)).map(r=>({...r,isProtected:Boolean(r.is_protected),songIds:JSON.parse(r.song_ids),leaders:JSON.parse(r.leaders||'{}'),songKeys:JSON.parse(r.song_keys||'{}'),eventTime:r.event_time||'',techNotes:r.tech_notes||'',technicianId:r.technician_id||'',arrivalTime:r.arrival_time||'',createdAt:r.created_at,song_ids:undefined,song_keys:undefined,created_at:undefined,event_time:undefined,tech_notes:undefined,technician_id:undefined,arrival_time:undefined}));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/sets'){const b=await bodyJson(req);const set={id:randomUUID(),title:b.title,date:b.date,eventTime:b.eventTime||'',arrivalTime:b.arrivalTime||'',band:b.band||band?.name||'',theme:b.theme||'',venue:b.venue||'',techNotes:'',technicianId:'',songIds:[],leaders:{},songKeys:{},createdAt:new Date().toISOString(),isProtected:false,bandId:bandId||null};db.prepare('INSERT INTO sets (id,title,date,song_ids,created_at,leaders,event_time,tech_notes,technician_id,band,theme,venue,arrival_time,song_keys,owner_id,band_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(set.id,set.title,set.date,'[]',set.createdAt,'{}',set.eventTime,'','',set.band,set.theme,set.venue,set.arrivalTime,'{}',user.id,bandId||null);return json(res,201,set)}
  const setMatch=url.pathname.match(/^\/api\/sets\/([^/]+)$/)
  if(setMatch&&!(bandId?db.prepare('SELECT 1 FROM sets WHERE id=? AND band_id=?').get(setMatch[1],bandId):db.prepare('SELECT 1 FROM sets WHERE id=? AND owner_id=? AND band_id IS NULL').get(setMatch[1],user.id)))return json(res,404,{error:'Set nicht gefunden'})
  if(req.method==='PUT'&&setMatch){const b=await bodyJson(req);const availableSongs=(b.songIds||[]).filter(id=>bandId?db.prepare('SELECT 1 FROM band_songs WHERE song_id=? AND band_id=?').get(id,bandId):db.prepare('SELECT 1 FROM songs WHERE id=? AND owner_id=?').get(id,user.id));if(bandId)db.prepare('UPDATE sets SET title=?,date=?,song_ids=?,leaders=?,event_time=?,tech_notes=?,technician_id=?,band=?,theme=?,venue=?,arrival_time=?,song_keys=? WHERE id=? AND band_id=?').run(b.title,b.date,JSON.stringify(availableSongs),JSON.stringify(b.leaders||{}),b.eventTime||'',b.techNotes||'',b.technicianId||'',b.band||band.name,b.theme||'',b.venue||'',b.arrivalTime||'',JSON.stringify(b.songKeys||{}),setMatch[1],bandId);else db.prepare('UPDATE sets SET title=?,date=?,song_ids=?,leaders=?,event_time=?,tech_notes=?,technician_id=?,band=?,theme=?,venue=?,arrival_time=?,song_keys=? WHERE id=? AND owner_id=?').run(b.title,b.date,JSON.stringify(availableSongs),JSON.stringify(b.leaders||{}),b.eventTime||'',b.techNotes||'',b.technicianId||'',b.band||'',b.theme||'',b.venue||'',b.arrivalTime||'',JSON.stringify(b.songKeys||{}),setMatch[1],user.id);return json(res,200,{...b,songIds:availableSongs,id:setMatch[1]})}
  if(req.method==='DELETE'&&setMatch){const set=bandId?db.prepare('SELECT is_protected FROM sets WHERE id=? AND band_id=?').get(setMatch[1],bandId):db.prepare('SELECT is_protected FROM sets WHERE id=? AND owner_id=?').get(setMatch[1],user.id);if(set.is_protected)return json(res,403,{error:'Dieses bestehende Admin-Set ist geschützt.'});db.prepare('DELETE FROM appointments WHERE set_id=?').run(setMatch[1]);db.prepare('DELETE FROM sets WHERE id=?').run(setMatch[1]);return json(res,200,{ok:true})}
  if(req.method==='GET'&&url.pathname==='/api/team'){const rows=(bandId?db.prepare('SELECT t.id,t.name,t.initials,t.roles,t.is_leader AS isLeader,t.is_organizer AS isOrganizer,t.is_designer AS isDesigner,t.is_technician AS isTechnician,t.photo_path IS NOT NULL AS hasPhoto,t.created_at AS createdAt FROM team t JOIN band_team bt ON bt.team_id=t.id WHERE bt.band_id=? ORDER BY t.name').all(bandId):db.prepare('SELECT id,name,initials,roles,is_leader AS isLeader,is_organizer AS isOrganizer,is_designer AS isDesigner,is_technician AS isTechnician,photo_path IS NOT NULL AS hasPhoto,created_at AS createdAt FROM team WHERE owner_id=? ORDER BY name').all(user.id)).map(m=>({...m,initials:m.initials||makeInitials(m.name),roles:JSON.parse(m.roles),isLeader:Boolean(m.isLeader),isOrganizer:Boolean(m.isOrganizer),isDesigner:Boolean(m.isDesigner),isTechnician:Boolean(m.isTechnician),hasPhoto:Boolean(m.hasPhoto)}));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/team'){const request=new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'});const form=await request.formData();const name=String(form.get('name')||'').trim();if(name.length<2||name.length>100)return json(res,400,{error:'Der Name muss zwischen 2 und 100 Zeichen lang sein.'});const id=randomUUID();const photo=form.get('photo');let photoPath=null,photoMime=null;if(photo&&photo.size){const type=String(photo.type||'').toLowerCase();if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type)||photo.size>30*1024*1024)return json(res,400,{error:'Bitte ein unterstütztes Bild bis maximal 30 MB verwenden.'});photoPath=`${root}/team-${id}`;photoMime=type;await writeFile(photoPath,Buffer.from(await photo.arrayBuffer()))}const member={id,name,initials:makeInitials(name),roles:JSON.parse(form.get('roles')||'[]'),isLeader:form.get('isLeader')==='true',isOrganizer:form.get('isOrganizer')==='true',isDesigner:form.get('isDesigner')==='true',isTechnician:form.get('isTechnician')==='true',hasPhoto:Boolean(photoPath),createdAt:new Date().toISOString()};db.prepare('INSERT INTO team (id,name,initials,roles,is_leader,is_organizer,photo_path,photo_mime,created_at,is_designer,is_technician,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,member.name,member.initials,JSON.stringify(member.roles),member.isLeader?1:0,member.isOrganizer?1:0,photoPath,photoMime,member.createdAt,member.isDesigner?1:0,member.isTechnician?1:0,user.id);if(bandId)db.prepare('INSERT INTO band_team VALUES (?,?)').run(bandId,id);return json(res,201,member)}
  const teamPhoto=url.pathname.match(/^\/api\/team\/([^/]+)\/photo$/);if(req.method==='GET'&&teamPhoto){const m=bandId?db.prepare('SELECT t.photo_path,t.photo_mime FROM team t JOIN band_team bt ON bt.team_id=t.id WHERE t.id=? AND bt.band_id=?').get(teamPhoto[1],bandId):db.prepare('SELECT photo_path,photo_mime FROM team WHERE id=? AND owner_id=?').get(teamPhoto[1],user.id);if(!m?.photo_path)return json(res,404,{error:'Kein Bild'});res.writeHead(200,{'content-type':m.photo_mime||'image/jpeg','cache-control':'private,max-age=3600'});return res.end(await readFile(m.photo_path))}
  const teamMatch=url.pathname.match(/^\/api\/team\/([^/]+)$/);if(req.method==='DELETE'&&teamMatch){if(bandId){if(!db.prepare('SELECT 1 FROM band_team WHERE band_id=? AND team_id=?').get(bandId,teamMatch[1]))return json(res,404,{error:'Teammitglied nicht gefunden'});db.prepare('DELETE FROM band_team WHERE band_id=? AND team_id=?').run(bandId,teamMatch[1]);const all=db.prepare('SELECT id,leaders FROM sets WHERE band_id=?').all(bandId);for(const set of all){const leaders=JSON.parse(set.leaders||'{}');for(const [songId,memberId] of Object.entries(leaders))if(memberId===teamMatch[1])delete leaders[songId];db.prepare('UPDATE sets SET leaders=? WHERE id=?').run(JSON.stringify(leaders),set.id)}return json(res,200,{ok:true})}const m=db.prepare('SELECT photo_path FROM team WHERE id=? AND owner_id=?').get(teamMatch[1],user.id);if(!m)return json(res,404,{error:'Teammitglied nicht gefunden'});db.prepare('DELETE FROM team WHERE id=? AND owner_id=?').run(teamMatch[1],user.id);const all=db.prepare('SELECT id,leaders FROM sets WHERE owner_id=?').all(user.id);for(const set of all){const leaders=JSON.parse(set.leaders||'{}');for(const [songId,memberId] of Object.entries(leaders))if(memberId===teamMatch[1])delete leaders[songId];db.prepare('UPDATE sets SET leaders=? WHERE id=? AND owner_id=?').run(JSON.stringify(leaders),set.id,user.id)}if(m?.photo_path)await unlink(m.photo_path).catch(()=>{});return json(res,200,{ok:true})}
  if(req.method==='GET'&&url.pathname==='/api/appointments'){const rows=(bandId?db.prepare('SELECT id,set_id AS setId,type,title,date,time,location,notes,created_at AS createdAt FROM appointments WHERE band_id=? ORDER BY date,time').all(bandId):db.prepare('SELECT id,set_id AS setId,type,title,date,time,location,notes,created_at AS createdAt FROM appointments WHERE owner_id=? AND band_id IS NULL ORDER BY date,time').all(user.id));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/appointments'){const b=await bodyJson(req);if(!(bandId?db.prepare('SELECT 1 FROM sets WHERE id=? AND band_id=?').get(b.setId,bandId):db.prepare('SELECT 1 FROM sets WHERE id=? AND owner_id=?').get(b.setId,user.id)))return json(res,400,{error:'Set nicht gefunden'});const item={id:randomUUID(),setId:b.setId,type:b.type,title:b.title,date:b.date,time:b.time||'',location:b.location||'',notes:b.notes||'',createdAt:new Date().toISOString()};db.prepare('INSERT INTO appointments (id,set_id,type,title,date,time,location,notes,created_at,owner_id,band_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.setId,item.type,item.title,item.date,item.time,item.location,item.notes,item.createdAt,user.id,bandId||null);return json(res,201,item)}
  const appointmentMatch=url.pathname.match(/^\/api\/appointments\/([^/]+)$/);if(req.method==='DELETE'&&appointmentMatch){if(bandId)db.prepare('DELETE FROM appointments WHERE id=? AND band_id=?').run(appointmentMatch[1],bandId);else db.prepare('DELETE FROM appointments WHERE id=? AND owner_id=?').run(appointmentMatch[1],user.id);return json(res,200,{ok:true})}
  return json(res,404,{error:'Nicht gefunden'})
} catch(e){console.error(e);json(res,500,{error:'Interner Serverfehler.'})} }).listen(8791,'127.0.0.1',()=>console.log('Songbook API on 127.0.0.1:8791'))
