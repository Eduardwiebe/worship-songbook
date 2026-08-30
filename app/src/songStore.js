import { apiFetch, apiUrl } from './apiConfig'

export async function getImportedSongs() {
  const response = await apiFetch('/api/songs')
  if (!response.ok) throw new Error('Songbibliothek konnte nicht geladen werden.')
  return response.json()
}

export async function saveImportedSongs(items) {
  const form = new FormData()
  form.set('titles', JSON.stringify(items.map(({song}) => song.title)))
  items.forEach(({file}) => form.append('files', file, file.name))
  const response = await apiFetch('/api/songs', {method: 'POST', body: form})
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new Error(result.error || 'Server-Import fehlgeschlagen.')
  }
  return response.json()
}

export async function saveScannedSong(title, pages) {
  const form=new FormData();form.set('title',title);pages.forEach((page,index)=>form.append('pages',page.file,`scan-${index+1}.jpg`))
  const response=await apiFetch('/api/scans',{method:'POST',body:form});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Der Scan konnte nicht verarbeitet werden.');return data
}

export function openSongPdf(song) {
  if (!song.hasPdf) return
  window.open(apiUrl(`/api/songs/${song.id}/pdf`), '_blank', 'noopener,noreferrer')
}

export function hasSongPdf(song) {
  return Boolean(song.hasPdf)
}

export async function deleteSong(id) {
  const response = await apiFetch(`/api/songs/${id}`, {method: 'DELETE'})
  if (!response.ok) throw new Error('Song konnte nicht gelöscht werden.')
}

export async function updateSong(id, changes) {
  const response = await apiFetch(`/api/songs/${id}`, {method: 'PATCH', headers: {'content-type': 'application/json'}, body: JSON.stringify(changes)})
  if (!response.ok) throw new Error('Song konnte nicht geändert werden.')
  return response.json()
}

export async function analyzeSongChords(id) { const r=await apiFetch(`/api/songs/${id}/analyze-chords`,{method:'POST'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Akkorde konnten nicht ausgelesen werden.');return data }
export async function saveSongVariant(id,values) { const r=await apiFetch(`/api/songs/${id}/variants`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Fassung konnte nicht gespeichert werden.');return data }
export function openSongChart(song,key) { window.open(apiUrl(`/api/songs/${song.id}/chart?key=${encodeURIComponent(key)}`),'_blank','noopener,noreferrer') }

export function songPdfUrl(song) {
  return song?.id ? apiUrl(`/api/songs/${song.id}/pdf`) : ''
}

export function songChartUrl(song,key) {
  return song?.id ? apiUrl(`/api/songs/${song.id}/chart?key=${encodeURIComponent(key)}`) : ''
}
