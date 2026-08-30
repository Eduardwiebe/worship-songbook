import { apiFetch, apiUrl } from './apiConfig'

async function request(path, options = {}) {
  const response = await apiFetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.')
  return data
}

export const getCurrentUser = () =>
  request('/api/auth/me')

export const login = values =>
  request('/api/auth/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(values)
  })

export const register = values =>
  request('/api/auth/register',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(values)
  })

export const logout = () =>
  request('/api/auth/logout',{method:'POST'})

export const changePassword = values =>
  request('/api/auth/change-password',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(values)
  })

export const updateProfile = values =>
  request('/api/auth/profile',{
    method:'PATCH',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(values)
  })

export async function uploadProfilePhoto(file) {
  const form=new FormData()
  form.set('photo',file)
  return request('/api/auth/photo',{
    method:'POST',
    body:form
  })
}

export const deleteProfilePhoto = () =>
  request('/api/auth/photo',{method:'DELETE'})

export const profilePhotoUrl = user =>
  user?.hasPhoto
    ? apiUrl(`/api/auth/photo?v=${encodeURIComponent(user.updatedAt||'')}`)
    : ''
