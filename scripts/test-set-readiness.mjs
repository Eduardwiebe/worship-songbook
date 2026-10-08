import assert from 'node:assert/strict'
import { evaluateSetReadiness, sheetCacheStatus, songIsRehearsed } from '../app/src/setReadiness.js'
import { cachePagesPayload, cachePutMedia, prefetchSongOriginals } from '../app/src/offlineCache.js'

const song = { id: 'a', title: 'Own song', hasPdf: true, fileSize: 10, fileName: 'own.pdf' }
const record = { pages: [{ buffer: new Uint8Array([1]).buffer }], meta: { revision: '10:own.pdf' } }
assert.equal(songIsRehearsed(song, { rehearsedRevision: '10:own.pdf' }), true)
assert.equal(songIsRehearsed({ ...song, fileSize: 11 }, { rehearsedRevision: '10:own.pdf' }), false)
assert.equal(songIsRehearsed(song, {}), false)
assert.equal(sheetCacheStatus(song, record), 'available')
assert.equal(sheetCacheStatus({ ...song, fileSize: 11 }, record), 'outdated')
assert.equal(sheetCacheStatus(song, { pages: [{ buffer: new ArrayBuffer(0) }] }), 'missing')
const set = { songIds: ['a', 'gone'], leaders: { a: 'group', gone: 'removed-member' } }
const result = evaluateSetReadiness(set, [song], [], { a: 'available' })
assert.equal(result.sheetsReady, false)
assert.equal(result.offlineCount, 1)
assert.deepEqual(result.entries[1].issues, ['missingSong', 'missingLead'])
assert.equal(evaluateSetReadiness({ songIds: [] }, [], []).sheetsReady, false)
assert.equal(evaluateSetReadiness({ songIds: ['a'], leaders: { a: 'group' } }, [song], [], { a: 'available' }).sheetsReady, true)
assert.deepEqual(evaluateSetReadiness({ songIds: ['a'], leaders: { a: 'gone' } }, [song], [], { a: 'outdated' }).entries[0].issues, ['outdated', 'missingLead'])

// No IndexedDB in Node: a storage failure must not be reported as successful.
const warn = console.warn
console.warn = () => {}
try {
  assert.equal(await cachePagesPayload('a', [{ dataUrl: 'data:image/png;base64,AQ==' }, { dataUrl: 'invalid' }]), false)
  assert.equal(await cachePutMedia('a', { buffer: new Uint8Array([1]).buffer }), false)
  assert.equal(await cachePagesPayload('a', [{ dataUrl: 'data:image/png;base64,AQ==' }]), false)
  const prepared = await prefetchSongOriginals([song], { apiFetch: async () => new Response(JSON.stringify({ pages: [{ dataUrl: 'data:image/png;base64,AQ==' }] }), { headers: { 'content-type': 'application/json' } }) })
  assert.equal(prepared.cached, 0)
  assert.equal(prepared.failed, 1)
} finally { console.warn = warn }
console.log('ok: set readiness, missing references, revisions, incomplete sheets and failed storage')
