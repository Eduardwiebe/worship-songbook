import { apiFetch, apiUrl, isNativeRuntime } from './apiConfig'
import { persistSelectedBand } from './nativeSession'
import { tStatic } from './i18n'

async function request(path,options={}){
  const response=await apiFetch(path,options)
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||tStatic('err.bandRequest'))
  return data
}

const jsonOptions=(method,values)=>({
  method,
  headers:{'content-type':'application/json'},
  body:JSON.stringify(values)
})

export const getBands=()=>request('/api/bands')

export const createBand=values=>
  request('/api/bands',jsonOptions('POST',values))

export const updateBand=(id,values)=>
  request(`/api/bands/${id}`,jsonOptions('PATCH',values))

export const deleteBand=id=>
  request(`/api/bands/${id}`,{method:'DELETE'})

export const selectBand=async id=>{
  const result=await request(`/api/bands/${id}/select`,{method:'POST'})
  if(isNativeRuntime()) await persistSelectedBand(id)
  return result
}

export const selectPersonal=async ()=>{
  const result=await request('/api/bands/personal/select',{method:'POST'})
  if(isNativeRuntime()) await persistSelectedBand('')
  return result
}

export const getBandMembers=id=>
  request(`/api/bands/${id}/members`)

export async function uploadBandLogo(id,file){
  const form=new FormData()
  form.set('logo',file)
  return request(`/api/bands/${id}/logo`,{
    method:'POST',
    body:form
  })
}

export const deleteBandLogo=id=>
  request(`/api/bands/${id}/logo`,{method:'DELETE'})

export const bandLogoUrl=band=>
  band?.hasLogo ? apiUrl(`/api/bands/${band.id}/logo`) : ''

export const searchBands=query=>
  request(`/api/bands/search?q=${encodeURIComponent(query)}`)

export const requestBandJoin=id=>
  request(`/api/bands/${id}/join-request`,{
    method:'POST'
  })

export const getMyJoinRequests=()=>
  request('/api/bands/join-requests/mine')

export const getBandJoinRequests=()=>
  request('/api/bands/join-requests')

export const approveBandJoinRequest=id=>
  request(`/api/bands/join-requests/${id}/approve`,{
    method:'POST'
  })

export const rejectBandJoinRequest=id=>
  request(`/api/bands/join-requests/${id}/reject`,{
    method:'POST'
  })

export const createBandInvite=(bandId,values={})=>
  request(`/api/bands/${bandId}/invites`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(values)
  })

export const getBandInvites=bandId=>
  request(`/api/bands/${bandId}/invites`)

export const joinBandByCode=code=>
  request('/api/bands/join-by-code',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({code})
  })
