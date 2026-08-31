import { apiFetch, apiUrl, isNativeRuntime } from './apiConfig'
import { tStatic } from './i18n'
import {
  applyNativeLoginTokens,
  clearNativeSession,
  loadRefreshToken,
  loadSelectedBand,
  onNativeAuthFailure,
} from './nativeSession'

export { onNativeAuthFailure, isNativeRuntime }

async function request(path, options = {}) {
  const response = await apiFetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || tStatic('err.requestFailed'))
  return data
}

export async function bootstrapNativeSession() {
  if (!isNativeRuntime()) return null
  await loadSelectedBand()
  const refreshToken = await loadRefreshToken()
  if (!refreshToken) return null
  try {
    return await request('/api/auth/native/me')
  } catch {
    return null
  }
}

export const getCurrentUser = async () => {
  if (isNativeRuntime()) {
    await loadSelectedBand()
    return request('/api/auth/native/me')
  }
  return request('/api/auth/me')
}

export const login = async values => {
  if (isNativeRuntime()) {
    const data = await request('/api/auth/native/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
      skipAuth: true,
    })
    await applyNativeLoginTokens(data)
    return data
  }
  return request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })
}

export const register = values =>
  request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })

export const logout = async () => {
  if (isNativeRuntime()) {
    const refreshToken = await loadRefreshToken()
    try {
      await request('/api/auth/native/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      // still clear local tokens
    }
    await clearNativeSession()
    return { ok: true }
  }
  return request('/api/auth/logout', { method: 'POST' })
}

export const changePassword = values =>
  request('/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })

export const updateProfile = values =>
  request('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })

export async function uploadProfilePhoto(file) {
  const form = new FormData()
  form.set('photo', file)
  return request('/api/auth/photo', {
    method: 'POST',
    body: form,
  })
}

export const deleteProfilePhoto = () =>
  request('/api/auth/photo', { method: 'DELETE' })

export const profilePhotoUrl = user =>
  user?.hasPhoto
    ? apiUrl(`/api/auth/photo?v=${encodeURIComponent(user.updatedAt || '')}`)
    : ''
