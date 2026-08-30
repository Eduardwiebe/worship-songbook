/**
 * Central API base for Web and Native (Tauri) clients.
 *
 * Web (same origin via nginx): empty string → relative /api/...
 * Native: VITE_API_BASE or default production host.
 *
 * Native auth: Authorization Bearer + optional X-Songbook-Band.
 * Web auth: session cookies only (credentials: include).
 */

import {
  applyNativeLoginTokens,
  clearAccessToken,
  clearNativeSession,
  getAccessToken,
  getSelectedBandId,
  loadRefreshToken,
  notifyNativeAuthFailure,
  setAccessToken,
} from './nativeSession'

const DEFAULT_NATIVE_API = 'https://songbook.lyruma.app'

let refreshPromise = null

export function isNativeRuntime() {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

export function getApiBase() {
  const fromEnv = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (isNativeRuntime()) return DEFAULT_NATIVE_API
  return ''
}

export function apiUrl(path = '') {
  const base = getApiBase()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}

function buildHeaders(options = {}, { withBearer = true } = {}) {
  const headers = new Headers(options.headers || {})
  if (isNativeRuntime() && withBearer) {
    const token = getAccessToken()
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    const bandId = getSelectedBandId()
    if (bandId && !headers.has('X-Songbook-Band')) headers.set('X-Songbook-Band', bandId)
  }
  return headers
}

async function refreshNativeAccessToken() {
  const refreshToken = await loadRefreshToken()
  if (!refreshToken) return false

  const response = await fetch(apiUrl('/api/auth/native/refresh'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    credentials: 'omit',
  })

  if (!response.ok) {
    await clearNativeSession()
    notifyNativeAuthFailure()
    return false
  }

  const data = await response.json().catch(() => ({}))
  if (!data.accessToken || !data.refreshToken) {
    await clearNativeSession()
    notifyNativeAuthFailure()
    return false
  }

  await applyNativeLoginTokens(data)
  return true
}

async function ensureFreshNativeToken() {
  if (!isNativeRuntime()) return true
  if (getAccessToken()) return true
  if (!refreshPromise) {
    refreshPromise = refreshNativeAccessToken().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

export async function apiFetch(path, options = {}) {
  const native = isNativeRuntime()
  const skipAuth = Boolean(options.skipAuth)
  const opts = {
    ...options,
    credentials: options.credentials || (native ? 'omit' : 'include'),
    headers: buildHeaders(options, { withBearer: native && !skipAuth }),
  }
  delete opts.skipAuth

  if (native && !skipAuth) await ensureFreshNativeToken()

  let response = await fetch(apiUrl(path), {
    ...opts,
    headers: buildHeaders(opts, { withBearer: native && !skipAuth }),
  })

  if (native && !skipAuth && response.status === 401) {
    const refreshed = await (refreshPromise || refreshNativeAccessToken())
    if (refreshed) {
      response = await fetch(apiUrl(path), {
        ...opts,
        headers: buildHeaders(opts, { withBearer: true }),
      })
    }
  }

  return response
}

export function discardNativeAccessToken() {
  clearAccessToken()
  setAccessToken('')
}
