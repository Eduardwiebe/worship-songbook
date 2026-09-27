/**
 * Native-aware fetch transport.
 * Web: browser fetch (same-origin cookies).
 * Native: @tauri-apps/plugin-http (bypasses WebView CORS; scoped in capabilities).
 */

import { URL_APP } from './appMeta'
import { markTransportOffline, markTransportOnline } from './offlineCache'
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

const DEFAULT_NATIVE_API = URL_APP

let refreshPromise = null
let nativeFetchImpl = null

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

export function toApiPath(urlOrPath = '') {
  if (!urlOrPath) return ''
  if (urlOrPath.startsWith('/')) return urlOrPath.split('#')[0]
  try {
    const parsed = new URL(urlOrPath, getApiBase() || window.location.origin)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return String(urlOrPath).split('#')[0]
  }
}

async function resolveNativeFetch() {
  if (nativeFetchImpl) return nativeFetchImpl
  const mod = await import('@tauri-apps/plugin-http')
  nativeFetchImpl = mod.fetch
  return nativeFetchImpl
}

/** Absolute-URL fetch: plugin-http on native, browser fetch on web. */
export async function transportFetch(url, options = {}) {
  if (isNativeRuntime()) {
    const nativeFetch = await resolveNativeFetch()
    return nativeFetch(url, options)
  }
  return fetch(url, options)
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

  const response = await transportFetch(apiUrl('/api/auth/native/refresh'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
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

function networkFailure(error) {
  markTransportOffline()
  const wrapped = error instanceof Error ? error : new Error(String(error || 'Failed to fetch'))
  wrapped.network = true
  return wrapped
}

export async function apiFetch(path, options = {}) {
  const native = isNativeRuntime()
  const skipAuth = Boolean(options.skipAuth)
  const method = String(options.method || 'GET').toUpperCase()
  const timeoutMs = Number(options.timeoutMs) || (method === 'GET' || method === 'HEAD' ? 45000 : 120000)
  const opts = {
    ...options,
    credentials: options.credentials || (native ? 'omit' : 'include'),
    headers: buildHeaders(options, { withBearer: native && !skipAuth }),
  }
  delete opts.skipAuth
  delete opts.timeoutMs

  // Airplane Mode / DevTools offline: fail immediately so cached reads are used.
  // A dead route with navigator.onLine still true is bounded by timeoutMs below.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw networkFailure(new TypeError('Failed to fetch'))
  }

  if (native && !skipAuth) await ensureFreshNativeToken()

  const send = async (headers) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const outer = opts.signal
    if (outer) {
      if (outer.aborted) controller.abort()
      else outer.addEventListener('abort', () => controller.abort(), { once: true })
    }
    try {
      const response = await transportFetch(apiUrl(path), { ...opts, headers, signal: controller.signal })
      markTransportOnline()
      return response
    } catch (error) {
      throw networkFailure(error)
    } finally {
      clearTimeout(timer)
    }
  }

  let response = await send(buildHeaders(opts, { withBearer: native && !skipAuth }))

  if (native && !skipAuth && response.status === 401) {
    const refreshed = await (refreshPromise || refreshNativeAccessToken())
    if (refreshed) {
      response = await send(buildHeaders(opts, { withBearer: true }))
    }
  }

  return response
}

/** Fetch authenticated binary/media and return a blob: URL (native) or plain API URL (web). */
export async function authorizedObjectUrl(pathOrUrl, { mimeHint } = {}) {
  const path = toApiPath(pathOrUrl)
  if (!path) return ''
  if (!isNativeRuntime()) return apiUrl(path)

  const response = await apiFetch(path)
  if (!response.ok) throw new Error('Medium konnte nicht geladen werden.')
  let blob = await response.blob()
  const hinted = mimeHint || (/\/pdf(?:\?|$)/i.test(path) ? 'application/pdf' : '')
  if (hinted && (!blob.type || blob.type === 'application/octet-stream')) {
    blob = new Blob([blob], { type: hinted })
  }
  return URL.createObjectURL(blob)
}

export function discardNativeAccessToken() {
  clearAccessToken()
  setAccessToken('')
}
