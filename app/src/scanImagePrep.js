/**
 * Normalize camera/gallery images before upload — preserve resolution, fix orientation.
 */

const MIN_WIDTH = 2000
const JPEG_QUALITY = 0.92

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
  if (!file?.type?.startsWith('image/')) return file

  try {
    const img = await loadImageFromFile(file)
    let { width, height } = img
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
    const base = String(file.name || `scan-${index + 1}`).replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

export async function prepareScanPages(pages) {
  const out = []
  for (let i = 0; i < pages.length; i += 1) {
    out.push(await prepareScanPageFile(pages[i], i))
  }
  return out
}
