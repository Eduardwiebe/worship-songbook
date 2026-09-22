#!/usr/bin/env node
/**
 * Page detect → deskew → crop for Original scans.
 * JS covers the camera/gallery preview. Python covers the stored PDF.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectDocumentQuad, warpRgba } from '../app/src/documentDetect.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(dist(actual, expected) <= tolerance, `${label}: ${actual} far from ${expected}`)
}

{
  const width = 200
  const height = 280
  const gray = new Uint8Array(width * height)
  gray.fill(36)
  for (let y = 40; y <= 240; y += 1) {
    for (let x = 28; x <= 168; x += 1) gray[y * width + x] = 244
  }
  for (let y = 60; y < 220; y += 12) {
    for (let x = 40; x <= 156; x += 1) gray[y * width + x] = 12
  }
  const quad = detectDocumentQuad(gray, width, height)
  assert.ok(quad, 'inset sheet should be detected')
  assertNear(quad[0], [28, 40], 8, 'tl')
  assertNear(quad[1], [168, 40], 8, 'tr')
  assertNear(quad[2], [168, 240], 8, 'br')
  assertNear(quad[3], [28, 240], 8, 'bl')

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    const value = gray[i]
    rgba[i * 4] = value
    rgba[i * 4 + 1] = value
    rgba[i * 4 + 2] = value
    rgba[i * 4 + 3] = 255
  }
  const warped = warpRgba(rgba, width, height, quad)
  assert.ok(warped, 'warp should succeed')
  assert.ok(warped.width < width - 10 && warped.height < height - 10, 'warp should crop the table')
  const corner = (x, y) => warped.data[(y * warped.width + x) * 4]
  assert.ok(corner(2, 2) > 200 && corner(warped.width - 3, 2) > 200, 'cropped corners should be the sheet')
  console.log('OK js inset page detected and cropped')
}

{
  const width = 180
  const height = 260
  const gray = new Uint8Array(width * height)
  gray.fill(240)
  for (let y = 24; y < 40; y += 1) {
    for (let x = 16; x < width - 16; x += 1) gray[y * width + x] = 10
  }
  assert.equal(detectDocumentQuad(gray, width, height), null)
  console.log('OK js full-frame sheet is not cropped')
}

{
  const width = 220
  const height = 300
  const gray = new Uint8Array(width * height)
  gray.fill(42)
  const top = 36
  const bot = 250
  const topL = 40
  const topR = 170
  const botL = 22
  const botR = 188
  for (let y = top; y <= bot; y += 1) {
    const t = (y - top) / (bot - top)
    const left = Math.round(topL + (botL - topL) * t)
    const right = Math.round(topR + (botR - topR) * t)
    for (let x = left; x <= right; x += 1) gray[y * width + x] = 246
  }
  for (let y = 56; y < 230; y += 9) {
    const t = (y - top) / (bot - top)
    const left = Math.round(topL + (botL - topL) * t) + 10
    const right = Math.round(topR + (botR - topR) * t) - 10
    for (let x = left; x <= right; x += 1) gray[y * width + x] = 8
  }
  const quad = detectDocumentQuad(gray, width, height)
  assert.ok(quad, 'trapezoid sheet should be detected')
  assertNear(quad[0], [topL, top], 10, 'trap tl')
  assertNear(quad[1], [topR, top], 10, 'trap tr')
  assertNear(quad[2], [botR, bot], 10, 'trap br')
  assertNear(quad[3], [botL, bot], 10, 'trap bl')
  console.log('OK js perspective trapezoid detected')
}

const py = spawnSync('python3', ['scripts/test-scan-deskew.py'], { cwd: root, encoding: 'utf8' })
if (py.status !== 0) {
  console.error(py.stdout)
  console.error(py.stderr)
  process.exit(py.status || 1)
}
process.stdout.write(py.stdout)
console.log('OK scan deskew harness')
