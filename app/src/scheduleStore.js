import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'
import { cacheGetList, cachePutList, listCacheKey, isNetworkError } from './offlineCache'

export async function getAppointments(){
  const cacheKey = listCacheKey('appointments')
  try {
    const r=await apiFetch('/api/appointments');if(!r.ok)throw new Error(tStatic('err.appointmentsLoad'));
    const data = await r.json()
    await cachePutList(cacheKey, data)
    return data
  } catch (error) {
    if (!isNetworkError(error)) throw error
    const cached = await cacheGetList(cacheKey)
    if (cached) return cached
    throw error
  }
}
export async function createAppointment(values){const r=await apiFetch('/api/appointments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});if(!r.ok)throw new Error(tStatic('err.appointmentsSave'));return r.json()}
export async function deleteAppointment(id){const r=await apiFetch(`/api/appointments/${id}`,{method:'DELETE'});if(!r.ok)throw new Error(tStatic('err.appointmentsDelete'))}
