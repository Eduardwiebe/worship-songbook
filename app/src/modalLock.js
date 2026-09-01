/**
 * Central modal scroll lock + iOS WKWebView viewport restore after keyboard/modals.
 * Avoids position:fixed body hacks that corrupt layout on iOS after keyboard close.
 */

import { isLikelyIosNative } from './nativePlatform'

let lockCount = 0
let savedScrollY = 0
let restoreTimers = []

function isViewportDebugEnabled() {
  try {
    if (localStorage.getItem('songbook-viewport-debug') === '1') return true
    if (typeof window !== 'undefined' && window.location.hash.includes('viewportDebug')) return true
  } catch { /* ignore */ }
  return false
}

export function readViewportMetrics() {
  const doc = document.documentElement
  const vv = window.visualViewport
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    scrollY: window.scrollY,
    bodyOverflow: document.body.style.overflow || '',
    bodyPosition: document.body.style.position || '',
    bodyTop: document.body.style.top || '',
    bodyWidth: document.body.style.width || '',
    visualViewportWidth: vv?.width ?? null,
    visualViewportHeight: vv?.height ?? null,
    visualViewportScale: vv?.scale ?? null,
    visualViewportOffsetLeft: vv?.offsetLeft ?? null,
    visualViewportOffsetTop: vv?.offsetTop ?? null,
  }
}

export function logViewportState(label) {
  if (!isViewportDebugEnabled()) return
  const m = readViewportMetrics()
  console.info(`[viewport:${label}]`, m)
  ;[100, 300, 600].forEach((ms) => {
    setTimeout(() => console.info(`[viewport:${label}+${ms}ms]`, readViewportMetrics()), ms)
  })
}

function clearRestoreTimers() {
  for (const id of restoreTimers) window.clearTimeout(id)
  restoreTimers = []
}

function clearInlineScrollLockStyles() {
  for (const prop of ['position', 'top', 'left', 'right', 'width', 'transform', 'paddingRight', 'touchAction']) {
    document.body.style.removeProperty(prop)
  }
  document.documentElement.style.removeProperty('overflow')
  document.body.style.removeProperty('overflow')
}

/** Blur focused input so iOS can exit keyboard zoom state. */
export function blurActiveElement() {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur()
  }
}

/**
 * After keyboard/modal close, nudge WKWebView back to a sane viewport.
 * Does NOT change viewport meta or apply scale/zoom.
 */
export function scheduleViewportRestore(reason = 'restore') {
  clearRestoreTimers()

  const run = (pass) => {
    clearInlineScrollLockStyles()

    const vv = window.visualViewport
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1

    if (vv && (Math.abs(vv.offsetLeft) > 0.5 || (vv.scale && Math.abs(vv.scale - 1) > 0.01))) {
      window.scrollTo(0, window.scrollY)
    }

    if (overflow && lockCount === 0) {
      window.scrollTo(0, Math.max(0, savedScrollY))
    }

    logViewportState(`${reason}:${pass}`)
  }

  run('0ms')
  for (const ms of [100, 300, 600]) {
    restoreTimers.push(window.setTimeout(() => run(`${ms}ms`), ms))
  }
}

export function lockBodyScroll() {
  lockCount += 1
  if (lockCount === 1) {
    savedScrollY = window.scrollY
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    logViewportState('lock')
  }
}

export function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    clearInlineScrollLockStyles()
    window.scrollTo(0, savedScrollY)
    scheduleViewportRestore('unlock')
  }
}

export function dismissModal(onClose) {
  blurActiveElement()
  onClose?.()
  scheduleViewportRestore('dismiss')
}

export function installViewportDebug() {
  if (!isLikelyIosNative() && !isViewportDebugEnabled()) return () => {}

  logViewportState('initial-load')

  const onViewportChange = () => logViewportState('visualViewport-event')
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)

  const onFocusIn = (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
      logViewportState('input-focus')
    }
  }
  const onFocusOut = () => scheduleViewportRestore('input-blur')

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)

  return () => {
    window.visualViewport?.removeEventListener('resize', onViewportChange)
    window.visualViewport?.removeEventListener('scroll', onViewportChange)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    clearRestoreTimers()
  }
}
