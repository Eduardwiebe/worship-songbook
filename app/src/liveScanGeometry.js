/** Map a point from video pixels into an object-fit:contain stage. */
export function mapVideoPointToView(x, y, videoW, videoH, viewW, viewH) {
  if (!videoW || !videoH || !viewW || !viewH) return [0, 0]
  const scale = Math.min(viewW / videoW, viewH / videoH)
  const offsetX = (viewW - videoW * scale) / 2
  const offsetY = (viewH - videoH * scale) / 2
  return [offsetX + x * scale, offsetY + y * scale]
}

export function analysisQuadToVideo(quad, analysisW, analysisH, videoW, videoH) {
  if (!quad || !analysisW || !analysisH) return null
  const sx = videoW / analysisW
  const sy = videoH / analysisH
  return quad.map(([x, y]) => [x * sx, y * sy])
}

export function quadToViewPoints(quad, analysisW, analysisH, videoW, videoH, viewW, viewH) {
  const videoQuad = analysisQuadToVideo(quad, analysisW, analysisH, videoW, videoH)
  if (!videoQuad) return null
  return videoQuad.map(([x, y]) => mapVideoPointToView(x, y, videoW, videoH, viewW, viewH))
}

export function quadDrift(a, b) {
  if (!a || !b || a.length !== 4 || b.length !== 4) return Infinity
  let max = 0
  for (let i = 0; i < 4; i += 1) {
    const distance = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
    if (distance > max) max = distance
  }
  return max
}

/** Keep a run of quads that barely move. A jump or a miss resets the run. */
export function pushQuadSample(history, quad, width, height, maxFraction = 0.02) {
  if (!quad) return []
  const limit = maxFraction * Math.hypot(width || 1, height || 1)
  const previous = history?.[history.length - 1]
  if (!previous || quadDrift(previous, quad) > limit) return [quad]
  return [...history, quad].slice(-8)
}

export const LIVE_STABLE_HITS = 5
