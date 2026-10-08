import { apiFetch } from './apiConfig'
import { cacheGetList, cachePutList, cacheGetMedia, cachePutMedia, cacheContextToken, isNetworkError } from './offlineCache'

const key = (id) => `annotations:${id}`
export const draftKey = (id) => `annotation-draft:${id}`
export async function getSongAnnotations(id) {
  const token=cacheContextToken()
  try {
    const response=await apiFetch(`/api/songs/${id}/annotations`)
    const data=await response.json()
    if(!response.ok) throw Object.assign(new Error(data.error||'Notizen konnten nicht geladen werden.'),{status:response.status})
    if(!data.sourceHash || !data.pages) return null
    if(token!==cacheContextToken()) throw new Error('Das Konto oder die Band hat sich geändert.')
    await cachePutList(key(id),data)
    return data
  } catch(error) {
    if(!isNetworkError(error)) throw error
    if(token!==cacheContextToken()) throw error
    return await cacheGetList(key(id)) || null
  }
}
export async function saveSongAnnotations(id,document) {
  const token=cacheContextToken()
  const response=await apiFetch(`/api/songs/${id}/annotations`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(document)})
  const data=await response.json()
  if(!response.ok)throw Object.assign(new Error(data.error||'Notizen nicht gespeichert.'),{status:response.status})
  if(token!==cacheContextToken())throw new Error('Das Konto oder die Band hat sich geändert.')
  await cachePutList(key(id),data)
  await cachePutList(draftKey(id),null)
  window.dispatchEvent(new CustomEvent('songbook-annotations-saved',{detail:id}))
  return data
}
async function request(path, options) {
  const response=await apiFetch(path,options)
  const data=await response.json()
  if(!response.ok)throw Object.assign(new Error(data.error||'Auftrittsfassung nicht verfügbar.'),{status:response.status})
  return data
}
export const performancePath=(setId,id='')=>`/api/sets/${setId}/performances${id?`/${id}`:''}`
export const performanceMediaKey=(id,songId)=>`performance-pages:${id}:${songId}`
export async function getPerformances(setId) {
  const token=cacheContextToken()
  try {
    const data=await request(performancePath(setId))
    if(!Array.isArray(data))return []
    const valid=data.filter(p=>p?.set?.id===setId&&Array.isArray(p.songs)&&Number.isInteger(p.version))
    if(token!==cacheContextToken())throw new Error('Die Band hat sich geändert.')
    await cachePutList(`performances:${setId}`,valid)
    return valid
  } catch(error) {
    if(!isNetworkError(error) || token!==cacheContextToken())throw error
    return await cacheGetList(`performances:${setId}`)||[]
  }
}
export const publishPerformance=(set)=>request(performancePath(set.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:set.revision})})
export async function loadPerformancePages(publication,song) {
  const token=cacheContextToken()
  const mediaKey=performanceMediaKey(publication.id,song.id)
  const cached=await cacheGetMedia(mediaKey)
  if(cached?.meta?.sourceHash===song.sourceHash && cached.pages?.length===song.pageCount && cached.pages.every(p=>p.buffer?.byteLength)) return {pages:cached.pages.map(p=>({mime:p.mime,dataUrl:URL.createObjectURL(new Blob([p.buffer],{type:p.mime}))})),cached:true}
  const data=await request(song.pagesUrl)
  if(token!==cacheContextToken())throw new Error('Die Band hat sich geändert.')
  if(data.sourceHash!==song.sourceHash || data.pages?.length!==song.pageCount)throw new Error('Das Original gehört nicht zu dieser Auftrittsfassung.')
  return {...data,cached:false}
}
export async function performanceIsPrepared(publication) {
  const token=cacheContextToken()
  const metadata=await cacheGetList(`prepared-performance:${publication.id}`)
  if(metadata?.id!==publication.id)return false
  for(const song of publication.songs) {
    const row=await cacheGetMedia(performanceMediaKey(publication.id,song.id))
    if(row?.meta?.sourceHash!==song.sourceHash || row.pages?.length!==song.pageCount || !row.pages.every(p=>p.buffer?.byteLength))return false
  }
  return token===cacheContextToken()
}
export async function preparePerformance(publication) {
  const token=cacheContextToken()
  for(const song of publication.songs) {
    const data=await request(song.pagesUrl)
    if(token!==cacheContextToken())throw new Error('Die Band hat sich geändert.')
    if(data.sourceHash!==song.sourceHash || data.pages?.length!==song.pageCount)throw new Error('Die Auftrittsfassung ist unvollständig.')
    const pages=await Promise.all(data.pages.map(async p=>({mime:p.mime,buffer:await (await fetch(p.dataUrl)).arrayBuffer()})))
    if(pages.some(p=>!p.buffer.byteLength)||token!==cacheContextToken())throw new Error('Original nicht vollständig geladen.')
    const saved=await cachePutMedia(performanceMediaKey(publication.id,song.id),{pages,mime:'application/x-songbook-pages',meta:{kind:'pages',priority:0,sourceHash:song.sourceHash,publicationId:publication.id}})
    if(!saved)throw new Error('Nicht genügend Gerätespeicher für diese Auftrittsfassung.')
  }
  if(token!==cacheContextToken())throw new Error('Die Band hat sich geändert.')
  await cachePutList(`prepared-performance:${publication.id}`,publication)
  if(!await performanceIsPrepared(publication))throw new Error('Die Offline-Speicherung konnte nicht bestätigt werden.')
  let deviceId
  try {deviceId=localStorage.getItem('songbook-performance-device');if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('songbook-performance-device',deviceId)}}catch{deviceId=crypto.randomUUID()}
  try {
    const receipt=await request(`${performancePath(publication.set.id,publication.id)}/receipts`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId})})
    return {prepared:true,reportedAt:receipt.preparedAt}
  }catch(error){if(!isNetworkError(error))throw error;return{prepared:true,reportedAt:null}}
}
export const getPerformanceReceipts=(publication)=>request(`${performancePath(publication.set.id,publication.id)}/receipts`)
