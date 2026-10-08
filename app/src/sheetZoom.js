export const MIN_SHEET_ZOOM = 50
export const MAX_SHEET_ZOOM = 200
export const DEFAULT_SHEET_ZOOM = 100
const STORAGE_KEY = 'songbook-stage-zoom-v1'

export function normalizeSheetZoom(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(MAX_SHEET_ZOOM, Math.max(MIN_SHEET_ZOOM, Math.round(number))) : DEFAULT_SHEET_ZOOM
}

export function readSheetZoom() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_SHEET_ZOOM : normalizeSheetZoom(stored)
  } catch { return DEFAULT_SHEET_ZOOM }
}

export function saveSheetZoom(value) {
  const zoom = normalizeSheetZoom(value)
  try { localStorage.setItem(STORAGE_KEY, String(zoom)) } catch { /* The current display still works without local storage. */ }
  return zoom
}
