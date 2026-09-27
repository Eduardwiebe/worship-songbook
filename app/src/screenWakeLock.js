import { useEffect, useState } from 'react'

/**
 * One screen wake lock for every mounted rehearsal surface.
 * The platform releases the lock when the tab is hidden; we re-request
 * when it becomes visible again. A refcount keeps the lock while any
 * set player or original viewer is still open.
 */
let holders = 0
let session = 0
let sentinel = null
let listening = false
const listeners = new Set()

function notify(blocked) {
  listeners.forEach((listener) => listener(blocked))
}

function supported() {
  return typeof navigator !== 'undefined' && typeof navigator.wakeLock?.request === 'function'
}

async function acquire(onBlocked) {
  const token = session
  if (!supported()) {
    onBlocked(true)
    return
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  try {
    const next = await navigator.wakeLock.request('screen')
    if (token !== session || holders <= 0) {
      await next.release?.().catch(() => {})
      return
    }
    if (sentinel && sentinel !== next) {
      await sentinel.release?.().catch(() => {})
    }
    sentinel = next
    onBlocked(false)
    next.addEventListener?.('release', () => {
      if (sentinel === next) sentinel = null
    })
  } catch {
    if (token === session && holders > 0) onBlocked(true)
  }
}

function releaseLock() {
  session += 1
  const current = sentinel
  sentinel = null
  current?.release?.().catch(() => {})
}

function onVisibility() {
  if (holders <= 0) return
  if (document.visibilityState === 'visible') acquire(notify)
}

function ensureListener() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', onVisibility)
}

/** @returns {boolean} true when Wake Lock is unsupported or the request was denied */
export function useScreenWakeLock(active) {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!active) return undefined
    holders += 1
    listeners.add(setBlocked)
    ensureListener()
    acquire(notify)
    return () => {
      listeners.delete(setBlocked)
      holders = Math.max(0, holders - 1)
      if (holders === 0) {
        releaseLock()
        notify(false)
      }
    }
  }, [active])

  return active ? blocked : false
}

/** Test helper. Not used by the app. */
export function resetScreenWakeLockForTests() {
  holders = 0
  releaseLock()
}
