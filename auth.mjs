import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { readFile, writeFile, unlink } from 'node:fs/promises'

const COOKIE = 'songbook_session'
const ACCESS_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

const hashToken = token => createHash('sha256').update(token).digest('hex')
const passwordHash = password => {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}
const passwordMatches = (password, encoded = '') => {
  const [, salt, expected] = encoded.split('$')
  if (!salt || !expected) return false
  const actual = scryptSync(password, salt, 64)
  const wanted = Buffer.from(expected, 'hex')
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}
const publicUser = user => ({
  id: user.id, name: user.name, username: user.username, email: user.email,
  role: user.role, mustChangePassword: Boolean(user.must_change_password),
  teamMemberId: user.team_member_id || null,
  hasPhoto: Boolean(user.profile_path),
  updatedAt: user.updated_at,
})
const cookie = (token, maxAge = 2592000) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`
const newOpaqueToken = () => randomBytes(32).toString('base64url')
const bearerFromReq = req => {
  const header = String(req.headers.authorization || '')
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1] || ''
}

export function initializeAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', must_change_password INTEGER NOT NULL DEFAULT 0,
    team_member_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS native_refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    device_name TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS native_access_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    refresh_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(refresh_id) REFERENCES native_refresh_tokens(id) ON DELETE CASCADE
  );`)
  for (const definition of ['profile_path TEXT', 'profile_mime TEXT']) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${definition}`) } catch {}
  }

  for (const [table, definition] of [
    ['songs', 'owner_id TEXT'], ['songs', 'is_protected INTEGER NOT NULL DEFAULT 0'],
    ['sets', 'owner_id TEXT'], ['sets', 'is_protected INTEGER NOT NULL DEFAULT 0'],
    ['team', 'owner_id TEXT'], ['appointments', 'owner_id TEXT'],
  ]) { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`) } catch {} }

    const admin = db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").get()
    if (admin) {
      db.prepare('UPDATE songs SET owner_id=?,is_protected=1 WHERE owner_id IS NULL').run(admin.id)
      db.prepare('UPDATE sets SET owner_id=?,is_protected=1 WHERE owner_id IS NULL').run(admin.id)
      db.prepare('UPDATE team SET owner_id=? WHERE owner_id IS NULL').run(admin.id)
      db.prepare('UPDATE appointments SET owner_id=? WHERE owner_id IS NULL').run(admin.id)
    }
  const now = new Date().toISOString()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  db.prepare('DELETE FROM native_access_tokens WHERE expires_at < ? OR revoked_at IS NOT NULL').run(now)
  db.prepare('DELETE FROM native_refresh_tokens WHERE expires_at < ?').run(now)
}

export function createAuth(db, json) {
  const attempts = new Map()
  const readSession = req => {
    const raw = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
    if (!raw) return null
    return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(raw), new Date().toISOString()) || null
  }
  const readBearer = req => {
    const raw = bearerFromReq(req)
    if (!raw) return null
    return db.prepare(`SELECT u.* FROM native_access_tokens t
      JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.expires_at>? AND t.revoked_at IS NULL`).get(hashToken(raw), new Date().toISOString()) || null
  }
  const resolveUser = req => readSession(req) || readBearer(req)
  const makeSession = (res, userId) => {
    const token = newOpaqueToken(); const now = new Date(); const expires = new Date(now.getTime() + 2592000e3)
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hashToken(token), userId, expires.toISOString(), now.toISOString())
    res.setHeader('set-cookie', cookie(token)); return token
  }
  const issueNativeTokens = (userId, deviceName = '') => {
    const now = new Date()
    const refreshId = randomUUID()
    const accessId = randomUUID()
    const refreshToken = newOpaqueToken()
    const accessToken = newOpaqueToken()
    const refreshExpires = new Date(now.getTime() + REFRESH_TTL_MS)
    const accessExpires = new Date(now.getTime() + ACCESS_TTL_MS)
    db.prepare(`INSERT INTO native_refresh_tokens
      (id,user_id,token_hash,created_at,expires_at,revoked_at,device_name)
      VALUES (?,?,?,?,?,NULL,?)`).run(
      refreshId, userId, hashToken(refreshToken), now.toISOString(), refreshExpires.toISOString(), deviceName || null,
    )
    db.prepare(`INSERT INTO native_access_tokens
      (id,user_id,refresh_id,token_hash,created_at,expires_at,revoked_at)
      VALUES (?,?,?,?,?,?,NULL)`).run(
      accessId, userId, refreshId, hashToken(accessToken), now.toISOString(), accessExpires.toISOString(),
    )
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
      refreshExpiresAt: refreshExpires.toISOString(),
    }
  }
  const revokeRefreshFamily = refreshId => {
    const now = new Date().toISOString()
    db.prepare('UPDATE native_refresh_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now, refreshId)
    db.prepare('UPDATE native_access_tokens SET revoked_at=? WHERE refresh_id=? AND revoked_at IS NULL').run(now, refreshId)
  }
  const safeOrigin = req => {
    const origin = req.headers.origin
    if (!origin) return true
    try { return new URL(origin).host === req.headers.host } catch { return false }
  }
  const uniqueError = error => String(error?.message || '').includes('UNIQUE')
  const isNativeAuthPath = pathname => pathname.startsWith('/api/auth/native/')
  const openPaths = new Set([
    '/api/health',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/native/login',
    '/api/auth/native/refresh',
  ])

  return {
    publicUser,
    resolveUser,
    authenticate(req, res, url) {
      if (!url.pathname.startsWith('/api/') || openPaths.has(url.pathname)) return { open: true, user: null }

      const hasBearer = Boolean(bearerFromReq(req))
      // Cookie sessions need same-origin CSRF protection. Bearer tokens do not use cookies.
      if (!hasBearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !safeOrigin(req)) {
        json(res, 403, {error:'Ungültige Anfrage'}); return null
      }

      const user = resolveUser(req)
      if (!user) { json(res, 401, {error:'Bitte anmelden'}); return null }

      const allowed = [
        '/api/auth/me', '/api/auth/logout', '/api/auth/change-password',
        '/api/auth/native/me', '/api/auth/native/logout',
      ]
      if (user.must_change_password && !allowed.includes(url.pathname)) {
        json(res, 428, {error:'Passwortänderung erforderlich',code:'PASSWORD_CHANGE_REQUIRED'}); return null
      }
      return {open:false,user}
    },
    async route(req, res, url, bodyJson) {
      if (!url.pathname.startsWith('/api/auth/')) return false

      // --- Native token endpoints (no cookie CSRF Origin gate) ---
      if (isNativeAuthPath(url.pathname)) {
        if (req.method === 'POST' && url.pathname === '/api/auth/native/login') {
          const b = await bodyJson(req)
          const identifier = String(b.identifier || '').trim()
          const password = String(b.password || '')
          const deviceName = String(b.deviceName || '').trim().slice(0, 80)
          const key = `native:${req.socket.remoteAddress}:${identifier.toLowerCase()}`
          const now = Date.now()
          const state = attempts.get(key) || {count:0, since:now}
          if (now - state.since > 900000) { state.count = 0; state.since = now }
          if (state.count >= 8) return json(res, 429, {error:'Zu viele Versuche. Bitte später erneut versuchen.'})
          const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(identifier, identifier)
          if (!user || !passwordMatches(password, user.password_hash)) {
            state.count++; attempts.set(key, state)
            return json(res, 401, {error:'Anmeldedaten sind nicht korrekt.'})
          }
          attempts.delete(key)
          const tokens = issueNativeTokens(user.id, deviceName)
          return json(res, 200, { user: publicUser(user), ...tokens })
        }

        if (req.method === 'POST' && url.pathname === '/api/auth/native/refresh') {
          const b = await bodyJson(req)
          const refreshToken = String(b.refreshToken || '')
          if (!refreshToken) return json(res, 400, {error:'Refresh Token fehlt.'})
          const nowIso = new Date().toISOString()
          const row = db.prepare(`SELECT * FROM native_refresh_tokens
            WHERE token_hash=? AND expires_at>?`).get(hashToken(refreshToken), nowIso)
          if (!row || row.revoked_at) return json(res, 401, {error:'Refresh Token ungültig.'})
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id)
          if (!user) return json(res, 401, {error:'Refresh Token ungültig.'})
          revokeRefreshFamily(row.id)
          const tokens = issueNativeTokens(user.id, row.device_name || '')
          return json(res, 200, { user: publicUser(user), ...tokens })
        }

        if (req.method === 'POST' && url.pathname === '/api/auth/native/logout') {
          const b = await bodyJson(req).catch(() => ({}))
          const refreshToken = String(b.refreshToken || '')
          const accessRaw = bearerFromReq(req)
          if (refreshToken) {
            const row = db.prepare('SELECT id FROM native_refresh_tokens WHERE token_hash=?').get(hashToken(refreshToken))
            if (row) revokeRefreshFamily(row.id)
          }
          if (accessRaw) {
            const now = new Date().toISOString()
            const access = db.prepare('SELECT refresh_id FROM native_access_tokens WHERE token_hash=?').get(hashToken(accessRaw))
            if (access?.refresh_id) revokeRefreshFamily(access.refresh_id)
            else db.prepare('UPDATE native_access_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(now, hashToken(accessRaw))
          }
          return json(res, 200, {ok:true})
        }

        if (req.method === 'GET' && url.pathname === '/api/auth/native/me') {
          const user = readBearer(req)
          if (!user) return json(res, 401, {error:'Bitte anmelden'})
          return json(res, 200, {user: publicUser(user)})
        }

        return json(res, 404, {error:'Nicht gefunden'})
      }

      // --- Web cookie auth endpoints (unchanged CSRF Origin gate) ---
      if (!['GET','HEAD','OPTIONS'].includes(req.method) && !safeOrigin(req))
        return json(res,403,{error:'Ungültige Anfrage'})

      if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        const b = await bodyJson(req); const name=String(b.name||'').trim(), username=String(b.username||'').trim(), email=String(b.email||'').trim().toLowerCase(), password=String(b.password||'')
        if (!name || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return json(res,400,{error:'Bitte alle Felder gültig ausfüllen. Das Passwort braucht mindestens 8 Zeichen.'})
        try {
          const id=randomUUID(),now=new Date().toISOString()
          db.prepare('INSERT INTO users (id,name,username,email,password_hash,role,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,name,username,email,passwordHash(password),'user',0,now,now)
          db.prepare(`INSERT INTO onboarding_state
            (user_id,step,completed,mode,state_json,created_at,updated_at)
            VALUES (?,0,0,'','{}',?,?)`).run(id,now,now)
          makeSession(res,id)
          return json(res,201,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id))})
        } catch(e) { if(uniqueError(e))return json(res,409,{error:'E-Mail-Adresse oder Benutzername wird bereits verwendet.'}); throw e }
      }
      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const b=await bodyJson(req), identifier=String(b.identifier||'').trim(), password=String(b.password||''), key=`${req.socket.remoteAddress}:${identifier.toLowerCase()}`, now=Date.now(); const state=attempts.get(key)||{count:0,since:now}; if(now-state.since>900000){state.count=0;state.since=now} if(state.count>=8)return json(res,429,{error:'Zu viele Versuche. Bitte später erneut versuchen.'})
        const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE').get(identifier,identifier)
        if(!user||!passwordMatches(password,user.password_hash)){state.count++;attempts.set(key,state);return json(res,401,{error:'Anmeldedaten sind nicht korrekt.'})}
        attempts.delete(key); makeSession(res,user.id); return json(res,200,{user:publicUser(user)})
      }
      const user=resolveUser(req); if(!user)return json(res,401,{error:'Bitte anmelden'})

      if(req.method==='GET'&&url.pathname==='/api/auth/photo'){
        const row=db.prepare('SELECT profile_path,profile_mime FROM users WHERE id=?').get(user.id)

        if(!row?.profile_path)
          return json(res,404,{error:'Kein Profilbild vorhanden.'})

        try{
          const data=await readFile(row.profile_path)
          res.writeHead(200,{
            'content-type':row.profile_mime||'image/jpeg',
            'content-length':data.length,
            'cache-control':'private,max-age=300'
          })
          return res.end(data)
        }catch{
          return json(res,404,{error:'Profilbild-Datei nicht gefunden.'})
        }
      }

      if(req.method==='POST'&&url.pathname==='/api/auth/photo'){
        const request=new Request(url,{
          method:'POST',
          headers:req.headers,
          body:Readable.toWeb(req),
          duplex:'half'
        })

        const form=await request.formData()
        const photo=form.get('photo')

        if(!photo||!photo.size)
          return json(res,400,{error:'Bitte ein Profilbild auswählen.'})

        const type=String(photo.type||'').toLowerCase()

        const allowed=[
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/heic',
          'image/heif'
        ]

        if(type && !allowed.includes(type))
          return json(res,400,{
            error:'Bitte JPG, PNG, WebP, HEIC oder HEIF verwenden.'
          })

        if(photo.size>30*1024*1024)
          return json(res,400,{
            error:'Das Profilbild darf höchstens 30 MB groß sein.'
          })

        const photoPath=`/var/www/songbook/data/profile-${user.id}`

        await writeFile(
          photoPath,
          Buffer.from(await photo.arrayBuffer())
        )

        const now=new Date().toISOString()

        db.prepare(`
          UPDATE users
          SET profile_path=?,profile_mime=?,updated_at=?
          WHERE id=?
        `).run(photoPath,type||'image/jpeg',now,user.id)

        return json(res,200,{
          user:publicUser(
            db.prepare('SELECT * FROM users WHERE id=?').get(user.id)
          )
        })
      }

      if(req.method==='DELETE'&&url.pathname==='/api/auth/photo'){
        const row=db.prepare('SELECT profile_path FROM users WHERE id=?').get(user.id)

        if(row?.profile_path)
          await unlink(row.profile_path).catch(()=>{})

        const now=new Date().toISOString()

        db.prepare(`
          UPDATE users
          SET profile_path=NULL,profile_mime=NULL,updated_at=?
          WHERE id=?
        `).run(now,user.id)

        return json(res,200,{
          user:publicUser(
            db.prepare('SELECT * FROM users WHERE id=?').get(user.id)
          )
        })
      }
      if(req.method==='GET'&&url.pathname==='/api/auth/me')return json(res,200,{user:publicUser(user)})
      if(req.method==='POST'&&url.pathname==='/api/auth/logout'){const raw=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);if(raw)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(raw));res.setHeader('set-cookie',cookie('',0));return json(res,200,{ok:true})}
      if(req.method==='POST'&&url.pathname==='/api/auth/change-password'){const b=await bodyJson(req);if(!passwordMatches(String(b.currentPassword||''),user.password_hash))return json(res,400,{error:'Das bisherige Passwort ist nicht korrekt.'});if(String(b.newPassword||'').length<8)return json(res,400,{error:'Das neue Passwort braucht mindestens 8 Zeichen.'});db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?').run(passwordHash(String(b.newPassword)),new Date().toISOString(),user.id);return json(res,200,{user:{...publicUser(user),mustChangePassword:false}})}
      if(req.method==='PATCH'&&url.pathname==='/api/auth/profile'){const b=await bodyJson(req),name=String(b.name||'').trim(),username=String(b.username||'').trim(),email=String(b.email||'').trim().toLowerCase();if(!name||!/^[a-zA-Z0-9._-]{3,40}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email))return json(res,400,{error:'Bitte gültige Profildaten eingeben.'});try{db.prepare('UPDATE users SET name=?,username=?,email=?,updated_at=? WHERE id=?').run(name,username,email,new Date().toISOString(),user.id);return json(res,200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id))})}catch(e){if(uniqueError(e))return json(res,409,{error:'E-Mail-Adresse oder Benutzername wird bereits verwendet.'});throw e}}
      return json(res,404,{error:'Nicht gefunden'})
    },
  }
}
