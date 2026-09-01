import { invoke } from '@tauri-apps/api/core'
import { isNativeRuntime } from './apiConfig'
import { isLikelyIosNative } from './nativePlatform'

/**
 * Native VisionKit document scanner (iOS) with HTML file-input fallback.
 */

export async function isNativeDocumentScannerAvailable() {
  if (!isNativeRuntime() || !isLikelyIosNative()) return false
  try {
    const result = await invoke('plugin:document-scanner|is_available')
    if (typeof result === 'boolean') return result
    if (result && typeof result === 'object' && 'available' in result) return Boolean(result.available)
    return Boolean(result)
  } catch {
    return false
  }
}

/**
 * @returns {Promise<{ pages: File[], cancelled: boolean, source: 'visionkit'|'fallback' }>}
 */
export async function scanDocumentsNative({ maxPages = 8 } = {}) {
  if (!(await isNativeDocumentScannerAvailable())) {
    return { pages: [], cancelled: false, source: 'fallback' }
  }

  const result = await invoke('plugin:document-scanner|scan', {
    options: { maxPages },
  })

  if (result?.cancelled) {
    return { pages: [], cancelled: true, source: 'visionkit' }
  }

  const pages = []
  for (let i = 0; i < (result?.pages || []).length; i += 1) {
    const page = result.pages[i]
    const file = await dataUrlToJpegFile(page.dataUrl, `visionkit-${i + 1}.jpg`)
    if (file) pages.push(file)
  }
  return { pages, cancelled: false, source: 'visionkit' }
}

async function dataUrlToJpegFile(dataUrl, name) {
  if (!dataUrl?.startsWith('data:')) return null
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], name, { type: blob.type || 'image/jpeg', lastModified: Date.now() })
}
