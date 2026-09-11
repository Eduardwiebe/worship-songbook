#!/usr/bin/env node
/**
 * Regression: iOS gallery screenshots must count as scan images even when
 * File.type is empty / octet-stream and the name has no useful extension.
 * Run: node scripts/test-scan-file-types.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canSubmitScan,
  classifyScanFile,
  inferImageMimeFromName,
  isLikelyScanImageFile,
  resolveScanTitle,
  titleFromScanFile,
  withInferredImageType,
} from '../lib/scanFileTypes.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function file({ name = '', type = '', size = 120_000 } = {}) {
  return { name, type, size }
}

assert(isLikelyScanImageFile(file({ name: 'chart.jpg', type: 'image/jpeg' })), 'jpeg with mime')
assert(isLikelyScanImageFile(file({ name: 'IMG_1234.PNG', type: 'image/png' })), 'png screenshot with mime')
assert(isLikelyScanImageFile(file({ name: 'IMG_1234.PNG', type: '' })), 'empty MIME + .png extension')
assert(isLikelyScanImageFile(file({ name: 'photo.HEIC', type: '' })), 'empty MIME + .heic')
assert(isLikelyScanImageFile(file({ name: 'snap.webp', type: 'application/octet-stream' })), 'webp as octet-stream')
assert(isLikelyScanImageFile(file({ name: 'shot.gif', type: '' })), 'empty MIME + .gif')
assert(!isLikelyScanImageFile(file({ name: 'image', type: '' })), 'no MIME and no image ext is not enough')
assert(
  isLikelyScanImageFile(file({ name: 'image', type: '' }), { assumeImage: true }),
  'gallery/camera picker may omit MIME and extension',
)
assert(!isLikelyScanImageFile(file({ name: 'song.pdf', type: '' })), 'pdf must not count as image')
assert(!isLikelyScanImageFile(file({ name: 'notes.txt', type: 'text/plain' })), 'txt must not count as image')
assert(!isLikelyScanImageFile(file({ name: 'clip.mov', type: 'video/quicktime' })), 'video rejected')
assert(!isLikelyScanImageFile(file({ name: 'empty.png', type: 'image/png', size: 0 })), 'empty file rejected')
assert(!isLikelyScanImageFile(file({ name: 'huge.png', type: 'image/png', size: 21 * 1024 * 1024 })), 'oversize rejected')

assert(classifyScanFile(file({ name: 'chart.pdf', type: '' })) === 'pdf', 'classify pdf by extension')
assert(classifyScanFile(file({ name: 'chart.png', type: '' })) === 'image', 'classify png empty mime')
assert(classifyScanFile(file({ name: 'image', type: '' })) === 'unsupported', 'no ext + empty mime without gallery flag')
assert(classifyScanFile(file({ name: 'notes.txt', type: '' })) === 'text', 'classify txt')

assert(inferImageMimeFromName(file({ name: 'IMG_1.PNG', type: '' })) === 'image/png', 'infer png')
assert(inferImageMimeFromName(file({ name: 'x.HEIC', type: '' })) === 'image/heic', 'infer heic')
assert(inferImageMimeFromName(file({ name: 'image', type: '' })) === 'image/jpeg', 'default jpeg')

if (typeof File === 'function') {
  const raw = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], 'image', { type: '' })
  const normalized = withInferredImageType(raw, 0)
  assert(normalized.type === 'image/jpeg', 'normalize unnamed iOS file to image/*')
  assert(/\.\w+$/.test(normalized.name), 'normalize adds an extension')
}

assert(titleFromScanFile(file({ name: 'Amazing Grace.PNG' })) === 'Amazing Grace', 'title from screenshot name')
assert(titleFromScanFile(file({ name: 'image.png' })) === 'image', 'iOS Photos name becomes title')
assert(titleFromScanFile(file({ name: 'IMG_1234.HEIC' })) === 'IMG_1234', 'HEIC basename becomes title')
assert(resolveScanTitle('', file({ name: '' })) === 'Scan', 'fallback when file has no name')
assert(resolveScanTitle('  Hosanna  ', file({ name: 'x.png' })) === 'Hosanna', 'typed title wins')

assert(canSubmitScan({ mode: 'images', pageCount: 0, title: 'Song' }) === false, 'empty gallery stays disabled')
assert(canSubmitScan({ mode: 'images', pageCount: 1, title: '' }) === false, 'pages without title stay disabled')
assert(canSubmitScan({ mode: 'images', pageCount: 1, title: 'image' }) === true, 'auto-filled title + pages enables')
assert(canSubmitScan({ mode: 'pdf', hasPdf: true, selectedPdfCount: 2, title: 'chart' }) === true, 'pdf pages + title enable')
assert(canSubmitScan({ mode: 'pdf', hasPdf: true, selectedPdfCount: 2, title: '' }) === false, 'pdf without title stays disabled')
assert(canSubmitScan({ mode: 'text', pasteText: 'G\nHi', title: '' }) === false, 'paste still needs title')
assert(canSubmitScan({ mode: 'text', pasteText: 'G\nHi', title: 'Song' }) === true, 'paste with title enables')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
assert(app.includes('isLikelyScanImageFile'), 'ScanDialog must use isLikelyScanImageFile (not type-only filter)')
assert(app.includes('titleFromScanFile(next[0])'), 'gallery add() must auto-fill title from first image name')
assert(app.includes('canSubmitScan'), 'ScanDialog must use canSubmitScan')
assert(
  !/filter\(file=>file\.type\.startsWith\('image\/'\)\)/.test(app),
  'must not drop iOS gallery files that lack file.type',
)
assert(app.includes('SCAN_IMAGE_ACCEPT') && app.includes('SCAN_MIXED_ACCEPT'), 'file inputs use shared accept lists')

const prep = readFileSync(join(root, 'app/src/scanImagePrep.js'), 'utf8')
assert(prep.includes('isLikelyScanImageFile'), 'prep must treat empty-MIME gallery files as images')

const server = readFileSync(join(root, 'server.mjs'), 'utf8')
assert(server.includes('isLikelyScanImageFile'), 'POST /api/scans must accept iOS empty-MIME image parts')
assert(
  !/pages\.some\(page=>!String\(page\.type\)\.startsWith\('image\/'\)/.test(server),
  'server must not reject scan pages solely for missing File.type',
)

console.log('ok: iOS gallery screenshots classify as scan images and enable submit')
