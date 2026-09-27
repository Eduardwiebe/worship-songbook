#!/usr/bin/env node
/**
 * Offline helpers + source contracts (no browser).
 * The Playwright script covers a warm cache, then DevTools-style offline.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeDataUrl,
  isNetworkError,
  mediaKeyForApiPath,
  orderSongsForOffline,
  pagesCacheKey,
  pdfCacheKey,
} from '../app/src/offlineCache.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
const media = readFileSync(join(root, 'app/src/AuthorizedMedia.jsx'), 'utf8')
const vite = readFileSync(join(root, 'app/vite.config.js'), 'utf8')
const de = readFileSync(join(root, 'app/src/i18n/de.js'), 'utf8')
const songStore = readFileSync(join(root, 'app/src/songStore.js'), 'utf8')
const cacheSrc = readFileSync(join(root, 'app/src/offlineCache.js'), 'utf8')

const songs = [
  { id: 'lib', title: 'Alpha', hasPdf: true },
  { id: 'soon', title: 'Beta', hasPdf: true },
  { id: 'past', title: 'Gamma', hasPdf: true },
  { id: 'shelf', title: 'Zulu', hasPdf: true },
  { id: 'skip', title: 'Keine Noten', hasPdf: false },
]
const sets = [
  { id: 'future', date: '2026-10-04', songIds: ['soon', 'lib'] },
  { id: 'old', date: '2024-01-02', songIds: ['past'] },
]
const ordered = orderSongsForOffline(songs, sets).map((song) => song.id)
assert.deepEqual(ordered, ['soon', 'lib', 'past', 'shelf'], 'set songs are first; songs in no set are still prepared')

const decoded = decodeDataUrl('data:image/png;base64,aGk=')
assert.equal(decoded.mime, 'image/png')
assert.equal(new TextDecoder().decode(decoded.buffer), 'hi')
const svg = decodeDataUrl('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'))
assert.equal(svg.mime, 'image/svg+xml')
assert.match(new TextDecoder().decode(svg.buffer), /<svg/)
assert.equal(decodeDataUrl('not-a-data-url'), null)

assert.equal(mediaKeyForApiPath('/api/songs/abc/pages'), pagesCacheKey('abc'))
assert.equal(mediaKeyForApiPath('/api/songs/abc/pdf'), pdfCacheKey('abc'))
assert.equal(mediaKeyForApiPath('/api/songs/abc/cover'), 'cover:abc')
assert.equal(mediaKeyForApiPath('/api/team/m1/photo'), 'team-photo:m1')
assert.equal(mediaKeyForApiPath('/api/auth/photo?v=1'), 'profile-photo')

assert.equal(isNetworkError(Object.assign(new TypeError('Failed to fetch'), { network: true })), true)
assert.equal(isNetworkError(new Error('Song nicht gefunden')), false)

assert.match(de, /Noch nicht offline verfügbar — einmal online öffnen/)
assert.match(de, /Für Offline vorbereiten/)
assert.match(de, /YouTube Probe braucht Internet/)
assert.match(de, /Offline — gespeicherte Songs und Sets sind verfügbar/)

assert.match(vite, /navigateFallback:\s*'index\.html'/)
assert.match(vite, /handler:\s*'NetworkOnly'/)
assert.match(vite, /cleanupOutdatedCaches:\s*true/)
assert.match(app, /openSongPdf\(song\)/)
assert.match(app, /className="song-actions"/)
assert.match(app, /leader-select-label/)
assert.match(app, /leader-empty/)
assert.match(app, /prefetchSongOriginals\(songs/)
const openFn = songStore.slice(songStore.indexOf('export function openSongPdf'), songStore.indexOf('export function hasSongPdf'))
assert.match(openFn, /songbook:open-original/)
assert.doesNotMatch(openFn, /window\.open\(/)
const prefetch = cacheSrc.slice(
  cacheSrc.indexOf('async function prefetchSongOriginalsNow'),
  cacheSrc.indexOf('export function prefetchSongOriginals'),
)
const pagesAt = prefetch.indexOf('/pages')
const pdfGuard = prefetch.indexOf('if (priority === 0')
assert.ok(pagesAt !== -1 && pdfGuard !== -1 && pagesAt < pdfGuard, 'viewer pages cover every song; raw PDF stays set-priority')
assert.match(media, /export function OriginalViewerOverlay/)
assert.match(media, /original-viewer-close/)
assert.match(media, /loadCachedPageUrls/)
assert.match(media, /offline\.notCached/)
assert.match(media, /const usePages = Boolean\(preferPageImages && songId\)/)
assert.doesNotMatch(app, /setView\('chords'\)/)
assert.doesNotMatch(app, /setView\('leadsheet'\)/)

console.log('ok: offline cache helpers and source contracts')
