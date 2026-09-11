/**
 * Normalize camera/gallery images before upload — preserve resolution, fix orientation.
 * VisionKit pages are already perspective-corrected; avoid unnecessary recompression.
 *
 * iOS Photos/Files often omit File.type; still treat those blobs as images so
 * gallery screenshots reach the same JPEG/OCR path as camera scans.
 */
import { isLikelyScanImageFile, withInferredImageType } from '../../lib/scanFileTypes.mjs'

const MIN_WIDTH = 2000
const JPEG_QUALITY = 0.95

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Bild konnte nicht gelesen werden.'))
    }
    img.src = url
  })
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Bild konnte nicht vorbereitet werden.'))
      else resolve(blob)
    }, 'image/jpeg', quality)
  })
}

/** Upscale small phone photos and re-encode as JPEG for consistent server OCR input. */
export async function prepareScanPageFile(file, index = 0) {
  if (!file) return file
  const typed = String(file.type || '').startsWith('image/')
    ? file
    : isLikelyScanImageFile(file, { assumeImage: true })
      ? withInferredImageType(file, index)
      : null
  if (!typed) return file

  try {
    const img = await loadImageFromFile(typed)
    let { width, height } = img

    // Already high-res JPEG from VisionKit — keep original bytes.
    if (typed.type === 'image/jpeg' && width >= MIN_WIDTH && typed.name?.startsWith('visionkit-')) {
      return typed
    }

    if (width < MIN_WIDTH) {
      const ratio = MIN_WIDTH / width
      width = MIN_WIDTH
      height = Math.round(height * ratio)
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await canvasToJpegBlob(canvas, JPEG_QUALITY)
    const base = String(typed.name || `scan-${index + 1}`).replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    // Still upload with an image/* MIME so /api/scans does not reject iOS empty-type Files.
    return typed
  }
}

export async function prepareScanPages(pages) {
  const out = []
  for (let i = 0; i < pages.length; i += 1) {
    out.push(await prepareScanPageFile(pages[i], i))
  }
  return out
}
