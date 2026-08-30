/**
 * Secure storage adapter for native refresh tokens.
 *
 * Prefer OS credential store via Tauri commands (Keychain / Credential Manager / Keystore).
 * Never uses localStorage for refresh tokens.
 * Web builds do not persist native tokens here.
 */

function isNativeRuntime() {
  if (typeof window === 'undefined') return false
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

const MEMORY = new Map()

async function invokeSecure(cmd, payload) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(cmd, payload)
}

export async function secureSet(key, value) {
  if (!isNativeRuntime()) {
    MEMORY.set(key, value)
    return { backend: 'memory' }
  }
  try {
    await invokeSecure('secure_set', { key, value })
    MEMORY.set(key, value)
    return { backend: 'os-keyring' }
  } catch (error) {
    console.warn('[secureStorage] secure_set fallback:', error?.message || error)
    MEMORY.set(key, value)
    return { backend: 'memory-fallback' }
  }
}

export async function secureGet(key) {
  if (!isNativeRuntime()) return MEMORY.get(key) || null
  try {
    const value = await invokeSecure('secure_get', { key })
    if (typeof value === 'string') {
      MEMORY.set(key, value)
      return value
    }
    return MEMORY.get(key) || null
  } catch (error) {
    console.warn('[secureStorage] secure_get fallback:', error?.message || error)
    return MEMORY.get(key) || null
  }
}

export async function secureDelete(key) {
  MEMORY.delete(key)
  if (!isNativeRuntime()) return
  try {
    await invokeSecure('secure_delete', { key })
  } catch (error) {
    console.warn('[secureStorage] secure_delete fallback:', error?.message || error)
  }
}
