import { apiFetch, apiUrl, isNativeRuntime } from './apiConfig'
import { tStatic } from './i18n'
import {
  applyNativeLoginTokens,
  clearNativeSession,
  loadRefreshToken,
  loadSelectedBand,
  onNativeAuthFailure,
} from './nativeSession'
import { cacheGetMeta, cachePutMeta, clearOfflineCache, isNetworkError, setCacheIdentity } from './offlineCache'

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
  try {
    if (isNativeRuntime()) {
      await loadSelectedBand()
      const data = await request('/api/auth/native/me')
      if (data?.user) { setCacheIdentity(data.user.id); await cachePutMeta('user', data) }
      return data
    }
    const data = await request('/api/auth/me')
    if (data?.user) { setCacheIdentity(data.user.id); await cachePutMeta('user', data) }
    return data
  } catch (error) {
    if (error.cancelled) throw error
    // Network miss (Airplane Mode, dead church Wi-Fi): keep reading the last
    // successful session. HTTP 401 means the server is reachable and the
    // session is gone — re-login needs the network. Web cookie Max-Age is 30 days.
    const cached = await cacheGetMeta('user')
    if (cached?.user && isNetworkError(error)) {
      setCacheIdentity(cached.user.id)
      console.warn('[offline] using cached user session')
      return cached
    }
    setCacheIdentity('')
    await clearOfflineCache()
    throw error
  }
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
    setCacheIdentity(data.user?.id)
    await cachePutMeta('user', data.user ? { user: data.user } : {})
    return data
  }
  const data = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })
  setCacheIdentity(data.user?.id)
  await cachePutMeta('user', data.user ? { user: data.user } : {})
  return data
}

export const register = async values => {
  const data = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values),
  })
  setCacheIdentity(data.user?.id)
  await cachePutMeta('user', data.user ? { user: data.user } : {})
  return data
}

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
    setCacheIdentity('')
    await clearNativeSession()
    try { await clearOfflineCache() } catch {}
    return { ok: true }
  }
  const result = await request('/api/auth/logout', { method: 'POST' })
  setCacheIdentity('')
  await clearOfflineCache()
  return result
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
