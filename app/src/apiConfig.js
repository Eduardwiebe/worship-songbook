/**
 * Central API base for Web and Native (Tauri) clients.
 *
 * Web (same origin via nginx): empty string → relative /api/...
 * Native: VITE_API_BASE or default production host.
 */
const DEFAULT_NATIVE_API = 'https://songbook.lyruma.app'

function detectNative() {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

export function getApiBase() {
  const fromEnv = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (detectNative()) return DEFAULT_NATIVE_API
  return ''
}

export function apiUrl(path = '') {
  const base = getApiBase()
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}`
}

export function apiFetch(path, options = {}) {
  const opts = {
    ...options,
    credentials: options.credentials || 'include',
  }
  return fetch(apiUrl(path), opts)
}
