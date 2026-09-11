/**
 * Original-recording BPM for Songbook import/analyze.
 *
 * Precedence:
 * 1. Chart/PDF/OCR text (TEMPO / BPM / ♩=) — never overwritten by lookup
 * 2. Online lookup (free sources; no paid-only dependency):
 *    a. SongBPM.com song page (GET `/@artist/title`, no API key)
 *    b. TheAudioDB searchtrack (demo key `2`, or THEAUDIODB_API_KEY)
 *    c. GetSongBPM API when GETSONGBPM_API_KEY is set (optional)
 * 3. Unknown → { bpm: null, source: '' }  (UI shows "–"; Cajón input may default to 120)
 *
 * Identity: same title cleanup + DE→EN worship map + optional iTunes metadata
 * as YouTube/cover resolve.
 */
import { parseTempoBpm, clampTempoBpm } from "./leadsheetAnalysis.mjs"
import { cleanSongTitle } from "./songCover.mjs"
import {
  fetchItunesMeta,
  isGenericArtist,
  mapOriginalTitle,
  matchScore,
} from "./songYoutube.mjs"

const USER_AGENT = "LyrumaSongbook/1.0 (+https://songbook.lyruma.app)"
const LOOKUP_TIMEOUT_MS = 6500

export const BPM_SOURCE_PDF = "pdf"
export const BPM_SOURCE_SONGBPM = "songbpm"
export const BPM_SOURCE_THEAUDIODB = "theaudiodb"
export const BPM_SOURCE_GETSONGBPM = "getsongbpm"

export function emptyBpmResult(reason = "") {
  return { bpm: null, source: "", reason, reportedBpm: null }
}

export function normalizeStoredBpm(value) {
  const bpm = clampTempoBpm(value, { fallback: null })
  return bpm == null ? null : bpm
}

export function songBpmSlug(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Parse a SongBPM.com song page. Uses the "Tempo (BPM)" definition list.
 * When the page labels a half-time that is exactly half of the displayed
 * tempo, prefer half-time (typical worship-chart feel, e.g. 136 → 68).
 */
export function parseSongBpmPage(html) {
  const raw = String(html || "")
  if (!raw || /<title>\s*404\b/i.test(raw)) return null
  const tempoMatch = raw.match(/Tempo\s*\(\s*BPM\s*\)\s*<\/dt>\s*<dd[^>]*>\s*(\d{2,3})/i)
  const primary = tempoMatch ? Number(tempoMatch[1]) : NaN
  if (!Number.isFinite(primary) || primary < 40 || primary > 240) return null
  const halfMatch =
    raw.match(/half-time<\/span>\s*at\s*<span[^>]*>\s*(\d{2,3})\s*BPM/i)
    || raw.match(/half-time[\s\S]{0,80}?(\d{2,3})\s*BPM/i)
  const halfBpm = halfMatch ? Number(halfMatch[1]) : NaN
  if (
    Number.isFinite(halfBpm)
    && halfBpm >= 40
    && halfBpm <= 120
    && primary === halfBpm * 2
  ) {
    return { bpm: halfBpm, reportedBpm: primary, halfTime: true }
  }
  return { bpm: primary, reportedBpm: primary, halfTime: false }
}

function artistCandidates(artist = "", { translated = false } = {}) {
  const list = []
  if (translated) {
    list.push("Hillsong Worship", "Hillsong United")
  }
  const raw = String(artist || "").trim()
  if (raw && !isGenericArtist(raw)) {
    list.push(raw)
    const first = raw.split(/\s*(?:&|feat\.?|ft\.?|featuring|\bx\b)\s+/i)[0]?.trim()
    if (first && first !== raw) list.push(first)
  }
  return [...new Set(list.filter(Boolean))]
}

function isTranslatedTitle(title = "") {
  const clean = cleanSongTitle(title)
  const mapped = mapOriginalTitle(title)
  if (!mapped || !clean) return Boolean(mapped)
  return mapped.toLowerCase() !== clean.toLowerCase()
}

function titleCandidates(title = "", itunesTitle = "") {
  const clean = cleanSongTitle(title)
  const mapped = mapOriginalTitle(title)
  return [...new Set([mapped, itunesTitle, clean].map((value) => String(value || "").trim()).filter(Boolean))]
}

async function fetchWithTimeout(fetchImpl, url, { timeout = LOOKUP_TIMEOUT_MS, headers = {}, method = "GET" } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...headers },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(fetchImpl, url, options) {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, options)
    if (!response?.ok) return ""
    return await response.text()
  } catch {
    return ""
  }
}

async function fetchJson(fetchImpl, url, options) {
  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      ...options,
      headers: { accept: "application/json", ...options?.headers },
    })
    if (!response?.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function lookupSongBpmSongbpm({ title, artist = "", fetchImpl = fetch } = {}) {
  const titles = titleCandidates(title)
  const artists = artistCandidates(artist, { translated: isTranslatedTitle(title) })
  if (!titles.length || !artists.length) return emptyBpmResult("missing_identity")

  for (const useTitle of titles) {
    for (const useArtist of artists) {
      const artistSlug = songBpmSlug(useArtist)
      const titleSlug = songBpmSlug(useTitle)
      if (!artistSlug || !titleSlug) continue
      const url = `https://songbpm.com/@${artistSlug}/${titleSlug}`
      const html = await fetchText(fetchImpl, url)
      const parsed = parseSongBpmPage(html)
      if (!parsed) continue
      return {
        bpm: parsed.bpm,
        source: BPM_SOURCE_SONGBPM,
        reason: parsed.halfTime ? "songbpm_halftime" : "songbpm",
        reportedBpm: parsed.reportedBpm,
        url,
        title: useTitle,
        artist: useArtist,
      }
    }
  }
  return emptyBpmResult("songbpm_miss")
}

function readTempoField(row) {
  const raw = row?.intTempo ?? row?.tempo ?? row?.bpm ?? row?.Tempo
  const bpm = normalizeStoredBpm(raw)
  return bpm
}

export async function lookupSongBpmTheAudioDb({ title, artist = "", fetchImpl = fetch } = {}) {
  const apiKey = String(process.env.THEAUDIODB_API_KEY || "2").trim() || "2"
  const titles = titleCandidates(title)
  const artists = artistCandidates(artist, { translated: isTranslatedTitle(title) })
  if (!titles.length || !artists.length) return emptyBpmResult("missing_identity")

  for (const useTitle of titles) {
    for (const useArtist of artists) {
      const url = `https://www.theaudiodb.com/api/v1/json/${encodeURIComponent(apiKey)}/searchtrack.php?s=${encodeURIComponent(useArtist)}&t=${encodeURIComponent(useTitle)}`
      const data = await fetchJson(fetchImpl, url)
      const tracks = Array.isArray(data?.track) ? data.track : (data?.track ? [data.track] : [])
      const ranked = tracks
        .map((item) => {
          const bpm = readTempoField(item)
          const score = matchScore(item.strTrack || "", useTitle)
            + (matchScore(item.strArtist || "", useArtist) / 2)
          return { item, bpm, score }
        })
        .filter((row) => row.bpm && row.score >= 5)
        .sort((a, b) => b.score - a.score)
      const best = ranked[0]
      const second = ranked[1]
      if (!best) continue
      if (second && second.score >= best.score - 1 && Math.abs(second.bpm - best.bpm) > 3) {
        return emptyBpmResult("ambiguous")
      }
      return {
        bpm: best.bpm,
        source: BPM_SOURCE_THEAUDIODB,
        reason: "theaudiodb",
        reportedBpm: best.bpm,
        title: best.item.strTrack || useTitle,
        artist: best.item.strArtist || useArtist,
      }
    }
  }
  return emptyBpmResult("theaudiodb_miss")
}

export async function lookupSongBpmGetSongBpm({ title, artist = "", fetchImpl = fetch } = {}) {
  const apiKey = String(process.env.GETSONGBPM_API_KEY || "").trim()
  if (!apiKey) return emptyBpmResult("getsongbpm_no_key")
  const useTitle = titleCandidates(title)[0]
  if (!useTitle) return emptyBpmResult("missing_identity")
  const useArtist = artistCandidates(artist, { translated: isTranslatedTitle(title) })[0] || ""
  const lookup = useArtist
    ? `song:${useTitle} artist:${useArtist}`
    : useTitle
  const url = `https://api.getsongbpm.com/search/?api_key=${encodeURIComponent(apiKey)}&type=${useArtist ? "both" : "song"}&lookup=${encodeURIComponent(lookup)}&limit=8`
  const data = await fetchJson(fetchImpl, url, { headers: { "X-API-KEY": apiKey } })
  const rows = []
    .concat(data?.search || [])
    .concat(data?.songs || [])
    .concat(Array.isArray(data) ? data : [])
  const ranked = rows
    .map((item) => {
      const songTitle = item.song_title || item.title || item.song || ""
      const songArtist = item.artist?.name || item.artist_name || item.artist || ""
      const bpm = readTempoField(item)
      let score = matchScore(songTitle, useTitle)
      if (useArtist) score += Math.min(4, matchScore(songArtist, useArtist) / 2)
      return { item, bpm, score, songTitle, songArtist }
    })
    .filter((row) => row.bpm && row.score >= 5)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  if (!best) return emptyBpmResult("getsongbpm_miss")
  if (second && second.score >= best.score - 1 && Math.abs(second.bpm - best.bpm) > 3) {
    return emptyBpmResult("ambiguous")
  }
  return {
    bpm: best.bpm,
    source: BPM_SOURCE_GETSONGBPM,
    reason: "getsongbpm",
    reportedBpm: best.bpm,
    title: best.songTitle || useTitle,
    artist: best.songArtist || useArtist,
  }
}

async function lookupOnlineBpm({ title, artist = "", fetchImpl = fetch } = {}) {
  const itunes = await fetchItunesMeta(title, artist, { fetchImpl }).catch(() => null)
  const preferredTitle = itunes?.trackName || title
  const preferredArtist = itunes?.artistName && !isGenericArtist(itunes.artistName)
    ? itunes.artistName
    : artist

  const songbpm = await lookupSongBpmSongbpm({
    title: preferredTitle,
    artist: preferredArtist,
    fetchImpl,
  })
  if (songbpm.bpm) return { ...songbpm, meta: { itunes } }

  const audioDb = await lookupSongBpmTheAudioDb({
    title: preferredTitle,
    artist: preferredArtist,
    fetchImpl,
  })
  if (audioDb.bpm || audioDb.reason === "ambiguous") return { ...audioDb, meta: { itunes } }

  const getSong = await lookupSongBpmGetSongBpm({
    title: preferredTitle,
    artist: preferredArtist,
    fetchImpl,
  })
  if (getSong.bpm || getSong.reason === "ambiguous") return { ...getSong, meta: { itunes } }

  return emptyBpmResult(songbpm.reason || audioDb.reason || getSong.reason || "lookup_miss")
}

/**
 * Resolve BPM from chart text first, then online lookup.
 */
export async function resolveSongBpm({ title, artist = "", chartText = "", fetchImpl = fetch } = {}) {
  const fromText = parseTempoBpm(chartText)
  if (fromText) {
    return { bpm: fromText, source: BPM_SOURCE_PDF, reason: "pdf", reportedBpm: fromText }
  }
  if (!cleanSongTitle(title) && !mapOriginalTitle(title)) {
    return emptyBpmResult("missing_title")
  }
  return lookupOnlineBpm({ title, artist, fetchImpl })
}

function snapshotChartText(db, songId) {
  try {
    return db.prepare(`
      SELECT original_text
      FROM song_original_snapshots
      WHERE song_id=?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(songId)?.original_text || ""
  } catch {
    return ""
  }
}

function bpmRow(bpm, source = "") {
  const value = normalizeStoredBpm(bpm)
  return {
    bpm: value,
    bpmSource: value ? String(source || "") : "",
  }
}

export async function persistSongBpm(db, {
  songId,
  title,
  artist = "",
  chartText,
  force = false,
  fetchImpl = fetch,
} = {}) {
  if (!songId) return bpmRow(null)
  const existing = db.prepare("SELECT bpm, bpm_source FROM songs WHERE id=?").get(songId)
  const existingBpm = normalizeStoredBpm(existing?.bpm)
  const existingSource = String(existing?.bpm_source || "")
  const text = chartText == null ? snapshotChartText(db, songId) : chartText
  const fromText = parseTempoBpm(text)

  if (fromText) {
    if (!force && existingSource === BPM_SOURCE_PDF && existingBpm === fromText) {
      return bpmRow(existingBpm, existingSource)
    }
    db.prepare("UPDATE songs SET bpm=?, bpm_source=? WHERE id=?").run(fromText, BPM_SOURCE_PDF, songId)
    return bpmRow(fromText, BPM_SOURCE_PDF)
  }

  if (!force && existingSource === BPM_SOURCE_PDF && existingBpm) {
    return bpmRow(existingBpm, existingSource)
  }
  if (!force && existingBpm) {
    return bpmRow(existingBpm, existingSource)
  }

  const resolved = await resolveSongBpm({ title, artist, chartText: text, fetchImpl })
  if (resolved.bpm) {
    db.prepare("UPDATE songs SET bpm=?, bpm_source=? WHERE id=?").run(resolved.bpm, resolved.source, songId)
    return bpmRow(resolved.bpm, resolved.source)
  }
  return bpmRow(existingBpm, existingSource)
}

export function queueResolveSongBpm(db, options) {
  setTimeout(() => {
    persistSongBpm(db, options).catch((error) => {
      console.error("song bpm resolve failed:", error?.message || error)
    })
  }, 0)
}
