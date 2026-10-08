import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const dataDir = await mkdtemp(join(tmpdir(), 'songbook-set-api-'))
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, SONGBOOK_DATA_DIR: dataDir, SONGBOOK_PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
child.stderr.on('data', (chunk) => { output += chunk })
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 15000)
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)) })
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = output.match(/Songbook API on 127\.0\.0\.1:(\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const base = `http://127.0.0.1:${port}`
  async function request(path, { cookie, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: {
      origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}),
      ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  async function register(username) {
    const result = await request('/api/auth/register', { method: 'POST', body: { name: username, username, email: `${username}@example.test`, password: 'local-test-password' } })
    assert.equal(result.status, 201, JSON.stringify(result.data))
    return result.cookie
  }
  const cookie = await register('testbandowner')
  const otherCookie = await register('testotherowner')
  const ownerId = (await request('/api/auth/me', { cookie })).data.user.id
  const db = new DatabaseSync(join(dataDir, 'songbook.sqlite'))
  db.prepare('INSERT INTO songs (id,title,owner_id,file_name,file_size) VALUES (?,?,?,?,?)').run('test-original', 'Original', ownerId, 'original.pdf', 10)
  db.close()
  const created = await request('/api/sets', { cookie, method: 'POST', body: { title: 'Rehearsal', date: '2026-10-08' } })
  assert.equal(created.status, 201)
  assert.equal(created.data.revision, 0)
  const path = `/api/sets/${created.data.id}`
  const draft = { ...created.data, theme: 'Approved', songIds: ['test-original'], songBriefings: {
    'test-original': { cue: 'Guitar counts in', rehearsedRevision: '10:original.pdf' },
    forbidden: { cue: 'Must not be stored' },
  } }
  const results = await Promise.all(['Device A', 'Device B'].map((venue) => request(path, { cookie, method: 'PUT', body: { ...draft, venue } })))
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409])
  const winner = results.find((item) => item.status === 200).data
  const stored = (await request('/api/sets', { cookie })).data.find((item) => item.id === draft.id)
  assert.equal(stored.revision, 1)
  assert.equal(stored.venue, winner.venue)
  assert.deepEqual(stored.songBriefings, { 'test-original': { cue: 'Guitar counts in', rehearsedRevision: '10:original.pdf' } })
  assert.equal((await request(path, { cookie: otherCookie, method: 'PUT', body: { ...stored, theme: 'Intruder' } })).status, 404)
  assert.equal((await request(path, { cookie, method: 'PUT', body: { ...stored, revision: '1' } })).status, 409)
  assert.equal((await request(path, { cookie, method: 'PUT', body: { ...stored, theme: 'Final' } })).data.revision, 2)
  const { revision, songBriefings, ...legacy } = stored
  assert.equal((await request(path, { cookie, method: 'PUT', body: legacy })).data.revision, 3)
  assert.deepEqual((await request('/api/sets', { cookie })).data[0].songBriefings, songBriefings, 'legacy clients preserve shared rehearsal cues')
  assert.equal((await request('/api/sets', { cookie: otherCookie, headers: { 'X-Songbook-User': ownerId } })).status, 401)
  const bandA = (await request('/api/bands', { cookie, method: 'POST', body: { name: 'Band Alpha' } })).data.id
  const bandB = (await request('/api/bands', { cookie, method: 'POST', body: { name: 'Band Beta' } })).data.id
  const headers = { 'X-Songbook-Band': bandA }
  const bandSet = await request('/api/sets', { cookie, headers, method: 'POST', body: { title: 'Band set', date: '2026-10-08' } })
  assert.equal(bandSet.status, 201)
  const conflictingCookie = `${cookie}; songbook_band=${bandB}`
  const bandWrites = await Promise.all(['First', 'Second'].map((theme) => request(`/api/sets/${bandSet.data.id}`, { cookie: conflictingCookie, headers, method: 'PUT', body: { ...bandSet.data, theme } })))
  assert.deepEqual(bandWrites.map((item) => item.status).sort(), [200, 409], 'band edits also use atomic revision protection')
  const bandRows = await request('/api/sets', { cookie: conflictingCookie, headers })
  assert.equal(bandRows.data[0].id, bandSet.data.id, 'explicit band must beat shared cookie from another tab')
  const personalRows = await request('/api/sets', { cookie: conflictingCookie, headers: { 'X-Songbook-Band': 'personal' } })
  assert.equal(personalRows.data[0].id, draft.id)
  assert.equal((await request('/api/sets', { cookie: otherCookie, headers })).status, 403)
  assert.equal((await request('/api/sets', { cookie, headers: { 'X-Songbook-Band': 'missing-band' } })).status, 403)
  const native = spawn(process.execPath, ['scripts/test-native-auth.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, SONGBOOK_API: base, SONGBOOK_DB: join(dataDir, 'songbook.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let nativeOutput = ''
  native.stdout.on('data', (chunk) => { nativeOutput += chunk })
  native.stderr.on('data', (chunk) => { nativeOutput += chunk })
  const [nativeCode] = await once(native, 'exit')
  assert.equal(nativeCode, 0, nativeOutput)
  console.log('ok: actual API + isolated SQLite, simultaneous edits, persisted revision, account ownership, invalid revisions and legacy rollout')
} finally {
  if (child.exitCode === null) { child.kill(); await once(child, 'exit') }
  await rm(dataDir, { recursive: true, force: true })
}
