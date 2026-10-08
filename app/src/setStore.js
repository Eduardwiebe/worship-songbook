import { cacheGetList, cachePutList, listCacheKey, isNetworkError } from './offlineCache'
import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'

export async function getSets() {
  const cacheKey = listCacheKey('sets')
  try {
    const response = await apiFetch('/api/sets'); if(!response.ok) throw new Error(tStatic('err.setsLoad'));
    const data = await response.json()
    await cachePutList(cacheKey, data)
    return data
  } catch (error) {
    if (!isNetworkError(error)) throw error
    const cached = await cacheGetList(cacheKey)
    if (cached) return cached
    throw error
  }
}

export async function createSet(values) {
  const response=await apiFetch('/api/sets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}); if(!response.ok) throw new Error(tStatic('err.setsCreate')); return response.json()
}

export async function saveSet(set) {
  const response=await apiFetch(`/api/sets/${set.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(set)})
  if(!response.ok) { const error = new Error(tStatic('err.setsSave')); error.status = response.status; throw error }
  const saved = await response.json()
  const key = listCacheKey('sets')
  const cached = await cacheGetList(key)
  if (cached) await cachePutList(key, cached.map((item) => item.id === saved.id ? saved : item))
  return saved
}

export async function deleteSet(id) { const response=await apiFetch(`/api/sets/${id}`,{method:'DELETE'});if(!response.ok)throw new Error(tStatic('err.setsDelete')) }
