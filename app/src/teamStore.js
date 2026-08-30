import { apiFetch, apiUrl } from './apiConfig'

export async function getTeam() { const r=await apiFetch('/api/team');if(!r.ok)throw new Error('Team konnte nicht geladen werden.');return r.json() }
export async function saveMember(values) { const form=new FormData();form.set('name',values.name);form.set('roles',JSON.stringify(values.roles));['isLeader','isOrganizer','isDesigner','isTechnician'].forEach((key)=>form.set(key,String(values[key])));if(values.photo)form.set('photo',values.photo);const r=await apiFetch('/api/team',{method:'POST',body:form});if(!r.ok)throw new Error('Teammitglied konnte nicht gespeichert werden.');return r.json() }
export async function deleteMember(id) { const r=await apiFetch(`/api/team/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Teammitglied konnte nicht gelöscht werden.') }
export function memberPhoto(member) { return member.hasPhoto ? apiUrl(`/api/team/${member.id}/photo`) : '' }
