import { apiFetch, apiUrl, authorizedObjectUrl, isNativeRuntime } from './apiConfig'
import { tStatic } from './i18n'
import { prepareScanPages } from './scanImagePrep'
import { cacheGetList, cachePutList, listCacheKey } from './offlineCache'
import { getSelectedBandId } from './nativeSession'

export async function getImportedSongs() {
  const bandId = getSelectedBandId?.() || ''
  const cacheKey = listCacheKey('songs', bandId)
  try {
    const response = await apiFetch('/api/songs')
    if (!response.ok) throw new Error(tStatic('err.songsLoad'))
    const data = await response.json()
    await cachePutList(cacheKey, data)
    return data
  } catch (error) {
    const cached = await cacheGetList(cacheKey)
    if (cached) return cached
    throw error
  }
}

export async function saveImportedSongs(items) {
  const form = new FormData()
  form.set('titles', JSON.stringify(items.map(({song}) => song.title)))
  items.forEach(({file}) => form.append('files', file, file.name))
  const response = await apiFetch('/api/songs', {method: 'POST', body: form})
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.error || tStatic('err.songsImport'))
  }
  return response.json()
}

export async function saveScannedSong(title, pages) {
  const prepared = await prepareScanPages(pages.map((page) => page.file))
  const form = new FormData()
  form.set('title', title)
  prepared.forEach((file, index) => form.append('pages', file, `scan-${index + 1}.jpg`))
  const response = await apiFetch('/api/scans', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || tStatic('err.songsScan'))
  return data
}

/** Preview PDF pages for scan-import page selection. */
export async function previewScanPdf(file) {
  const form = new FormData()
  form.append('pdf', file, file.name || 'import.pdf')
  const response = await apiFetch('/api/scans/preview', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || tStatic('err.songsScan'))
  return data
}

/**
 * Unified scan/import create:
 * - images: { pages: [{file}] }
 * - pdf: { pdfFile, selectedPages?: number[] }
 * - text: { text }
 */
export async function saveScanImport(title, { pages, pdfFile, selectedPages, text } = {}) {
  const form = new FormData()
  form.set('title', title)

  if (typeof text === 'string' && text.trim()) {
    form.set('text', text)
  } else if (pdfFile) {
    form.append('pdf', pdfFile, pdfFile.name || 'import.pdf')
    if (Array.isArray(selectedPages) && selectedPages.length) {
      form.set('selectedPages', JSON.stringify(selectedPages))
    }
  } else if (pages?.length) {
    const prepared = await prepareScanPages(pages.map((page) => page.file || page))
    prepared.forEach((file, index) => form.append('pages', file, `scan-${index + 1}.jpg`))
  } else {
    throw new Error(tStatic('err.songsScan'))
  }

  const response = await apiFetch('/api/scans', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (response.status === 409 && data.needsPageSelection) return data
  if (!response.ok) throw new Error(data.error || tStatic('err.songsScan'))
  return data
}

export async function openSongPdf(song) {
  if (!song.hasPdf) return
  if (isNativeRuntime()) {
    const url = await authorizedObjectUrl(`/api/songs/${song.id}/pdf`)
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  window.open(apiUrl(`/api/songs/${song.id}/pdf`), '_blank', 'noopener,noreferrer')
}

export function hasSongPdf(song) {
  return Boolean(song.hasPdf)
}

export async function deleteSong(id) {
  const response = await apiFetch(`/api/songs/${id}`, {method: 'DELETE'})
  if (!response.ok) throw new Error(tStatic('err.songsDelete'))
}

export async function updateSong(id, changes) {
  const response = await apiFetch(`/api/songs/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(changes)})
  if (!response.ok) throw new Error(tStatic('err.songsUpdate'))
  return response.json()
}

export async function analyzeSongChords(id) { const r=await apiFetch(`/api/songs/${id}/analyze-chords`,{method:'POST'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||tStatic('err.songsChords'));return data }
export async function getSongOriginalSnapshot(id) { const r=await apiFetch(`/api/songs/${id}/snapshot`);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||tStatic('err.songsChords'));return data }
export async function getSongVariants(id) { const r=await apiFetch(`/api/songs/${id}/variants`);const data=await r.json().catch(()=>[]);if(!r.ok)throw new Error(data.error||tStatic('err.songsVariant'));return data }
export async function saveSongVariant(id,values) { const payload={targetKey:values.targetKey,overlayText:values.overlayText};if(values.sheetColumns!=null)payload.sheetColumns=values.sheetColumns;if(values.sheetFontSize!=null)payload.sheetFontSize=values.sheetFontSize;const r=await apiFetch(`/api/songs/${id}/variants`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||tStatic('err.songsVariant'));return data }

export async function openSongChart(song,key) {
  const path = `/api/songs/${song.id}/chart?key=${encodeURIComponent(key)}`
  if (isNativeRuntime()) {
    const url = await authorizedObjectUrl(path)
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  window.open(apiUrl(path),'_blank','noopener,noreferrer')
}

export function songPdfUrl(song) {
  return song?.id ? apiUrl(`/api/songs/${song.id}/pdf`) : ''
}

export function songChartUrl(song, key, { lyricsOnly = false, bpm = '', tuning = '' } = {}) {
  if (!song?.id) return ''
  const params = new URLSearchParams({ key: String(key || '') })
  if (lyricsOnly) params.set('lyricsOnly', '1')
  if (bpm !== '' && bpm != null) params.set('bpm', String(bpm))
  if (tuning) params.set('tuning', String(tuning))
  return apiUrl(`/api/songs/${song.id}/chart?${params}`)
}


export function songCoverPath(song) {
  if (!song?.id) return ''
  if (song.coverUrl) return song.coverUrl
  if (song.hasCover) return `/api/songs/${song.id}/cover`
  return ''
}

/** Lazy one-shot cover resolve for songs without cached artwork. */
export async function resolveSongCover(id) {
  const response = await apiFetch(`/api/songs/${id}/resolve-cover`, { method: 'POST' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Cover konnte nicht geladen werden.')
  return data
}

/** Lazy one-shot YouTube rehearsal link resolve. */
export async function resolveSongYoutube(id) {
  const response = await apiFetch(`/api/songs/${id}/resolve-youtube`, { method: 'POST' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'YouTube-Link konnte nicht geladen werden.')
  return data
}
