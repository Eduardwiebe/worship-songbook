#!/usr/bin/env node
import assert from 'node:assert/strict'
import { detectDocumentQuad } from '../app/src/documentDetect.js'
import {
  LIVE_STABLE_HITS,
  mapVideoPointToView,
  pushQuadSample,
  quadDrift,
  quadToViewPoints,
} from '../app/src/liveScanGeometry.js'

{
  const [x, y] = mapVideoPointToView(20, 40, 200, 400, 400, 400)
  assert.equal(x, 120)
  assert.equal(y, 40)
  const points = quadToViewPoints([[10, 20], [90, 20], [90, 180], [10, 180]], 100, 200, 200, 400, 200, 400)
  assert.deepEqual(points[0], [20, 40])
  assert.deepEqual(points[2], [180, 360])
  console.log('OK quad maps from analysis pixels into the camera view')
}

{
  const width = 349
  const height = 480
  const sx = width / 640
  const sy = height / 880
  const corners = [[90, 78], [560, 68], [576, 802], [72, 812]].map(([x, y]) => [x * sx, y * sy])
  const gray = new Uint8Array(width * height)
  gray.fill(43)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside(x, y, corners)) gray[y * width + x] = 246
    }
  }
  for (let y = Math.round(120 * sy); y < Math.round(760 * sy); y += 16) {
    for (let x = Math.round(110 * sx); x < Math.round(530 * sx); x += 1) gray[y * width + x] = 18
  }
  const quad = detectDocumentQuad(gray, width, height)
  assert.ok(quad, 'live-resolution sheet should be detected')
  console.log('OK live analysis frame finds the page quad')
}

{
  const quad = [[10, 10], [100, 12], [98, 140], [12, 138]]
  const moved = quad.map(([x, y]) => [x + 1, y])
  const jumped = quad.map(([x, y]) => [x + 40, y])
  let history = []
  for (let i = 0; i < LIVE_STABLE_HITS; i += 1) history = pushQuadSample(history, moved, 160, 200)
  assert.equal(history.length, LIVE_STABLE_HITS)
  history = pushQuadSample(history, jumped, 160, 200)
  assert.equal(history.length, 1)
  history = pushQuadSample(history, null, 160, 200)
  assert.equal(history.length, 0)
  assert.ok(quadDrift(quad, moved) < 5)
  console.log('OK a steady quad locks and a jump resets')
}

function inside(x, y, poly) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) hit = !hit
  }
  return hit
}
