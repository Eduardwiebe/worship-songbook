import { cacheGetList, cachePutList, listCacheKey } from './offlineCache'
import { getSelectedBandId } from './nativeSession'
import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'

export async function getSets() {
  const bandId = getSelectedBandId?.() || ''
  const cacheKey = listCacheKey('sets', bandId)
  try {
    const response = await apiFetch('/api/sets'); if(!response.ok) throw new Error(tStatic('err.setsLoad'));
    const data = await response.json()
    await cachePutList(cacheKey, data)
    return data
  } catch (error) {
    const cached = await cacheGetList(cacheKey)
    if (cached) return cached
    throw error
  }
}

export async function createSet(values) {
  const response=await apiFetch('/api/sets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}); if(!response.ok) throw new Error(tStatic('err.setsCreate')); return response.json()
}

export async function saveSet(set) { const response=await apiFetch(`/api/sets/${set.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(set)});if(!response.ok)throw new Error(tStatic('err.setsSave'));return response.json() }

export async function deleteSet(id) { const response=await apiFetch(`/api/sets/${id}`,{method:'DELETE'});if(!response.ok)throw new Error(tStatic('err.setsDelete')) }
