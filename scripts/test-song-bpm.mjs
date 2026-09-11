#!/usr/bin/env node
/**
 * BPM resolve: PDF/OCR text wins; online lookup is mocked (no live HTTP).
 */
import { DatabaseSync } from 'node:sqlite'
import {
  BPM_SOURCE_GETSONGBPM,
  BPM_SOURCE_PDF,
  BPM_SOURCE_SONGBPM,
  BPM_SOURCE_THEAUDIODB,
  parseSongBpmPage,
  persistSongBpm,
  resolveSongBpm,
  songBpmSlug,
} from '../lib/songBpm.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return body },
    async text() { return JSON.stringify(body) },
  }
}

function textResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return {} },
    async text() { return String(body) },
  }
}

const songBpmHtml = `
<title>BPM and key for What A Beautiful Name by Hillsong Worship</title>
<dl>
  <dt class="text-card-foreground truncate text-sm font-medium"> Tempo (BPM) </dt>
  <dd class="text-card-foreground mt-1 text-3xl font-semibold"> 136 </dd>
</dl>
<p>with a tempo of <span class="font-semibold">136 BPM</span>.
<span><span class="font-semibold">half-time</span> at <span class="font-semibold">68 BPM</span></span></p>
`

const songBpmHtmlNoHalf = `
<title>BPM and key for How Great Is Our God by Chris Tomlin</title>
<dt> Tempo (BPM) </dt>
<dd> 156 </dd>
`

const notFoundHtml = `<title>404 - Not Found | SongBPM</title><p>Not Found</p>`

assert(songBpmSlug('What a Beautiful Name') === 'what-a-beautiful-name', 'slug title')
assert(songBpmSlug('10,000 Reasons (Bless the Lord)') === '10-000-reasons-bless-the-lord', 'slug 10000 reasons')
assert(songBpmSlug('Hillsong Worship & Brooke Ligertwood') === 'hillsong-worship-and-brooke-ligertwood', 'slug artist pair')
console.log('OK slugify')

const parsedHalf = parseSongBpmPage(songBpmHtml)
assert(parsedHalf?.bpm === 68 && parsedHalf.halfTime === true && parsedHalf.reportedBpm === 136, 'SongBPM half-time 136→68')
const parsedPlain = parseSongBpmPage(songBpmHtmlNoHalf)
assert(parsedPlain?.bpm === 156 && parsedPlain.halfTime === false, 'SongBPM primary 156')
assert(parseSongBpmPage(notFoundHtml) == null, 'SongBPM 404 is empty')
assert(parseSongBpmPage('') == null, 'empty html')
console.log('OK parse SongBPM HTML')

const pdfFirst = await resolveSongBpm({
  title: 'What a Beautiful Name',
  artist: 'Hillsong Worship',
  chartText: 'TONART: D · TEMPO: 60 BPM\n[Verse]\nD',
  fetchImpl: async () => { throw new Error('lookup must not run when PDF has tempo') },
})
assert(pdfFirst.bpm === 60 && pdfFirst.source === BPM_SOURCE_PDF, `PDF tempo wins, got ${JSON.stringify(pdfFirst)}`)

const missingText = await resolveSongBpm({
  title: 'no tempo here',
  chartText: 'Just lyrics without a metronome mark',
  fetchImpl: async (url) => {
    const href = String(url)
    if (href.includes('itunes.apple.com')) return jsonResponse({ results: [] })
    return textResponse('', { ok: false, status: 404 })
  },
})
assert(missingText.bpm == null && missingText.source === '', 'unknown title stays empty (no invented 120)')
console.log('OK parse-from-text vs skip lookup')

const calls = []
const fetchImpl = async (url) => {
  const href = String(url)
  calls.push(href)
  if (href.includes('itunes.apple.com')) {
    return jsonResponse({
      results: [{
        trackName: 'What a Beautiful Name',
        artistName: 'Hillsong Worship',
        collectionName: 'What a Beautiful Name - Single',
      }],
    })
  }
  if (href.includes('getsongbpm.com') || href.includes('api.getsong.co')) {
    return jsonResponse({ search: [] }, { ok: false, status: 401 })
  }
  if (href.includes('songbpm.com/@hillsong-worship/what-a-beautiful-name')) {
    return textResponse(songBpmHtml)
  }
  if (href.includes('://songbpm.com')) return textResponse(notFoundHtml, { ok: false, status: 404 })
  if (href.includes('theaudiodb.com')) return jsonResponse({ track: null })
  throw new Error(`unexpected fetch ${href}`)
}

const lookedUp = await resolveSongBpm({
  title: 'Wie schön dieser Name ist-chords-D',
  artist: 'PDF-Import',
  chartText: 'G                 D\nKein Tempo in diesem Chart\n',
  fetchImpl,
})
assert(lookedUp.bpm === 68, `lookup BPM 68, got ${lookedUp.bpm}`)
assert(lookedUp.source === BPM_SOURCE_SONGBPM, `source songbpm, got ${lookedUp.source}`)
assert(calls.some((href) => href.includes('songbpm.com/@hillsong-worship/what-a-beautiful-name')), 'hits SongBPM slug')
console.log('OK lookup fallback (mocked SongBPM)')

const failed = await resolveSongBpm({
  title: 'Completely Unknown Chart Title XYZ',
  artist: 'Some Band',
  chartText: '',
  fetchImpl: async (url) => {
    const href = String(url)
    if (href.includes('itunes.apple.com')) return jsonResponse({ results: [] })
    if (href.includes('://songbpm.com')) return textResponse(notFoundHtml, { ok: false, status: 404 })
    if (href.includes('theaudiodb.com')) return jsonResponse({ track: null })
    return jsonResponse({}, { ok: false, status: 404 })
  },
})
assert(failed.bpm == null && failed.source === '', `lookup miss stays empty, got ${JSON.stringify(failed)}`)
console.log('OK lookup miss stays null')

const prevKey = process.env.GETSONGBPM_API_KEY
process.env.GETSONGBPM_API_KEY = 'test-key'
try {
  const ambiguous = await resolveSongBpm({
    title: 'Holy',
    artist: 'Hillsong',
    chartText: '',
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes('itunes.apple.com')) return jsonResponse({ results: [] })
      if (href.includes('://songbpm.com')) return textResponse(notFoundHtml, { ok: false, status: 404 })
      if (href.includes('theaudiodb.com')) {
        return jsonResponse({
          track: [
            { strTrack: 'Holy', strArtist: 'Hillsong', intTempo: '78' },
            { strTrack: 'Holy', strArtist: 'Hillsong', intTempo: '140' },
          ],
        })
      }
      return jsonResponse({ search: [] })
    },
  })
  assert(ambiguous.bpm == null && ambiguous.reason === 'ambiguous', `ambiguous lookup, got ${JSON.stringify(ambiguous)}`)
  console.log('OK ambiguous lookup stays empty')

  const fromGetSong = await resolveSongBpm({
    title: 'Living Hope',
    artist: 'Phil Wickham',
    chartText: '',
    fetchImpl: async (url) => {
      const href = String(url)
      if (href.includes('itunes.apple.com')) return jsonResponse({ results: [] })
      if (href.includes('getsongbpm.com') || href.includes('api.getsong.co')) {
        return jsonResponse({
          search: [{ song_title: 'Living Hope', artist: { name: 'Phil Wickham' }, tempo: '71' }],
        })
      }
      if (href.includes('://songbpm.com')) return textResponse(notFoundHtml, { ok: false, status: 404 })
      if (href.includes('theaudiodb.com')) return jsonResponse({ track: null })
      return jsonResponse({}, { ok: false, status: 404 })
    },
  })
  assert(fromGetSong.bpm === 71 && fromGetSong.source === BPM_SOURCE_GETSONGBPM, `GetSongBPM fallback, got ${JSON.stringify(fromGetSong)}`)
  console.log('OK optional GetSongBPM fallback')
} finally {
  if (prevKey == null) delete process.env.GETSONGBPM_API_KEY
  else process.env.GETSONGBPM_API_KEY = prevKey
}

const audioDb = await resolveSongBpm({
  title: 'Cornerstone',
  artist: 'Hillsong',
  chartText: '',
  fetchImpl: async (url) => {
    const href = String(url)
    if (href.includes('itunes.apple.com')) return jsonResponse({ results: [] })
    if (href.includes('://songbpm.com')) return textResponse(notFoundHtml, { ok: false, status: 404 })
    if (href.includes('theaudiodb.com')) {
      return jsonResponse({ track: [{ strTrack: 'Cornerstone', strArtist: 'Hillsong', intTempo: '70' }] })
    }
    return jsonResponse({}, { ok: false, status: 404 })
  },
})
assert(audioDb.bpm === 70 && audioDb.source === BPM_SOURCE_THEAUDIODB, `TheAudioDB fallback, got ${JSON.stringify(audioDb)}`)
console.log('OK TheAudioDB fallback')

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    bpm INTEGER,
    bpm_source TEXT DEFAULT ''
  );
  CREATE TABLE song_original_snapshots (
    id TEXT PRIMARY KEY,
    song_id TEXT,
    original_text TEXT,
    created_at TEXT
  );
`)
db.prepare('INSERT INTO songs (id,title,artist) VALUES (?,?,?)').run('s1', 'What a Beautiful Name', 'Hillsong Worship')

const afterLookup = await persistSongBpm(db, {
  songId: 's1',
  title: 'What a Beautiful Name',
  artist: 'Hillsong Worship',
  chartText: 'no tempo',
  fetchImpl,
})
assert(afterLookup.bpm === 68 && afterLookup.bpmSource === BPM_SOURCE_SONGBPM, 'persist lookup')
assert(db.prepare('SELECT bpm, bpm_source FROM songs WHERE id=?').get('s1').bpm === 68, 'row stored 68')

const keepLookup = await persistSongBpm(db, {
  songId: 's1',
  title: 'What a Beautiful Name',
  artist: 'Hillsong Worship',
  chartText: 'still no tempo',
  fetchImpl: async () => { throw new Error('should keep existing lookup') },
})
assert(keepLookup.bpm === 68 && keepLookup.bpmSource === BPM_SOURCE_SONGBPM, 'do not re-lookup when set')

const pdfWins = await persistSongBpm(db, {
  songId: 's1',
  title: 'What a Beautiful Name',
  artist: 'Hillsong Worship',
  chartText: 'Key - D | Tempo - 60 | Time - 4/4',
  fetchImpl: async () => { throw new Error('PDF must win without HTTP') },
})
assert(pdfWins.bpm === 60 && pdfWins.bpmSource === BPM_SOURCE_PDF, 'PDF overwrites lookup')
assert(db.prepare('SELECT bpm_source FROM songs WHERE id=?').get('s1').bpm_source === BPM_SOURCE_PDF, 'row source pdf')

const keepPdf = await persistSongBpm(db, {
  songId: 's1',
  title: 'What a Beautiful Name',
  artist: 'Hillsong Worship',
  chartText: 'chart without tempo after ocr miss',
  fetchImpl,
})
assert(keepPdf.bpm === 60 && keepPdf.bpmSource === BPM_SOURCE_PDF, 'do not overwrite PDF with lookup')
console.log('OK persist PDF vs lookup')

db.prepare('INSERT INTO songs (id,title,artist) VALUES (?,?,?)').run('s2', 'Oceans', 'Hillsong United')
db.prepare('INSERT INTO song_original_snapshots (id,song_id,original_text,created_at) VALUES (?,?,?,?)')
  .run('snap2', 's2', 'TEMPO: 66 BPM\n[Verse]\nD', '2026-09-11T00:00:00Z')
const fromSnapshot = await persistSongBpm(db, {
  songId: 's2',
  title: 'Oceans',
  artist: 'Hillsong United',
  fetchImpl: async () => { throw new Error('snapshot text is enough') },
})
assert(fromSnapshot.bpm === 66 && fromSnapshot.bpmSource === BPM_SOURCE_PDF, 'snapshot TEMPO used when chartText omitted')
console.log('OK snapshot text as PDF source')

console.log('ok song-bpm')
