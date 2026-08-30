#!/usr/bin/env node
/**
 * Native auth API tests (temporary user, cleaned up).
 * Run: node scripts/test-native-auth.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, scryptSync } from 'node:crypto'

const BASE = process.env.SONGBOOK_API || 'http://127.0.0.1:8791'
const DB_PATH = process.env.SONGBOOK_DB || '/var/www/songbook/data/songbook.sqlite'

const passwordHash = password => {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}

let passed = 0
let failed = 0
const assert = ( Cond, msg) => {
  if (Cond) { passed++; console.log('  OK ', msg) }
  else { failed++; console.error('  FAIL', msg) }
}

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const h = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  if (token) h.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  return { status: res.status, data, headers: res.headers }
}

const username = `natest_${Date.now().toString(36)}`
const email = `${username}@example.test`
const password = 'TestPass-Native-9x'
const id = `test-${randomBytes(8).toString('hex')}`
const now = new Date().toISOString()

const db = new DatabaseSync(DB_PATH)
db.prepare(`INSERT INTO users (id,name,username,email,password_hash,role,must_change_password,created_at,updated_at)
  VALUES (?,?,?,?,?,'user',0,?,?)`).run(id, 'Native Test', username, email, passwordHash(password), now, now)
db.prepare(`INSERT INTO onboarding_state (user_id,step,completed,mode,state_json,created_at,updated_at)
  VALUES (?,0,1,'','{}',?,?)`).run(id, now, now)

console.log('Native auth tests against', BASE)
console.log('Temp user', username)

try {
  console.log('\n1) Login / password failures')
  {
    const bad = await api('/api/auth/native/login', { method: 'POST', body: { identifier: username, password: 'wrong-password' } })
    assert(bad.status === 401, 'wrong password → 401')
    const unknown = await api('/api/auth/native/login', { method: 'POST', body: { identifier: 'no_such_user_zz', password: 'whatever12' } })
    assert(unknown.status === 401, 'unknown user → 401')
    const ok = await api('/api/auth/native/login', { method: 'POST', body: { identifier: username, password, deviceName: 'test-runner' } })
    assert(ok.status === 200 && ok.data.accessToken && ok.data.refreshToken, 'login returns tokens')
    assert(ok.data.user?.username === username, 'login returns user')
    assert(!JSON.stringify(ok.data).includes(password), 'password not echoed')
    // ensure hashes in DB, not plaintext
    const refreshHash = createHash('sha256').update(ok.data.refreshToken).digest('hex')
    const row = db.prepare('SELECT token_hash FROM native_refresh_tokens WHERE token_hash=?').get(refreshHash)
    assert(Boolean(row), 'refresh token stored hashed')
    assert(row.token_hash !== ok.data.refreshToken, 'stored value is hash not raw token')

    var access = ok.data.accessToken
    var refresh = ok.data.refreshToken
  }

  console.log('\n2) Access token me + protected API')
  {
    const me = await api('/api/auth/native/me', { token: access })
    assert(me.status === 200 && me.data.user?.id === id, 'native/me with access token')
    const meCookie = await api('/api/auth/me', { token: access })
    assert(meCookie.status === 200 && meCookie.data.user?.id === id, '/api/auth/me accepts Bearer')
    const songs = await api('/api/songs', { token: access })
    assert(songs.status === 200 && Array.isArray(songs.data), 'Bearer access to /api/songs')
    const none = await api('/api/songs')
    assert(none.status === 401, 'no token → 401 on protected API')
  }

  console.log('\n3) Expired access token')
  {
    const hash = createHash('sha256').update(access).digest('hex')
    db.prepare(`UPDATE native_access_tokens SET expires_at=? WHERE token_hash=?`).run('2000-01-01T00:00:00.000Z', hash)
    const expired = await api('/api/auth/native/me', { token: access })
    assert(expired.status === 401, 'expired access → 401')
  }

  console.log('\n4) Refresh rotation')
  {
    const refreshed = await api('/api/auth/native/refresh', { method: 'POST', body: { refreshToken: refresh } })
    assert(refreshed.status === 200 && refreshed.data.accessToken && refreshed.data.refreshToken, 'refresh issues new tokens')
    assert(refreshed.data.refreshToken !== refresh, 'refresh token rotated')
    const reuse = await api('/api/auth/native/refresh', { method: 'POST', body: { refreshToken: refresh } })
    assert(reuse.status === 401, 'old refresh revoked → 401')
    access = refreshed.data.accessToken
    refresh = refreshed.data.refreshToken
    const me = await api('/api/auth/native/me', { token: access })
    assert(me.status === 200, 'new access works after refresh')
  }

  console.log('\n5) Invalid refresh')
  {
    const bad = await api('/api/auth/native/refresh', { method: 'POST', body: { refreshToken: 'not-a-real-token-value' } })
    assert(bad.status === 401, 'invalid refresh → 401')
  }

  console.log('\n6) Logout revokes')
  {
    const out = await api('/api/auth/native/logout', {
      method: 'POST',
      token: access,
      body: { refreshToken: refresh },
    })
    assert(out.status === 200, 'logout ok')
    const me = await api('/api/auth/native/me', { token: access })
    assert(me.status === 401, 'access revoked after logout')
    const again = await api('/api/auth/native/refresh', { method: 'POST', body: { refreshToken: refresh } })
    assert(again.status === 401, 'refresh revoked after logout')
  }

  console.log('\n7) Web cookie login still works (no bearer required)')
  {
    const login = await api('/api/auth/login', {
      method: 'POST',
      body: { identifier: username, password },
      headers: { Origin: 'http://127.0.0.1:8791' },
    })
    // Origin host must match Host header (127.0.0.1:8791)
    assert(login.status === 200 && login.data.user?.username === username, 'web login ok')
    const setCookie = login.headers.getSetCookie?.() || []
    const cookieHeader = setCookie.map(v => v.split(';')[0]).join('; ')
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: cookieHeader } })
    assert(me.status === 200, 'web session cookie works for /api/auth/me')
    await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookieHeader, Origin: 'http://127.0.0.1:8791' },
    })
  }

  console.log('\n8) Band header with Bearer (membership gate)')
  {
    const login = await api('/api/auth/native/login', { method: 'POST', body: { identifier: username, password } })
    access = login.data.accessToken
    refresh = login.data.refreshToken
    const fakeBand = await api('/api/songs', {
      token: access,
      headers: { 'X-Songbook-Band': 'nonexistent-band-id' },
    })
    // Invalid band id → selectedBand returns falsy → personal scope, still 200
    assert(fakeBand.status === 200, 'invalid band header ignored safely (no crash)')
    await api('/api/auth/native/logout', { method: 'POST', token: access, body: { refreshToken: refresh } })
  }
} finally {
  db.prepare('DELETE FROM native_access_tokens WHERE user_id=?').run(id)
  db.prepare('DELETE FROM native_refresh_tokens WHERE user_id=?').run(id)
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
  db.prepare('DELETE FROM onboarding_state WHERE user_id=?').run(id)
  db.prepare('DELETE FROM users WHERE id=?').run(id)
  db.close()
  console.log('\nCleaned temp user')
}

console.log(`\nResult: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
