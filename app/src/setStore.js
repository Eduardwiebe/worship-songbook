import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'

export async function getSets() {
  const response = await apiFetch('/api/sets'); if(!response.ok) throw new Error(tStatic('err.setsLoad')); return response.json()
}

export async function createSet(values) {
  const response=await apiFetch('/api/sets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}); if(!response.ok) throw new Error(tStatic('err.setsCreate')); return response.json()
}

export async function saveSet(set) { const response=await apiFetch(`/api/sets/${set.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(set)});if(!response.ok)throw new Error(tStatic('err.setsSave'));return response.json() }

export async function deleteSet(id) { const response=await apiFetch(`/api/sets/${id}`,{method:'DELETE'});if(!response.ok)throw new Error(tStatic('err.setsDelete')) }
