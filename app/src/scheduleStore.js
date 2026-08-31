import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'

export async function getAppointments(){const r=await apiFetch('/api/appointments');if(!r.ok)throw new Error(tStatic('err.appointmentsLoad'));return r.json()}
export async function createAppointment(values){const r=await apiFetch('/api/appointments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});if(!r.ok)throw new Error(tStatic('err.appointmentsSave'));return r.json()}
export async function deleteAppointment(id){const r=await apiFetch(`/api/appointments/${id}`,{method:'DELETE'});if(!r.ok)throw new Error(tStatic('err.appointmentsDelete'))}
