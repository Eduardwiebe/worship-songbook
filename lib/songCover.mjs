/**
 * Legal cover resolution for Songbook tiles.
 * Prefer iTunes Search artwork (display-safe, cached server-side).
 * Fallback: deterministic procedural SVG from title/artist/key.
 * Never scrape SongSelect/CCLI chart covers.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"

const GENERIC_ARTISTS = new Set([
  "importierte pdf",
  "pdf-import",
  "gescannter import",
  "text-import",
  "lyruma songbook",
  "worship songbook",
])

export function cleanSongTitle(title = "") {
  return String(title || "")
    .replace(/\.pdf$/i, "")
    .replace(/\s*[-–—]\s*chords?\s*[-–—]?\s*[A-G][#b]?m?(?:\/[A-G][#b]?)?\s*$/i, "")
    .replace(/\s*[-–—]\s*chords?\s*$/i, "")
    .replace(/\s*\((chords?|akkorde|lyrics|liedtext)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isGenericArtist(artist = "") {
  return GENERIC_ARTISTS.has(String(artist || "").trim().toLowerCase())
}

function normalizeForMatch(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function matchScore(candidate, needle) {
  const a = normalizeForMatch(candidate)
  const b = normalizeForMatch(needle)
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

function searchTerm(title, artist) {
  const clean = cleanSongTitle(title)
  if (!clean) return ""
  if (artist && !isGenericArtist(artist)) return `${clean} ${artist}`.trim()
  return clean
}

function hashHue(input) {
  const digest = createHash("sha1").update(String(input || "song")).digest()
  return digest[0] % 360
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function wrapTitle(title, maxLen = 22) {
  const words = String(title || "Song").split(/\s+/).filter(Boolean)
  const lines = []
  let current = ""
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxLen && current) {
      lines.push(current)
      current = word
      if (lines.length >= 3) break
    } else {
      current = next
    }
  }
  if (current && lines.length < 3) lines.push(current)
  if (!lines.length) lines.push("Song")
  return lines
}

export function buildProceduralCoverSvg({ title, artist = "", key = "" } = {}) {
  const clean = cleanSongTitle(title) || "Song"
  const hue = hashHue(clean.toLowerCase())
  const hue2 = (hue + 42) % 360
  const lines = wrapTitle(clean)
  const keyLabel = key && key !== "–" ? `Tonart ${key}` : ""
  const artistLabel = artist && !isGenericArtist(artist) ? artist : "Lyruma Songbook"
  const lineYs = lines.map((_, index) => 78 + index * 36)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},38%,18%)"/>
      <stop offset="55%" stop-color="hsl(${hue2},32%,24%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 18) % 360},45%,38%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="22%" r="55%">
      <stop offset="0%" stop-color="hsla(${(hue + 50) % 360},70%,62%,.55)"/>
      <stop offset="100%" stop-color="hsla(${hue},40%,20%,0)"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#bg)"/>
  <rect width="600" height="600" fill="url(#glow)"/>
  <circle cx="470" cy="150" r="120" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="18"/>
  <circle cx="120" cy="480" r="90" fill="rgba(255,255,255,.06)"/>
  <g transform="translate(430 70)" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="10" stroke-linecap="round">
    <path d="M70 40 v150"/>
    <path d="M70 40 c40 8 62 28 62 62"/>
    <ellipse cx="48" cy="195" rx="28" ry="20" fill="rgba(255,255,255,.55)" stroke="none"/>
  </g>
  <rect x="28" y="28" width="544" height="544" rx="36" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="3"/>
  ${lines.map((line, index) => `<text x="48" y="${lineYs[index]}" fill="#fff" font-family="Georgia, Times New Roman, serif" font-size="34" font-weight="700">${escapeXml(line)}</text>`).join("\n  ")}
  <text x="48" y="520" fill="rgba(255,255,255,.78)" font-family="system-ui,sans-serif" font-size="22" font-weight="600">${escapeXml(artistLabel)}</text>
  ${keyLabel ? `<text x="48" y="552" fill="rgba(226,185,85,.95)" font-family="system-ui,sans-serif" font-size="18" font-weight="700">${escapeXml(keyLabel)}</text>` : ""}
</svg>`
}

async function fetchItunesArtwork(term) {
  if (!term) return null
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=8&country=DE`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6500)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "LyrumaSongbook/1.0 (+https://songbook.lyruma.app)" },
    })
    if (!response.ok) return null
    const data = await response.json()
    const results = Array.isArray(data?.results) ? data.results : []
    const needle = cleanSongTitle(term)
    const ranked = results
      .map((item) => {
        let score = matchScore(item.trackName || "", needle)
        score += Math.min(3, matchScore(item.collectionName || "", needle) / 4)
        if (item.artworkUrl100) score += 1
        return { item, score }
      })
      .filter((row) => row.score >= 6 && row.item.artworkUrl100)
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]?.item
    if (!best?.artworkUrl100) return null
    const artworkUrl = String(best.artworkUrl100).replace(/100x100bb/i, "600x600bb").replace(/100x100/i, "600x600")
    const artResponse = await fetch(artworkUrl, {
      signal: controller.signal,
      headers: { "user-agent": "LyrumaSongbook/1.0 (+https://songbook.lyruma.app)" },
    })
    if (!artResponse.ok) return null
    const mime = String(artResponse.headers.get("content-type") || "image/jpeg").split(";")[0].trim()
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(mime)) return null
    const buffer = Buffer.from(await artResponse.arrayBuffer())
    if (buffer.length < 800 || buffer.length > 4 * 1024 * 1024) return null
    return {
      buffer,
      mime: mime === "image/jpg" ? "image/jpeg" : mime,
      source: "itunes",
      meta: {
        trackName: best.trackName || "",
        artistName: best.artistName || "",
        collectionName: best.collectionName || "",
      },
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveSongCoverAsset({ title, artist = "", key = "" } = {}) {
  const term = searchTerm(title, artist)
  const itunes = await fetchItunesArtwork(term)
  if (itunes) return itunes
  const svg = buildProceduralCoverSvg({ title, artist, key })
  return {
    buffer: Buffer.from(svg, "utf8"),
    mime: "image/svg+xml",
    source: "generated",
    meta: { trackName: cleanSongTitle(title), artistName: artist || "", collectionName: "" },
  }
}

export async function persistSongCover(db, { songId, title, artist = "", key = "", root, force = false } = {}) {
  if (!songId || !root) return null
  const existing = db.prepare("SELECT cover_path, cover_source FROM songs WHERE id=?").get(songId)
  if (!force && existing?.cover_path) {
    return {
      hasCover: true,
      coverSource: existing.cover_source || "",
      coverUrl: `/api/songs/${songId}/cover`,
    }
  }

  await mkdir(`${root}/covers`, { recursive: true })
  const asset = await resolveSongCoverAsset({ title, artist, key })
  const ext = asset.mime === "image/png" ? "png" : asset.mime === "image/webp" ? "webp" : asset.mime === "image/svg+xml" ? "svg" : "jpg"
  const coverPath = `${root}/covers/${songId}.${ext}`
  await writeFile(coverPath, asset.buffer)
  db.prepare("UPDATE songs SET cover_path=?, cover_mime=?, cover_source=? WHERE id=?").run(
    coverPath,
    asset.mime,
    asset.source,
    songId,
  )
  return {
    hasCover: true,
    coverSource: asset.source,
    coverUrl: `/api/songs/${songId}/cover`,
    meta: asset.meta,
  }
}

export function queueResolveSongCover(db, options) {
  setTimeout(() => {
    persistSongCover(db, options).catch((error) => {
      console.error("song cover resolve failed:", error?.message || error)
    })
  }, 0)
}
