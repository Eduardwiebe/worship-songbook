import { apiFetch } from './apiConfig'

export async function getAppointments(){const r=await apiFetch('/api/appointments');if(!r.ok)throw new Error('Termine konnten nicht geladen werden.');return r.json()}
export async function createAppointment(values){const r=await apiFetch('/api/appointments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});if(!r.ok)throw new Error('Termin konnte nicht gespeichert werden.');return r.json()}
export async function deleteAppointment(id){const r=await apiFetch(`/api/appointments/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Termin konnte nicht gelöscht werden.')}
