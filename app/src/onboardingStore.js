import { apiFetch } from './apiConfig'

async function request(path,options={}){
  const response=await apiFetch(path,options)
  const data=await response.json().catch(()=>({}))

  if(!response.ok)
    throw new Error(data.error||'Einrichtung konnte nicht gespeichert werden.')

  return data
}

export const getOnboarding=()=>
  request('/api/onboarding')

export const saveOnboarding=value=>
  request('/api/onboarding',{
    method:'PATCH',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(value)
  })

export const resetOnboarding=()=>
  request('/api/onboarding/reset',{
    method:'POST'
  })

export const dismissOnboarding=()=>
  request('/api/onboarding/dismiss',{
    method:'POST'
  })

export const completeOnboarding=()=>
  request('/api/onboarding/complete',{
    method:'POST'
  })
