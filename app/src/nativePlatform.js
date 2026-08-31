/**
 * Native platform helpers (desktop vs iOS/Android).
 * No extra Tauri OS plugin — UA + touch heuristics are enough for WKWebView / WebView.
 */

import { isNativeRuntime } from './apiConfig'

export function isLikelyIosNative() {
  if (!isNativeRuntime()) return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS desktop-class UA
  if (typeof navigator.maxTouchPoints === 'number'
    && navigator.maxTouchPoints > 1
    && /Mac/i.test(navigator.platform || '')) {
    return true
  }
  return false
}

export function isLikelyAndroidNative() {
  if (!isNativeRuntime()) return false
  return /Android/i.test(navigator.userAgent || '')
}

/** True for iOS / Android Tauri shells (no macOS/Windows menu bar). */
export function isLikelyMobileNative() {
  return isLikelyIosNative() || isLikelyAndroidNative()
}

export function isLikelyDesktopNative() {
  return isNativeRuntime() && !isLikelyMobileNative()
}
