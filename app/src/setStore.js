import { apiFetch } from './apiConfig'

export async function getSets() {
  const response = await apiFetch('/api/sets'); if(!response.ok) throw new Error('Sets konnten nicht geladen werden.'); return response.json()
}

export async function createSet(values) {
  const response=await apiFetch('/api/sets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)}); if(!response.ok) throw new Error('Set konnte nicht erstellt werden.'); return response.json()
}

export async function saveSet(set) { const response=await apiFetch(`/api/sets/${set.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(set)});if(!response.ok)throw new Error('Set konnte nicht gespeichert werden.');return response.json() }

export async function deleteSet(id) { const response=await apiFetch(`/api/sets/${id}`,{method:'DELETE'});if(!response.ok)throw new Error('Set konnte nicht gelöscht werden.') }
