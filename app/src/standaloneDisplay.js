/**
 * Browser tab vs installed PWA.
 * On iOS, Safari chrome stays while the page is a tab. It hides only in
 * standalone (Home Screen icon) or fullscreen.
 */

export const STANDALONE_TIP_DISMISS_KEY = 'songbook-standalone-tip-dismissed-at'
/** Hide the tip again after this long so a later visit can remind them. */
export const STANDALONE_TIP_DISMISS_MS = 7 * 24 * 60 * 60 * 1000

export function isIosLikeDevice({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  // iPadOS desktop-class UA: Macintosh + touch.
  return maxTouchPoints > 1 && /Mac/i.test(platform) && !/Android/i.test(userAgent)
}

export function isIosSafari({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  if (!isIosLikeDevice({ userAgent, platform, maxTouchPoints })) return false
  return !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(userAgent)
}

export function isStandaloneDisplay(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false
  try {
    if (win.navigator?.standalone === true) return true
  } catch {
    /* ignore */
  }
  const match = win.matchMedia
  if (typeof match !== 'function') return false
  try {
    if (match.call(win, '(display-mode: standalone)').matches) return true
    if (match.call(win, '(display-mode: fullscreen)').matches) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * @returns {{ show: boolean, variant: 'safari' | 'other' | null }}
 */
export function standaloneTipDecision({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
  displayMode = 'browser',
  navigatorStandalone = false,
  native = false,
  dismissedAt = '',
  now = Date.now(),
} = {}) {
  const standalone = navigatorStandalone === true
    || displayMode === 'standalone'
    || displayMode === 'fullscreen'
  const ios = isIosLikeDevice({ userAgent, platform, maxTouchPoints })
  if (standalone || native || !ios) return { show: false, variant: null }

  const dismissed = Number(dismissedAt)
  if (dismissedAt !== '' && dismissedAt != null && Number.isFinite(dismissed) && now - dismissed < STANDALONE_TIP_DISMISS_MS) {
    return { show: false, variant: null }
  }

  const safari = isIosSafari({ userAgent, platform, maxTouchPoints })
  return { show: true, variant: safari ? 'safari' : 'other' }
}

export function readStandaloneTipDismissedAt(storage) {
  try {
    return storage?.getItem(STANDALONE_TIP_DISMISS_KEY) || ''
  } catch {
    return ''
  }
}

export function writeStandaloneTipDismissedAt(storage, now = Date.now()) {
  try {
    storage?.setItem(STANDALONE_TIP_DISMISS_KEY, String(now))
  } catch {
    /* private mode */
  }
}
