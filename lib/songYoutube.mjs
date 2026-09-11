/**
 * YouTube rehearsal link resolution for Songbook.
 * Baseline: always store a YouTube search URL (no API key).
 * Improve query via known DE→EN worship titles + optional iTunes metadata.
 * If YOUTUBE_API_KEY is set, resolve a concrete watch URL via Data API.
 */
import { cleanSongTitle } from "./songCover.mjs"

const GENERIC_ARTISTS = new Set([
  "importierte pdf",
  "pdf-import",
  "gescannter import",
  "text-import",
  "lyruma songbook",
  "worship songbook",
])

/** Common German worship translations → original-language titles (prefer English recording). */
const DE_TO_ORIGINAL = new Map([
  ["wie schon dieser name ist", "What A Beautiful Name"],
  ["wie schön dieser name ist", "What A Beautiful Name"],
  ["was fur ein schoner name", "What A Beautiful Name"],
  ["was für ein schöner name", "What A Beautiful Name"],
  ["ankер in der zeit", "Cornerstone"],
  ["guter vater", "Good Good Father"],
  ["gross ist unser gott", "How Great Is Our God"],
  ["groß ist unser gott", "How Great Is Our God"],
  ["hier ist heilig", "Here As In Heaven"],
  ["so will ich dich preisen", "Worthy Of It All"],
  ["jesus wir sehen dich", "Open The Eyes Of My Heart"],
  ["ich lobe meinen gott", "I Will Praise Him Still"],
  ["dein name", "Your Name"],
  ["heilig heilig heilig", "Holy Holy Holy"],
  ["ewiglich", "Forever"],
  ["uber alles", "Above All"],
  ["über alles", "Above All"],
  ["nichts ist unmoglich", "Nothing Is Impossible"],
  ["nichts ist unmöglich", "Nothing Is Impossible"],
  ["wunderbarer name", "Wonderful Name"],
  ["sein name ist jesus", "His Name Is Jesus"],
  ["der name jesus", "The Name Of Jesus"],
  ["amazing grace mein kett en sind gefallen", "Amazing Grace (My Chains Are Gone)"],
  ["amazing grace meine ketten sind gefallen", "Amazing Grace (My Chains Are Gone)"],
  ["10.000 grunde", "10,000 Reasons"],
  ["10000 grunde", "10,000 Reasons"],
  ["zehntausend grunde", "10,000 Reasons"],
  ["oceans wo meine fusse gehen", "Oceans (Where Feet May Fail)"],
  ["ozeane wo meine fusse gehen", "Oceans (Where Feet May Fail)"],
  ["wer ist wie unser gott", "Who Is Like Our God"],
  ["konig aller konige", "King Of Kings"],
  ["könig aller könige", "King Of Kings"],
  ["lobpreis und ehre", "Praise"],
  ["living hope", "Living Hope"],
  ["grace to grace", "Grace To Grace"],
  ["so will ich leben", "This Is Living"],
  ["atmen", "Breathe"],
  ["frei", "Free"],
  ["heilig", "Holy"],
])

export function isGenericArtist(artist = "") {
  return GENERIC_ARTISTS.has(String(artist || "").trim().toLowerCase())
}

function normalizeKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function looksGermanHeavy(text = "") {
  const value = String(text || "").toLowerCase()
  return /[äöüß]/.test(value) || /\b(und|der|die|das|ist|mein|dein|unser|herr|gott|jesus|schön|schön|name)\b/i.test(value)
}

function looksEnglishTitle(text = "") {
  const value = String(text || "").trim()
  if (!value) return false
  if (/[äöüß]/i.test(value)) return false
  return /\b(what|beautiful|name|great|holy|king|grace|hope|ocean|forever|praise|father|spirit|love|lord|jesus|god|how|who|above|nothing|cornerstone|reason)\b/i.test(value)
}

export function mapOriginalTitle(title = "") {
  const clean = cleanSongTitle(title)
  const key = normalizeKey(clean)
  if (!key) return ""
  if (DE_TO_ORIGINAL.has(key)) return DE_TO_ORIGINAL.get(key)
  // Try without punctuation/spacing variants already normalized
  for (const [from, to] of DE_TO_ORIGINAL) {
    if (normalizeKey(from) === key) return to
  }
  return ""
}

function buildSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
}

function buildWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

export function matchScore(candidate, needle) {
  const a = normalizeKey(candidate)
  const b = normalizeKey(needle)
  if (!a || !b) return 0
  if (a === b) return 12
  if (a.includes(b) || b.includes(a)) return 8
  const aw = new Set(a.split(" ").filter(Boolean))
  const bw = b.split(" ").filter(Boolean)
  if (!bw.length) return 0
  const hit = bw.filter((word) => aw.has(word)).length
  const ratio = hit / bw.length
  if (ratio >= 0.85) return 7
  if (ratio >= 0.7) return 5
  return 0
}

export async function fetchItunesMeta(title, artist, { fetchImpl = fetch } = {}) {
  const clean = cleanSongTitle(title)
  if (!clean) return null
  const term = artist && !isGenericArtist(artist) ? `${clean} ${artist}` : clean
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8&country=DE`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "LyrumaSongbook/1.0 (+https://songbook.lyruma.app)" },
    })
    if (!response.ok) return null
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    const ranked = results
      .map((item) => {
        let score = matchScore(item.trackName || "", clean)
        score += Math.min(3, matchScore(item.collectionName || "", clean) / 4)
        if (artist && !isGenericArtist(artist)) score += Math.min(4, matchScore(item.artistName || "", artist) / 2)
        // Prefer English / original-language titles when the chart title is German
        if (looksGermanHeavy(clean) && looksEnglishTitle(item.trackName || "")) score += 3
        return { item, score }
      })
      .filter((row) => row.score >= 5)
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]?.item
    if (!best) return null
    return {
      trackName: String(best.trackName || "").trim(),
      artistName: String(best.artistName || "").trim(),
      collectionName: String(best.collectionName || "").trim(),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchYoutubeVideoId(query, apiKey) {
  if (!query || !apiKey) return null
  const url = new URL("https://www.googleapis.com/youtube/v3/search")
  url.searchParams.set("part", "snippet")
  url.searchParams.set("type", "video")
  url.searchParams.set("maxResults", "5")
  url.searchParams.set("q", query)
  url.searchParams.set("key", apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "LyrumaSongbook/1.0 (+https://songbook.lyruma.app)" },
    })
    if (!response.ok) return null
    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    const videoId = items.find((item) => item?.id?.videoId)?.id?.videoId
    return videoId ? String(videoId) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function buildYoutubeSearchQuery({ title, artist = "", preferredTitle = "", preferredArtist = "" } = {}) {
  const clean = cleanSongTitle(preferredTitle || title)
  const mapped = mapOriginalTitle(title)
  const useTitle = cleanSongTitle(preferredTitle) || mapped || clean
  const useArtistRaw = preferredArtist || artist
  const useArtist = useArtistRaw && !isGenericArtist(useArtistRaw) ? String(useArtistRaw).trim() : ""
  // Prefer worship recording phrasing for rehearsal listening
  const parts = [useTitle]
  if (useArtist) parts.push(useArtist)
  else if (mapped || (preferredTitle && preferredTitle !== clean)) parts.push("Hillsong")
  parts.push("official")
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
}

export async function resolveSongYoutubeAsset({ title, artist = "" } = {}) {
  const clean = cleanSongTitle(title)
  const mapped = mapOriginalTitle(title)
  const itunes = await fetchItunesMeta(clean || title, artist)
  let preferredTitle = mapped || clean
  if (itunes?.trackName) {
    const itunesTitle = itunes.trackName
    if (looksEnglishTitle(itunesTitle) || (looksGermanHeavy(clean) && !looksGermanHeavy(itunesTitle)) || matchScore(itunesTitle, mapped || clean) >= 7) {
      preferredTitle = itunesTitle
    }
  }
  let preferredArtist = itunes?.artistName && !isGenericArtist(itunes.artistName)
    ? itunes.artistName
    : (artist && !isGenericArtist(artist) ? artist : "")
  // When chart title is a known German translation, prefer the original worship recording artist.
  if (mapped) {
    const major = /hillsong|elevation|bethel|passion|chris tomlin|matt redman|worship/i.test(preferredArtist || "")
    if (!major) preferredArtist = "Hillsong"
  }

  const searchQuery = buildYoutubeSearchQuery({
    title: clean || title,
    artist,
    preferredTitle,
    preferredArtist,
  })
  const searchUrl = buildSearchUrl(searchQuery || clean || title || "worship")

  const apiKey = String(process.env.YOUTUBE_API_KEY || "").trim()
  if (apiKey) {
    const videoId = await fetchYoutubeVideoId(searchQuery, apiKey)
    if (videoId) {
      return {
        youtubeUrl: buildWatchUrl(videoId),
        youtubeVideoId: videoId,
        youtubeSource: "youtube_api",
        searchQuery,
        searchUrl,
        meta: { preferredTitle, preferredArtist, itunes },
      }
    }
  }

  return {
    youtubeUrl: searchUrl,
    youtubeVideoId: "",
    youtubeSource: itunes ? "itunes_search" : (mapped ? "translation_map" : "search"),
    searchQuery,
    searchUrl,
    meta: { preferredTitle, preferredArtist, itunes },
  }
}

export async function persistSongYoutube(db, { songId, title, artist = "", force = false } = {}) {
  if (!songId) return null
  const existing = db.prepare("SELECT youtube_url, youtube_video_id, youtube_source FROM songs WHERE id=?").get(songId)
  if (!force && existing?.youtube_url) {
    return {
      youtubeUrl: existing.youtube_url,
      youtubeVideoId: existing.youtube_video_id || "",
      youtubeSource: existing.youtube_source || "",
    }
  }

  const asset = await resolveSongYoutubeAsset({ title, artist })
  db.prepare("UPDATE songs SET youtube_url=?, youtube_video_id=?, youtube_source=? WHERE id=?").run(
    asset.youtubeUrl,
    asset.youtubeVideoId || "",
    asset.youtubeSource || "",
    songId,
  )
  return {
    youtubeUrl: asset.youtubeUrl,
    youtubeVideoId: asset.youtubeVideoId || "",
    youtubeSource: asset.youtubeSource || "",
    searchQuery: asset.searchQuery,
    searchUrl: asset.searchUrl,
  }
}

export function queueResolveSongYoutube(db, options) {
  setTimeout(() => {
    persistSongYoutube(db, options).catch((error) => {
      console.error("song youtube resolve failed:", error?.message || error)
    })
  }, 0)
}
