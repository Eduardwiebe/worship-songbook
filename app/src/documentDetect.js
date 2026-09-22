/**
 * Document page detection for camera and gallery scans.
 * Mirrors scan_document.py: find the sheet, perspective-deskew, crop.
 * VisionKit / already-straightened JPEGs are left untouched.
 */

const ANALYSIS_LONG_SIDE = 640
const MIN_AREA_RATIO = 0.12
const MAX_AREA_RATIO = 0.975
const BORDER_FRAC = 0.06
const EXPAND = -0.008
const MIN_ANGLE = 38
const MAX_ANGLE = 148
const MIN_ASPECT = 0.32
const MAX_ASPECT = 2.9
const WORK_LONG_SIDE = 2600

export function detectDocumentQuad(gray, width, height) {
  if (width < 20 || height < 20) return null
  const quad = detectQuadGray(gray, width, height)
  if (!quad) return null
  const expanded = expandQuad(quad, width, height, EXPAND)
  if (nearlyFullFrame(expanded, width, height)) return null
  if (!quadOk(expanded, width, height)) return null
  return expanded
}

export function warpRgba(src, sw, sh, quad) {
  if (!quadOk(quad, sw, sh)) return null
  const [tl, tr, br, bl] = quad
  let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)))
  let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)))
  outW = Math.max(2, Math.min(outW, 4600))
  outH = Math.max(2, Math.min(outH, 4600))
  const shortest = Math.min(sw, sh)
  if (outW < shortest * 0.18 || outH < shortest * 0.18) return null

  const coeffs = perspectiveCoefficients(
    [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]],
    [tl, tr, br, bl],
  )
  if (!coeffs) return null
  const [a, b, c, d, e, f, g, h] = coeffs
  const out = new Uint8ClampedArray(outW * outH * 4)
  out.fill(255)
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const den = g * x + h * y + 1
      if (Math.abs(den) < 1e-8) continue
      const sx = (a * x + b * y + c) / den
      const sy = (d * x + e * y + f) / den
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) continue
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(x0 + 1, sw - 1)
      const y1 = Math.min(y0 + 1, sh - 1)
      const dx = sx - x0
      const dy = sy - y0
      const i00 = (y0 * sw + x0) * 4
      const i10 = (y0 * sw + x1) * 4
      const i01 = (y1 * sw + x0) * 4
      const i11 = (y1 * sw + x1) * 4
      const dest = (y * outW + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const top = src[i00 + channel] + (src[i10 + channel] - src[i00 + channel]) * dx
        const bottom = src[i01 + channel] + (src[i11 + channel] - src[i01 + channel]) * dx
        out[dest + channel] = top + (bottom - top) * dy
      }
    }
  }
  return { data: out, width: outW, height: outH }
}

/**
 * Straighten one camera/gallery file in the browser.
 * @returns {Promise<{ file: File, detected: boolean }>}
 */
export async function straightenScanFile(file) {
  if (!file?.type?.startsWith('image/')) return { file, detected: false }
  const name = String(file.name || '')
  if (name.startsWith('visionkit-') || name.startsWith('docscan-')) {
    return { file, detected: true }
  }
  if (typeof document === 'undefined') return { file, detected: false }

  const bitmap = await loadBitmap(file)
  try {
    const detectScale = Math.min(1, ANALYSIS_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    const dw = Math.max(2, Math.round(bitmap.width * detectScale))
    const dh = Math.max(2, Math.round(bitmap.height * detectScale))
    const gray = drawGray(bitmap, dw, dh)
    const quad = detectDocumentQuad(gray, dw, dh)
    if (!quad) return { file, detected: false }

    const workScale = Math.min(1, WORK_LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    const ww = Math.max(2, Math.round(bitmap.width * workScale))
    const wh = Math.max(2, Math.round(bitmap.height * workScale))
    const quadWork = quad.map(([x, y]) => [x * (ww / dw), y * (wh / dh)])
    const src = drawRgba(bitmap, ww, wh)
    const warped = warpRgba(src, ww, wh, quadWork)
    if (!warped) return { file, detected: false }

    const blob = await rgbaToJpegBlob(warped.data, warped.width, warped.height, 0.92)
    const out = new File([blob], `docscan-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
    return { file: out, detected: true }
  } catch {
    return { file, detected: false }
  } finally {
    bitmap.close?.()
  }
}

function detectQuadGray(gray, width, height) {
  const threshold = chooseThreshold(gray, width, height)
  if (threshold == null) return null
  let mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i += 1) mask[i] = gray[i] >= threshold ? 1 : 0
  mask = fillHoles(mask, width, height)
  const component = largestComponent(mask, width, height)
  if (!component || component.length < MIN_AREA_RATIO * width * height) return null

  const ordered = orderQuad(extremePoints(component, width))
  if (!ordered) return null
  const area = polygonArea(ordered)
  if (area < MIN_AREA_RATIO * width * height || area > MAX_AREA_RATIO * width * height) return null
  if (component.length / area < 0.55) return null
  if (!quadOk(ordered, width, height)) return null
  if (nearlyFullFrame(ordered, width, height)) return null
  return ordered
}

function chooseThreshold(gray, width, height) {
  const margin = Math.max(1, Math.round(Math.min(width, height) * BORDER_FRAC))
  const border = []
  for (let y = 0; y < height; y += 2) {
    const row = y * width
    for (let x = 0; x < width; x += 2) {
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) border.push(gray[row + x])
    }
  }
  if (!border.length) return null
  border.sort((a, b) => a - b)
  const median = border[border.length >> 1]
  if (median >= 176) return null
  const otsu = otsuThreshold(gray)
  let threshold = Math.round(Math.max(median + 22, median * 0.45 + otsu * 0.55))
  threshold = Math.max(median + 16, Math.min(threshold, median + 78, 210))
  if (threshold >= 250) return null
  return threshold
}

function otsuThreshold(data) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 1) hist[data[i]] += 1
  const total = data.length
  let sumAll = 0
  for (let i = 0; i < 256; i += 1) sumAll += i * hist[i]
  let sumBg = 0
  let weightBg = 0
  let bestVar = -1
  let best = 127
  for (let level = 0; level < 256; level += 1) {
    weightBg += hist[level]
    if (!weightBg) continue
    const weightFg = total - weightBg
    if (!weightFg) break
    sumBg += level * hist[level]
    const meanBg = sumBg / weightBg
    const meanFg = (sumAll - sumBg) / weightFg
    const variance = weightBg * weightFg * (meanBg - meanFg) ** 2
    if (variance > bestVar) {
      bestVar = variance
      best = level
    }
  }
  return best
}

function fillHoles(mask, width, height) {
  const seen = new Uint8Array(width * height)
  const stack = []
  const push = (index) => {
    if (mask[index] === 0 && !seen[index]) {
      seen[index] = 1
      stack.push(index)
    }
  }
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (stack.length) {
    const current = stack.pop()
    const x = current % width
    const y = (current / width) | 0
    if (x > 0) push(current - 1)
    if (x + 1 < width) push(current + 1)
    if (y > 0) push(current - width)
    if (y + 1 < height) push(current + width)
  }
  const filled = mask.slice()
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 0 && !seen[i]) filled[i] = 1
  }
  return filled
}

function largestComponent(mask, width, height) {
  const seen = new Uint8Array(width * height)
  let best = null
  let bestCount = 0
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    const pixels = []
    while (stack.length) {
      const current = stack.pop()
      pixels.push(current)
      const x = current % width
      const y = (current / width) | 0
      if (x > 0) {
        const next = current - 1
        if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
      }
      if (x + 1 < width) {
        const next = current + 1
        if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
      }
      if (y > 0) {
        const next = current - width
        if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
      }
      if (y + 1 < height) {
        const next = current + width
        if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
      }
    }
    if (pixels.length > bestCount) {
      best = pixels
      bestCount = pixels.length
    }
  }
  return best
}

function extremePoints(component, width) {
  const best = { tl: null, tr: null, br: null, bl: null }
  const score = { tl: null, tr: null, br: null, bl: null }
  for (let i = 0; i < component.length; i += 1) {
    const index = component[i]
    const x = index % width
    const y = (index / width) | 0
    const candidates = {
      tl: [x + y, x, y],
      tr: [-(x - y), -x, y],
      br: [-(x + y), -x, y],
      bl: [x - y, x, y],
    }
    for (const key of Object.keys(candidates)) {
      const value = candidates[key]
      if (!score[key] || value[0] < score[key][0] || (value[0] === score[key][0] && value[1] < score[key][1]) || (value[0] === score[key][0] && value[1] === score[key][1] && value[2] < score[key][2])) {
        score[key] = value
        best[key] = [x, y]
      }
    }
  }
  return [best.tl, best.tr, best.br, best.bl]
}

function orderQuad(points) {
  if (points.some((point) => !point)) return null
  const unique = []
  for (const point of points) {
    if (unique.every((other) => dist(point, other) > 2.5)) unique.push(point)
  }
  if (unique.length !== 4) return null
  const sums = unique.map((p) => p[0] + p[1])
  const diffs = unique.map((p) => p[0] - p[1])
  const tl = unique[indexOfMin(sums, unique)]
  const br = unique[indexOfMax(sums, unique)]
  const tr = unique[indexOfMax(diffs, unique)]
  const bl = unique[indexOfMin(diffs, unique)]
  const ordered = [tl, tr, br, bl]
  if (new Set(ordered.map((p) => `${p[0]},${p[1]}`)).size < 4) return null
  return ordered
}

function indexOfMin(values, points) {
  let best = 0
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[best] || (values[i] === values[best] && points[i][0] < points[best][0])) best = i
  }
  return best
}

function indexOfMax(values, points) {
  let best = 0
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[best] || (values[i] === values[best] && points[i][0] > points[best][0])) best = i
  }
  return best
}

function quadOk(quad, width, height) {
  if (!quad || quad.length !== 4) return false
  if (new Set(quad.map((p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`)).size < 4) return false
  const [tl, tr, br, bl] = quad
  const sides = [dist(tl, tr), dist(tr, br), dist(br, bl), dist(bl, tl)]
  const shortest = Math.min(width, height)
  if (Math.min(...sides) < shortest * 0.12) return false
  const outW = Math.max(sides[0], sides[2])
  const outH = Math.max(sides[1], sides[3])
  const aspect = outW / Math.max(outH, 0.001)
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return false
  const angles = [angle(bl, tl, tr), angle(tl, tr, br), angle(tr, br, bl), angle(br, bl, tl)]
  if (angles.some((value) => value < MIN_ANGLE || value > MAX_ANGLE)) return false
  if (polygonArea(quad) < MIN_AREA_RATIO * width * height * 0.5) return false
  return true
}

function nearlyFullFrame(quad, width, height) {
  if (polygonArea(quad) >= MAX_AREA_RATIO * width * height) return true
  const tolerance = 0.03 * Math.min(width, height)
  const corners = [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]
  return corners.every((corner, index) => dist(quad[index], corner) <= tolerance)
}

function expandQuad(quad, width, height, amount) {
  const cx = quad.reduce((sum, point) => sum + point[0], 0) / 4
  const cy = quad.reduce((sum, point) => sum + point[1], 0) / 4
  return quad.map(([x, y]) => [
    Math.min(width - 1, Math.max(0, x + (x - cx) * amount)),
    Math.min(height - 1, Math.max(0, y + (y - cy) * amount)),
  ])
}

function polygonArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) * 0.5
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function angle(a, b, c) {
  const v1x = a[0] - b[0]
  const v1y = a[1] - b[1]
  const v2x = c[0] - b[0]
  const v2y = c[1] - b[1]
  const n1 = Math.hypot(v1x, v1y)
  const n2 = Math.hypot(v2x, v2y)
  if (n1 < 1e-6 || n2 < 1e-6) return 0
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)))
  return Math.acos(cos) * 180 / Math.PI
}

function perspectiveCoefficients(outputPoints, inputPoints) {
  const matrix = []
  const target = []
  for (let i = 0; i < outputPoints.length; i += 1) {
    const [x, y] = outputPoints[i]
    const [u, v] = inputPoints[i]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    target.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    target.push(v)
  }
  try {
    return solve(matrix, target)
  } catch {
    return null
  }
}

function solve(matrix, target) {
  const size = target.length
  const rows = matrix.map((row, index) => [...row.map(Number), Number(target[index])])
  for (let col = 0; col < size; col += 1) {
    let pivot = col
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) throw new Error('singular')
    ;[rows[col], rows[pivot]] = [rows[pivot], rows[col]]
    const divisor = rows[col][col]
    for (let colIndex = col; colIndex <= size; colIndex += 1) rows[col][colIndex] /= divisor
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue
      const factor = rows[row][col]
      if (!factor) continue
      for (let colIndex = col; colIndex <= size; colIndex += 1) rows[row][colIndex] -= factor * rows[col][colIndex]
    }
  }
  return rows.map((row) => row[size])
}

function drawGray(bitmap, width, height) {
  const rgba = drawRgba(bitmap, width, height)
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
  return gray
}

function drawRgba(bitmap, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'))
      el.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function rgbaToJpegBlob(data, width, height, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(width, height)
  image.data.set(data)
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Bild konnte nicht begradigt werden.'))
      else resolve(blob)
    }, 'image/jpeg', quality)
  })
}
