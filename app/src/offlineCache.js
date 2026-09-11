/**
 * Offline-first cache for Songbook Band (native + web).
 * IndexedDB stores lists (songs/sets/team/…) and media (chart HTML, PDFs).
 * Online: write-through after successful API reads.
 * Offline: serve last successful snapshot so Set play / library still work.
 */

const DB_NAME = 'songbook-offline-v1'
const DB_VERSION = 1
const LISTS = 'lists'
const MEDIA = 'media'
const META = 'meta'

let dbPromise = null

export function isProbablyOffline() {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
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

async function withStore(storeName, mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    Promise.resolve(fn(store))
      .then((value) => {
        tx.oncomplete = () => resolve(value)
        tx.onerror = () => reject(tx.error)
      })
      .catch(reject)
  })
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

export async function cachePutMedia(key, { mime, buffer, meta } = {}) {
  if (!key || !buffer) return
  try {
    await withStore(MEDIA, 'readwrite', (store) => idbReq(store.put({
      mime: mime || 'application/octet-stream',
      buffer,
      meta: meta || {},
      savedAt: Date.now(),
    }, key)))
  } catch (error) {
    console.warn('[offlineCache] putMedia failed', key, error)
  }
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

export function listCacheKey(kind, bandId = '') {
  return `${kind}:${bandId || 'personal'}`
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
  await cachePutMedia(cacheKey, { mime, buffer })
  return text
}

/**
 * Best-effort prefetch of edited charts for a set (online only).
 */
export async function prefetchSetCharts(set, songs, { apiFetch, apiUrl } = {}) {
  if (isProbablyOffline() || !set?.songIds?.length) return { cached: 0 }
  let cached = 0
  for (const songId of set.songIds) {
    const key = set.songKeys?.[songId]
    if (!key) continue
    const song = (songs || []).find((item) => item.id === songId)
    if (!song) continue
    const cacheKey = chartCacheKey(songId, key)
    try {
      const existing = await cacheGetMedia(cacheKey)
      // Refresh if older than 12h while online
      if (existing?.savedAt && Date.now() - existing.savedAt < 12 * 60 * 60 * 1000) {
        cached += 1
        continue
      }
      const path = `/api/songs/${songId}/chart?key=${encodeURIComponent(key)}`
      const response = apiFetch
        ? await apiFetch(path)
        : await fetch(apiUrl ? apiUrl(path) : path)
      if (!response.ok) continue
      const text = await response.text()
      await cachePutMedia(cacheKey, {
        mime: 'text/html; charset=utf-8',
        buffer: new TextEncoder().encode(text).buffer,
        meta: { title: song.title, key },
      })
      cached += 1
    } catch (error) {
      console.warn('[offlineCache] chart prefetch failed', songId, key, error)
    }
  }
  return { cached }
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
