import { apiFetch } from './apiConfig'
import { tStatic } from './i18n'
import { cacheGetMeta, cachePutMeta } from './offlineCache'

async function request(path,options={}){
  const response=await apiFetch(path,options)
  const data=await response.json().catch(()=>({}))

  if(!response.ok)
    throw new Error(data.error||tStatic('err.onboardingSave'))

  return data
}

export async function getOnboarding() {
  try {
    const data = await request('/api/onboarding')
    await cachePutMeta('onboarding', data)
    return data
  } catch (error) {
    const cached = await cacheGetMeta('onboarding')
    if (cached) return cached
    throw error
  }
}

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
