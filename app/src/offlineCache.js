/**
 * Offline cache for Songbook Band (web PWA + native).
 *
 * App shell (HTML/JS/CSS/icons) lives in the Workbox Cache Storage precache
 * (`sw.js`, versioned per deploy, `navigateFallback` → index.html). That is
 * what makes Home / Songs / Sets / Team open from an iPad home-screen icon
 * after one online visit.
 *
 * Song sheets, thumbnails, and API JSON live in IndexedDB, not Cache Storage.
 * iOS Safari gives Cache Storage a small, easily evicted quota; large JPEG
 * page scans would push the shell out. IndexedDB holds the media with a soft
 * cap. Set songs are cached first. If space runs out we drop PDFs and old
 * non-set thumbnails before we drop page images from the active set.
 *
 * Auth: the last successful `/api/auth/me` (or native `/me`) snapshot is stored
 * here. A failed fetch (Airplane Mode, church Wi-Fi with no route) reuses that
 * snapshot so already-known songs and sets stay readable. An HTTP 401 while
 * the server is reachable does not — re-login needs the network. The web
 * session cookie itself is 30 days (`Max-Age=2592000` in auth.mjs). Offline
 * reading does not refresh that cookie.
 */

const DB_NAME = 'songbook-offline-v1'
const DB_VERSION = 1
const LISTS = 'lists'
const MEDIA = 'media'
const META = 'meta'

/** Soft cap for song media. Leaves room for the precached shell on iOS. */
export const MEDIA_SOFT_CAP_BYTES = 96 * 1024 * 1024
const FRESH_MS = 12 * 60 * 60 * 1000

let dbPromise = null
let transportOffline = false
let mediaChain = Promise.resolve()

export function isProbablyOffline() {
  if (transportOffline) return true
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

export function markTransportOffline() {
  transportOffline = true
  dispatch('songbook-offline')
}

export function markTransportOnline() {
  const was = transportOffline
  transportOffline = false
  if (was) dispatch('songbook-online')
}

/** Browser came back online — try the network again on the next request. */
export function noteBrowserOnline() {
  transportOffline = false
  dispatch('songbook-online')
}

function dispatch(name, detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function isNetworkError(error) {
  if (!error) return false
  if (error.network === true) return true
  const name = String(error.name || '')
  if (name === 'TypeError' || name === 'NetworkError') return true
  const msg = String(error.message || '').toLowerCase()
  return (
    msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('network request failed')
    || msg.includes('load failed')
    || msg.includes('the internet connection appears to be offline')
    || msg.includes('internet disconnected')
  )
}

function isQuotaError(error) {
  const name = String(error?.name || '')
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(error?.message || ''))
}

function openDb() {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.reject(new Error('IndexedDB unavailable'))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS)
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
  return dbPromise
}

function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function withStore(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    let settled = false
    const done = (err, value) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(value)
    }
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let value
    tx.oncomplete = () => done(null, value)
    tx.onerror = () => done(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => done(tx.error || new Error('IndexedDB transaction aborted'))
    try {
      const result = fn(store)
      if (result && typeof result.then === 'function') {
        result.then((next) => { value = next }).catch((err) => {
          try { tx.abort() } catch { /* already finished */ }
          done(err)
        })
      } else {
        value = result
      }
    } catch (err) {
      try { tx.abort() } catch { /* ignore */ }
      done(err)
    }
  }))
}

function enqueueMedia(fn) {
  const run = mediaChain.then(fn, fn)
  mediaChain = run.then(() => {}, () => {})
  return run
}

export async function cachePutList(key, value) {
  try {
    await withStore(LISTS, 'readwrite', (store) => idbReq(store.put({
      value,
      savedAt: Date.now(),
    }, key)))
  } catch (error) {
    console.warn('[offlineCache] putList failed', key, error)
  }
}

export async function cacheGetList(key) {
  try {
    const row = await withStore(LISTS, 'readonly', (store) => idbReq(store.get(key)))
    return row?.value
  } catch {
    return undefined
  }
}

export async function cachePutMeta(key, value) {
  try {
    await withStore(META, 'readwrite', (store) => idbReq(store.put({ value, savedAt: Date.now() }, key)))
  } catch (error) {
    console.warn('[offlineCache] putMeta failed', key, error)
  }
}

export async function cacheGetMeta(key) {
  try {
    const row = await withStore(META, 'readonly', (store) => idbReq(store.get(key)))
    return row?.value
  } catch {
    return undefined
  }
}

async function readMediaIndex() {
  return (await cacheGetMeta('mediaIndex')) || {}
}

async function writeMediaIndex(index) {
  await cachePutMeta('mediaIndex', index)
}

function bytesOf(record) {
  if (Array.isArray(record?.pages)) {
    return record.pages.reduce((sum, page) => sum + (page?.buffer?.byteLength || 0), 0)
  }
  return record?.buffer?.byteLength || 0
}

function evictRank(row) {
  if (row?.kind === 'pdf') return 0
  if (row?.kind === 'thumb' || row?.kind === 'chart') return 1
  if (row?.kind === 'pages' && (row.priority || 0) > 0) return 2
  return 3
}

async function deleteMediaKey(key) {
  await withStore(MEDIA, 'readwrite', (store) => idbReq(store.delete(key)))
}

async function evictUntil(maxBytes, { spareKey, aggressive = false } = {}) {
  const index = await readMediaIndex()
  let total = Object.values(index).reduce((sum, row) => sum + (row?.bytes || 0), 0)
  if (total <= maxBytes) return
  const entries = Object.entries(index).filter(([key]) => key !== spareKey)
  entries.sort((a, b) => evictRank(a[1]) - evictRank(b[1]) || (a[1]?.savedAt || 0) - (b[1]?.savedAt || 0))
  for (const [key, row] of entries) {
    if (total <= maxBytes) break
    if (!aggressive && evictRank(row) >= 3) break
    await deleteMediaKey(key)
    total -= row?.bytes || 0
    delete index[key]
  }
  await writeMediaIndex(index)
}

export async function cachePutMedia(key, { mime, buffer, pages, meta } = {}) {
  if (!key) return false
  const recordPages = Array.isArray(pages) ? pages.filter((page) => page?.buffer) : null
  if (!buffer && !recordPages?.length) return false
  const bytes = recordPages ? bytesOf({ pages: recordPages }) : (buffer.byteLength || 0)
  const kind = meta?.kind || (recordPages ? 'pages' : 'blob')
  const priority = Number.isFinite(meta?.priority) ? meta.priority : (kind === 'pages' ? 1 : 2)
  const record = {
    mime: mime || 'application/octet-stream',
    buffer: buffer || null,
    pages: recordPages,
    meta: { ...(meta || {}), kind, priority, bytes },
    savedAt: Date.now(),
  }
  const write = () => withStore(MEDIA, 'readwrite', (store) => idbReq(store.put(record, key)))
  return enqueueMedia(async () => {
    try {
      await evictUntil(Math.max(0, MEDIA_SOFT_CAP_BYTES - bytes), { spareKey: key })
      await write()
    } catch (error) {
      if (!isQuotaError(error)) {
        console.warn('[offlineCache] putMedia failed', key, error)
        return false
      }
      try {
        await evictUntil(Math.floor(MEDIA_SOFT_CAP_BYTES / 2), { spareKey: key, aggressive: true })
        await write()
      } catch (retryError) {
        console.warn('[offlineCache] putMedia quota', key, retryError)
        return false
      }
    }
    const index = await readMediaIndex()
    index[key] = { bytes, priority, kind, savedAt: record.savedAt }
    await writeMediaIndex(index)
    return true
  })
}

export async function cacheGetMedia(key) {
  try {
    return await withStore(MEDIA, 'readonly', (store) => idbReq(store.get(key)))
  } catch {
    return undefined
  }
}

export async function cacheGetMediaObjectUrl(key) {
  const row = await cacheGetMedia(key)
  if (!row?.buffer) return ''
  const blob = new Blob([row.buffer], { type: row.mime || 'application/octet-stream' })
  return URL.createObjectURL(blob)
}

export function chartCacheKey(songId, key) {
  return `chart:${songId}:${key || ''}`
}

export function pdfCacheKey(songId) {
  return `pdf:${songId}`
}

export function pagesCacheKey(songId) {
  return `pages:${songId}`
}

export function coverCacheKey(songId) {
  return `cover:${songId}`
}

export function listCacheKey(kind, bandId = '') {
  return `${kind}:${bandId || 'personal'}`
}

export function mediaKeyForApiPath(path) {
  const clean = String(path || '').split('#')[0]
  let match
  if ((match = clean.match(/\/api\/songs\/([^/?]+)\/pages/))) return pagesCacheKey(decodeURIComponent(match[1]))
  if ((match = clean.match(/\/api\/songs\/([^/?]+)\/pdf/))) return pdfCacheKey(decodeURIComponent(match[1]))
  if ((match = clean.match(/\/api\/songs\/([^/?]+)\/cover/))) return coverCacheKey(decodeURIComponent(match[1]))
  if ((match = clean.match(/\/api\/songs\/([^/?]+)\/chart\?[^#]*key=([^&]+)/))) {
    return chartCacheKey(decodeURIComponent(match[1]), decodeURIComponent(match[2]))
  }
  if ((match = clean.match(/\/api\/team\/([^/?]+)\/photo/))) return `team-photo:${decodeURIComponent(match[1])}`
  if ((match = clean.match(/\/api\/bands\/([^/?]+)\/logo/))) return `band-logo:${decodeURIComponent(match[1])}`
  if (clean.includes('/api/auth/photo')) return 'profile-photo'
  return ''
}

export function songRevision(song) {
  const size = Number(song?.fileSize || 0)
  const name = String(song?.fileName || '')
  if (!size && !name) return ''
  return `${size}:${name}`
}

/** Decode a data URL (base64 or percent-encoded) into bytes for IndexedDB. */
export function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || '')
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const header = value.slice(0, comma)
  const payload = value.slice(comma + 1)
  const mime = /data:([^;,]+)/i.exec(header)?.[1] || 'application/octet-stream'
  try {
    if (/;base64/i.test(header)) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return { mime, buffer: bytes.buffer }
    }
    const text = decodeURIComponent(payload)
    return { mime, buffer: new TextEncoder().encode(text).buffer }
  } catch {
    return null
  }
}

/**
 * Set songs first (upcoming dates, then past), then the rest of the library.
 * `hasPdf: false` songs are skipped — there is no original sheet to cache.
 */
export function orderSongsForOffline(songs, sets = []) {
  const rank = new Map()
  const today = new Date().toISOString().slice(0, 10)
  const dated = (sets || []).filter((set) => set?.songIds?.length)
  const upcoming = dated.filter((set) => !set.date || String(set.date) >= today)
  const past = dated.filter((set) => set.date && String(set.date) < today)
  upcoming.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))
  past.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  let order = 0
  for (const set of [...upcoming, ...past]) {
    for (const id of set.songIds) {
      if (!rank.has(id)) rank.set(id, order++)
    }
  }
  return [...(songs || [])]
    .filter((song) => song?.id && song.hasPdf !== false)
    .sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : 100000
      const rb = rank.has(b.id) ? rank.get(b.id) : 100000
      if (ra !== rb) return ra - rb
      return String(a.title || '').localeCompare(String(b.title || ''), 'de')
    })
}

export async function cachePagesPayload(songId, pages, meta = {}) {
  if (!songId) return false
  // An incomplete sheet must never replace a complete cached original.
  if (!Array.isArray(pages) || !pages.length) return false
  const decoded = []
  for (const page of pages || []) {
    if (page?.buffer) {
      decoded.push({ mime: page.mime || 'image/jpeg', buffer: page.buffer })
      continue
    }
    if (page?.dataUrl) {
      const part = decodeDataUrl(page.dataUrl)
      if (part?.buffer?.byteLength) decoded.push(part)
    }
  }
  if (decoded.length !== pages.length || decoded.some((page) => !page.buffer?.byteLength)) return false
  return cachePutMedia(pagesCacheKey(songId), {
    mime: 'application/x-songbook-pages',
    pages: decoded,
    meta: {
      kind: 'pages',
      priority: meta.priority ?? 1,
      revision: meta.revision || '',
      title: meta.title || '',
    },
  })
}

export async function loadCachedPageUrls(songId) {
  const row = await cacheGetMedia(pagesCacheKey(songId))
  if (!row?.pages?.length) return null
  return row.pages.map((page) => URL.createObjectURL(new Blob(
    [page.buffer],
    { type: page.mime || 'image/jpeg' },
  )))
}

async function pagesAreFresh(song) {
  const row = await cacheGetMedia(pagesCacheKey(song.id))
  if (!row?.pages?.length) return false
  const revision = songRevision(song)
  if (revision && row.meta?.revision === revision) return true
  if (!revision && row.savedAt && Date.now() - row.savedAt < FRESH_MS) return true
  return false
}

function emitPrep(detail) {
  dispatch('songbook-offline-prep', detail)
}

async function cacheBinaryFromResponse(key, response, meta) {
  if (!response?.ok) return false
  const mime = response.headers?.get?.('content-type') || meta.mime || 'application/octet-stream'
  if (mime.includes('text/html') || mime.includes('application/json')) return false
  const buffer = await response.arrayBuffer()
  if (!buffer?.byteLength) return false
  return cachePutMedia(key, { mime: mime.split(';')[0], buffer, meta })
}

/**
 * Cache original page images (what the in-app viewer shows), covers, and
 * PDFs for set songs. Sequential on purpose — iOS tabs die under parallel
 * multi-megabyte JSON parses.
 */
let prefetchChain = Promise.resolve()

async function prefetchSongOriginalsNow(songs, { apiFetch, sets = [], team = [], onProgress } = {}) {
  if (isProbablyOffline() || typeof apiFetch !== 'function') {
    return { cached: 0, failed: 0, total: 0, offline: true }
  }
  const ordered = orderSongsForOffline(songs, sets)
  const priorityIds = new Set()
  for (const set of sets || []) {
    for (const id of set?.songIds || []) priorityIds.add(id)
  }
  const total = ordered.length
  let cached = 0
  let failed = 0
  let done = 0
  const report = (status) => {
    const detail = { status, done, total, cached, failed }
    onProgress?.(detail)
    emitPrep(detail)
  }
  report('running')
  for (const song of ordered) {
    if (isProbablyOffline()) break
    const priority = priorityIds.has(song.id) ? 0 : 1
    try {
      if (await pagesAreFresh(song)) {
        cached += 1
      } else {
        const response = await apiFetch(`/api/songs/${song.id}/pages`)
        if (!response.ok) {
          failed += 1
        } else {
          const data = await response.json().catch(() => ({}))
          const stored = await cachePagesPayload(song.id, data.pages, {
            priority,
            revision: songRevision(song),
            title: song.title || '',
          })
          if (stored) cached += 1
          else failed += 1
        }
      }
      if (song.hasCover || song.coverUrl) {
        const coverKey = coverCacheKey(song.id)
        const existingCover = await cacheGetMedia(coverKey)
        const coverFresh = existingCover?.buffer && existingCover.savedAt && Date.now() - existingCover.savedAt < 7 * 24 * 60 * 60 * 1000
        if (!coverFresh && !isProbablyOffline()) {
          const path = (song.coverUrl && String(song.coverUrl).startsWith('/'))
          ? song.coverUrl
          : `/api/songs/${song.id}/cover`
          const response = await apiFetch(path)
          await cacheBinaryFromResponse(coverKey, response, {
            kind: 'thumb',
            priority: 2,
            mime: 'image/jpeg',
            title: song.title || '',
          })
        }
      }
      if (priority === 0 && !isProbablyOffline()) {
        const pdfKey = pdfCacheKey(song.id)
        const existingPdf = await cacheGetMedia(pdfKey)
        const revision = songRevision(song)
        const pdfFresh = existingPdf?.buffer && (
          (revision && existingPdf.meta?.revision === revision)
          || (!revision && existingPdf.savedAt && Date.now() - existingPdf.savedAt < FRESH_MS)
        )
        if (!pdfFresh) {
          const response = await apiFetch(`/api/songs/${song.id}/pdf`)
          await cacheBinaryFromResponse(pdfKey, response, {
            kind: 'pdf',
            priority: 0,
            revision,
            mime: 'application/pdf',
            title: song.title || '',
          })
        }
      }
    } catch (error) {
      failed += 1
      console.warn('[offlineCache] prefetch failed', song?.id, error)
      if (isNetworkError(error) || isProbablyOffline()) break
    }
    done += 1
    report('running')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (Array.isArray(team) && team.length && !isProbablyOffline()) {
    for (const member of team) {
      if (!member?.id || !member.hasPhoto) continue
      const key = `team-photo:${member.id}`
      const existing = await cacheGetMedia(key)
      if (existing?.buffer) continue
      try {
        const response = await apiFetch(`/api/team/${member.id}/photo`)
        await cacheBinaryFromResponse(key, response, { kind: 'thumb', priority: 2, mime: 'image/jpeg' })
      } catch {
        /* team photos are optional */
      }
    }
  }
  const status = !failed && done >= total ? 'ready' : 'partial'
  report(status)
  return { cached, failed, total, offline: false }
}

export function prefetchSongOriginals(songs, options = {}) {
  const job = prefetchChain.then(() => prefetchSongOriginalsNow(songs, options), () => prefetchSongOriginalsNow(songs, options))
  prefetchChain = job.then(() => {}, () => {})
  return job
}

/**
 * Fetch text/HTML while online and stash bytes for offline Set play.
 */
export async function cacheFetchTextMedia(cacheKey, fetchUrl, { mime = 'text/html; charset=utf-8', fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch
  const response = await doFetch(fetchUrl)
  if (!response.ok) throw new Error(`cache fetch failed ${response.status}`)
  const text = await response.text()
  const buffer = new TextEncoder().encode(text).buffer
  await cachePutMedia(cacheKey, { mime, buffer, meta: { kind: 'chart', priority: 1 } })
  return text
}

/**
 * Cache originals for the songs in one set (pages first, PDF for the set).
 */
export async function prefetchSetCharts(set, songs, { apiFetch, apiUrl } = {}) {
  if (isProbablyOffline() || !set?.songIds?.length) return { cached: 0, failed: 0, total: 0 }
  const fetchImpl = apiFetch || (apiUrl
    ? (path) => fetch(apiUrl(path))
    : (path) => fetch(path))
  const subset = (songs || []).filter((song) => set.songIds.includes(song.id))
  return prefetchSongOriginals(subset, { apiFetch: fetchImpl, sets: [set] })
}

export async function clearOfflineCache() {
  try {
    const db = await openDb()
    await Promise.all([LISTS, MEDIA, META].map((name) => withStore(name, 'readwrite', (store) => idbReq(store.clear()))))
    db.close()
    dbPromise = null
  } catch (error) {
    console.warn('[offlineCache] clear failed', error)
  }
}
