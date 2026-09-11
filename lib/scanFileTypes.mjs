/**
 * Classify gallery/camera/Files picks for the document scanner.
 *
 * iOS Safari / PWA / WKWebView often give File objects with an empty MIME type,
 * a generic name ("image", "IMG_1234"), or no extension. Camera captures usually
 * have image/jpeg, which is why camera scan worked while gallery did not.
 */

export const SCAN_IMAGE_MAX_BYTES = 20 * 1024 * 1024

/** Camera/gallery: keep `image/*` so iOS opens Photos (extra extensions can force Files). */
export const SCAN_IMAGE_ACCEPT = 'image/*'

export const SCAN_MIXED_ACCEPT =
  'image/*,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.txt'

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif)$/i
const PDF_EXT = /\.pdf$/i
const TXT_EXT = /\.txt$/i

export function fileNameOf(file) {
  return String(file?.name || '').trim()
}

function mimeOf(file) {
  return String(file?.type || '').toLowerCase().trim()
}

export function isLikelyPdfFile(file) {
  const type = mimeOf(file)
  const name = fileNameOf(file).toLowerCase()
  return type === 'application/pdf' || type === 'application/x-pdf' || PDF_EXT.test(name)
}

export function isLikelyTextFile(file) {
  const type = mimeOf(file)
  const name = fileNameOf(file).toLowerCase()
  return type === 'text/plain' || type === 'text/txt' || TXT_EXT.test(name)
}

/**
 * Accept PNG/JPEG/HEIC/WebP/GIF by MIME or extension.
 * iOS Photos often sets type="" — still accept when the name has an image ext,
 * or when the picker was camera/gallery (`assumeImage`).
 *
 * @param {Pick<File, 'name'|'type'|'size'>} file
 * @param {{ assumeImage?: boolean }} [options]
 */
export function isLikelyScanImageFile(file, { assumeImage = false } = {}) {
  if (!file || !(file.size > 0) || file.size > SCAN_IMAGE_MAX_BYTES) return false
  const type = mimeOf(file)
  if (type.startsWith('video/') || type.startsWith('audio/')) return false
  if (isLikelyPdfFile(file) || isLikelyTextFile(file)) return false
  if (type.startsWith('image/')) return true

  const name = fileNameOf(file).toLowerCase()
  if (IMAGE_EXT.test(name)) return true

  const emptyType = !type || type === 'application/octet-stream' || type === 'application/x-octet-stream'
  return Boolean(assumeImage && emptyType)
}

export function classifyScanFile(file, { assumeImage = false } = {}) {
  if (!file || !(file.size > 0)) return 'empty'
  if (isLikelyPdfFile(file)) return 'pdf'
  if (isLikelyTextFile(file)) return 'text'
  if (isLikelyScanImageFile(file, { assumeImage })) return 'image'
  return 'unsupported'
}

export function inferImageMimeFromName(file) {
  const type = mimeOf(file)
  if (type === 'image/jpg') return 'image/jpeg'
  if (type.startsWith('image/')) return type
  const name = fileNameOf(file).toLowerCase()
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic'
  if (name.endsWith('.bmp')) return 'image/bmp'
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return 'image/tiff'
  return 'image/jpeg'
}

export function extForImageMime(mime) {
  const type = String(mime || '').toLowerCase()
  if (type === 'image/png') return '.png'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/gif') return '.gif'
  if (type === 'image/heic' || type === 'image/heif') return '.heic'
  if (type === 'image/bmp') return '.bmp'
  if (type === 'image/tiff') return '.tiff'
  return '.jpg'
}

/** Give iOS Files a usable name + image/* type so upload/OCR validation passes. */
export function withInferredImageType(file, index = 0) {
  if (!file) return file
  const type = inferImageMimeFromName(file)
  let name = fileNameOf(file)
  if (!name) name = `scan-${index + 1}${extForImageMime(type)}`
  else if (!/\.[^.]+$/.test(name)) name = `${name}${extForImageMime(type)}`
  if (file.type === type && file.name === name) return file
  return new File([file], name, { type, lastModified: file.lastModified || Date.now() })
}

/** Basename of the first pick — same idea as PDF `file.name.replace(/\.pdf$/i,'')`. */
export function titleFromScanFile(file) {
  return fileNameOf(file).replace(/\.[^.]+$/, '').trim()
}

export function resolveScanTitle(title, fallbackFile) {
  const trimmed = String(title || '').trim()
  if (trimmed) return trimmed
  return titleFromScanFile(fallbackFile) || 'Scan'
}

/**
 * Same rule as the original ScanDialog: title + a source.
 * Gallery `add()` must auto-fill title from the first filename so this can pass.
 */
export function canSubmitScan({
  title = '',
  mode = 'images',
  pageCount = 0,
  hasPdf = false,
  selectedPdfCount = 0,
  pasteText = '',
} = {}) {
  if (!String(title || '').trim()) return false
  if (mode === 'text') return Boolean(String(pasteText || '').trim())
  if (mode === 'pdf') return Boolean(hasPdf && selectedPdfCount > 0)
  if (mode === 'images') return pageCount > 0
  return false
}
