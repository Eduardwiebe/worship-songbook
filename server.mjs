import http from 'node:http'
import { Readable } from 'node:stream'
import { mkdir, writeFile, readFile, unlink, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { createAuth, initializeAuth } from './auth.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync=promisify(execFile)

const root = '/var/www/songbook/data'
await mkdir(`${root}/pdfs`, {recursive: true})
const db = new DatabaseSync(`${root}/songbook.sqlite`)
db.exec(`CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT,file_name TEXT,file_size INTEGER,pdf_path TEXT,sort_order INTEGER,created_at TEXT,song_key TEXT DEFAULT '–');
CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT,song_ids TEXT NOT NULL,created_at TEXT,leaders TEXT DEFAULT '{}',event_time TEXT DEFAULT '',tech_notes TEXT DEFAULT '',technician_id TEXT DEFAULT '',band TEXT DEFAULT '',theme TEXT DEFAULT '',venue TEXT DEFAULT '',arrival_time TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS team (id TEXT PRIMARY KEY,name TEXT NOT NULL,initials TEXT,roles TEXT NOT NULL,is_leader INTEGER,is_organizer INTEGER,photo_path TEXT,photo_mime TEXT,created_at TEXT,is_designer INTEGER DEFAULT 0,is_technician INTEGER DEFAULT 0);`)
db.exec(`CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY,set_id TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,date TEXT NOT NULL,time TEXT,location TEXT,notes TEXT,created_at TEXT);`)
db.exec(`CREATE TABLE IF NOT EXISTS song_variants (song_id TEXT NOT NULL,target_key TEXT NOT NULL,source_key TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT,PRIMARY KEY(song_id,target_key));`)
try { db.exec("ALTER TABLE songs ADD COLUMN song_key TEXT DEFAULT '–'") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN leaders TEXT DEFAULT '{}'") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN song_keys TEXT DEFAULT '{}'") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN initials TEXT") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN is_designer INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE team ADD COLUMN is_technician INTEGER DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN event_time TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN tech_notes TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE sets ADD COLUMN technician_id TEXT DEFAULT ''") } catch {}
for(const column of ['band','theme','venue','arrival_time']){try{db.exec(`ALTER TABLE sets ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
for(const column of ['source_key','preferred_key']){try{db.exec(`ALTER TABLE songs ADD COLUMN ${column} TEXT DEFAULT ''`)}catch{}}
initializeAuth(db)
db.exec(`CREATE TABLE IF NOT EXISTS bands (id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS band_members (band_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',joined_at TEXT NOT NULL,PRIMARY KEY(band_id,user_id));
CREATE TABLE IF NOT EXISTS band_songs (band_id TEXT NOT NULL,song_id TEXT NOT NULL,PRIMARY KEY(band_id,song_id));
CREATE TABLE IF NOT EXISTS band_team (band_id TEXT NOT NULL,team_id TEXT NOT NULL,PRIMARY KEY(band_id,team_id));`)
db.exec(`CREATE TABLE IF NOT EXISTS band_join_requests (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(band_id,user_id)
);
CREATE TABLE IF NOT EXISTS band_invites (
  id TEXT PRIMARY KEY,
  band_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at TEXT,
  max_uses INTEGER NOT NULL DEFAULT 25,
  use_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS band_join_requests_owner_status
  ON band_join_requests(band_id,status,created_at);
CREATE INDEX IF NOT EXISTS band_join_requests_user
  ON band_join_requests(user_id,created_at);
CREATE INDEX IF NOT EXISTS band_invites_band
  ON band_invites(band_id,created_at);`)
for(const column of ['logo_path TEXT','logo_mime TEXT']){try{db.exec(`ALTER TABLE bands ADD COLUMN ${column}`)}catch{}}
  for(const table of ['sets','appointments']){try{db.exec(`ALTER TABLE ${table} ADD COLUMN band_id TEXT`)}catch{}}
db.exec(`CREATE TABLE IF NOT EXISTS onboarding_state (
  user_id TEXT PRIMARY KEY,
  step INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`)
try{db.exec(`ALTER TABLE onboarding_state ADD COLUMN manual_restart INTEGER NOT NULL DEFAULT 0`)}catch{}

const getOnboardingState=userId=>{
  const row=db.prepare(`
    SELECT step,completed,mode,state_json,manual_restart
    FROM onboarding_state
    WHERE user_id=?
  `).get(userId)

  // Legacy accounts without a row must NOT be treated as new users.
  if(!row)return {
    step:0,
    completed:true,
    manualRestart:false,
    mode:'',
    data:{}
  }

  let data={}
  try{data=JSON.parse(row.state_json||'{}')}catch{}

  return {
    step:Number(row.step)||0,
    completed:Boolean(row.completed),
    manualRestart:Boolean(row.manual_restart),
    mode:row.mode||'',
    data
  }
}

// One-time: existing accounts skip the wizard; only new registrations start incomplete.
if(!db.prepare(`SELECT 1 FROM schema_migrations WHERE id='onboarding_legacy_complete_v1'`).get()){
  const now=new Date().toISOString()
  const users=db.prepare('SELECT id FROM users').all()
  const insert=db.prepare(`
    INSERT INTO onboarding_state
      (user_id,step,completed,mode,state_json,created_at,updated_at)
    VALUES (?,?,1,'','{}',?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      completed=1,
      updated_at=excluded.updated_at
  `)
  for(const user of users)insert.run(user.id,0,now,now)
  db.prepare(`INSERT INTO schema_migrations (id,applied_at) VALUES (?,?)`)
    .run('onboarding_legacy_complete_v1',now)
}

const saveOnboardingState=(userId,value)=>{
  const now=new Date().toISOString()
  const step=Math.max(0,Math.min(20,Number(value.step)||0))
  const completed=value.completed?1:0
  const manualRestart=value.manualRestart?1:0
  const mode=['','create','join','personal'].includes(value.mode)?value.mode:''
  const data=value.data&&typeof value.data==='object'?value.data:{}

  db.prepare(`
    INSERT INTO onboarding_state
      (user_id,step,completed,manual_restart,mode,state_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      step=excluded.step,
      completed=excluded.completed,
      manual_restart=excluded.manual_restart,
      mode=excluded.mode,
      state_json=excluded.state_json,
      updated_at=excluded.updated_at
  `).run(
    userId,
    step,
    completed,
    manualRestart,
    mode,
    JSON.stringify(data),
    now,
    now
  )

  return getOnboardingState(userId)
}

const makeInitials=(name)=>{const parts=name.trim().split(/\s+/).filter(Boolean);return parts.length>1?(parts[0][0]+parts.at(-1)[0]).toUpperCase():parts[0]?.slice(0,2).toUpperCase()||''}
const json = (res, status, body) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(body)) }
const bodyJson = async (req) => { const chunks=[]; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString() || '{}') }
const songRows = (ownerId,bandId='') => (bandId?db.prepare('SELECT s.id,s.title,s.artist,s.song_key AS key,s.source_key AS sourceKey,s.preferred_key AS preferredKey,s.file_name AS fileName,s.file_size AS fileSize,s.sort_order AS sortOrder,s.created_at AS createdAt,s.is_protected AS isProtected,1 AS hasPdf FROM songs s JOIN band_songs bs ON bs.song_id=s.id WHERE bs.band_id=? ORDER BY s.sort_order DESC').all(bandId):db.prepare('SELECT id,title,artist,song_key AS key,source_key AS sourceKey,preferred_key AS preferredKey,file_name AS fileName,file_size AS fileSize,sort_order AS sortOrder,created_at AS createdAt,is_protected AS isProtected,1 AS hasPdf FROM songs WHERE owner_id=? ORDER BY sort_order DESC').all(ownerId)).map(song=>({...song,isProtected:Boolean(song.isProtected),variantKeys:db.prepare('SELECT target_key FROM song_variants WHERE song_id=? ORDER BY created_at DESC').all(song.id).map(row=>row.target_key)}))
const pitchMap={C:0,Cis:1,'C#':1,Des:1,Db:1,D:2,Dis:3,'D#':3,Es:3,Eb:3,E:4,F:5,Fis:6,'F#':6,Ges:6,Gb:6,G:7,Gis:8,'G#':8,As:8,Ab:8,A:9,Ais:10,'A#':10,Bb:10,B:11,H:11}
const namesSharp=['C','Cis','D','Dis','E','F','Fis','G','Gis','A','Ais','B'];const namesFlat=['C','Des','D','Es','E','F','Ges','G','As','A','Bb','B']
const chordPattern=/(?<![\p{L}\d])(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])((?:m|maj|min|dim|aug|sus|add)?\d*(?:sus\d*)?(?:[#b+°-]\d*)*(?:\/(?:Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH]))?)(?![\p{L}\d])/gu
const chordTokens=line=>[...line.matchAll(chordPattern)]
const isChordLine=line=>{const matches=chordTokens(line);if(!matches.length)return false;return line.replace(chordPattern,'').replace(/[\s|,:()[\]{}-]/g,'').length===0}
const pitchName=(idx,targetKey)=>{const useFlat=['F','Bb','Es','As','Des','Ges'].includes(targetKey);if(idx===10&&(useFlat||['C','G','D'].includes(targetKey)))return 'Bb';return (useFlat?namesFlat:namesSharp)[idx]}
const transposeRoot=(root,shift,targetKey)=>{const value=pitchMap[root];return value===undefined?root:pitchName((value+shift+120)%12,targetKey)}
const transposeText=(text,sourceKey,targetKey)=>{const shift=pitchMap[targetKey]-pitchMap[sourceKey];return text.split('\n').map(line=>isChordLine(line)?line.replace(chordPattern,(full,root,suffix)=>{const slash=suffix.match(/\/(Cis|Des|Dis|Es|Fis|Ges|Gis|As|Ais|C#|Db|D#|Eb|F#|Gb|G#|Ab|A#|Bb|[CDEFGABH])$/);let nextSuffix=suffix;if(slash)nextSuffix=suffix.slice(0,-slash[0].length)+'/'+transposeRoot(slash[1],shift,targetKey);return transposeRoot(root,shift,targetKey)+nextSuffix}):line).join('\n')}
const auth=createAuth(db,json)
const cookieValue=(req,name)=>String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(`${name}=`))?.slice(name.length+1)||''
const selectedBand=(req,user)=>{const id=cookieValue(req,'songbook_band');return id&&db.prepare('SELECT b.* FROM bands b JOIN band_members m ON m.band_id=b.id WHERE b.id=? AND m.user_id=?').get(id,user.id)}
const bandCookie=(id,maxAge=2592000)=>`songbook_band=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`

http.createServer(async (req,res) => { try {
  const url = new URL(req.url, 'http://localhost')
  if (req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true})
  if(url.pathname.startsWith('/api/auth/'))return await auth.route(req,res,url,bodyJson)
  const access=auth.authenticate(req,res,url);if(!access)return;const user=access.user
  const band=selectedBand(req,user);const bandId=band?.id||''
  if(req.method==='GET'&&url.pathname==='/api/onboarding'){
    return json(res,200,getOnboardingState(user.id))
  }

  if(req.method==='PATCH'&&url.pathname==='/api/onboarding'){
    const b=await bodyJson(req)
    const current=getOnboardingState(user.id)
    const manualRestart=b.manualRestart!==undefined
      ? Boolean(b.manualRestart)
      : current.manualRestart
    // Manual restart must keep completed=true while the wizard is open.
    const completed=manualRestart
      ? true
      : Boolean(b.completed)

    return json(res,200,saveOnboardingState(user.id,{
      step:b.step,
      completed,
      manualRestart,
      mode:b.mode,
      data:b.data
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/reset'){
    return json(res,200,saveOnboardingState(user.id,{
      step:0,
      completed:true,
      manualRestart:true,
      mode:'',
      data:{}
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/dismiss'){
    const current=getOnboardingState(user.id)
    return json(res,200,saveOnboardingState(user.id,{
      ...current,
      step:0,
      completed:true,
      manualRestart:false,
      mode:'',
      data:{}
    }))
  }

  if(req.method==='POST'&&url.pathname==='/api/onboarding/complete'){
    const current=getOnboardingState(user.id)
    return json(res,200,saveOnboardingState(user.id,{
      ...current,
      completed:true,
      manualRestart:false
    }))
  }

  // -------------------------------------------------------
  // Öffentliche, stark eingeschränkte Bandsuche
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/search'){
    const q=String(url.searchParams.get('q')||'').trim()

    if(q.length<3)
      return json(res,200,[])

    const rows=db.prepare(`
      SELECT id,name,description
      FROM bands
      WHERE lower(name) LIKE lower(?)
      ORDER BY name
      LIMIT 10
    `).all(`%${q}%`)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Eigene Beitrittsanfragen
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/join-requests/mine'){
    const rows=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        b.name AS bandName,
        r.status,
        r.created_at AS createdAt,
        r.updated_at AS updatedAt
      FROM band_join_requests r
      JOIN bands b ON b.id=r.band_id
      WHERE r.user_id=?
      ORDER BY r.created_at DESC
    `).all(user.id)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Beitritt beantragen
  // -------------------------------------------------------
  const bandJoinRequest=url.pathname.match(
    /^\/api\/bands\/([^/]+)\/join-request$/
  )

  if(req.method==='POST'&&bandJoinRequest){
    const bandId=bandJoinRequest[1]

    const band=db.prepare(
      'SELECT id,name FROM bands WHERE id=?'
    ).get(bandId)

    if(!band)
      return json(res,404,{error:'Band nicht gefunden.'})

    const alreadyMember=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandId,user.id)

    if(alreadyMember)
      return json(res,409,{error:'Du bist bereits Mitglied dieser Band.'})

    const existing=db.prepare(`
      SELECT id,status
      FROM band_join_requests
      WHERE band_id=? AND user_id=?
    `).get(bandId,user.id)

    const now=new Date().toISOString()

    if(existing?.status==='pending')
      return json(res,200,{
        id:existing.id,
        status:'pending',
        bandId,
        bandName:band.name
      })

    const id=existing?.id || crypto.randomUUID()

    if(existing){
      db.prepare(`
        UPDATE band_join_requests
        SET status='pending',updated_at=?
        WHERE id=?
      `).run(now,id)
    }else{
      db.prepare(`
        INSERT INTO band_join_requests
          (id,band_id,user_id,status,created_at,updated_at)
        VALUES (?,?,?,'pending',?,?)
      `).run(id,bandId,user.id,now,now)
    }

    return json(res,201,{
      id,
      status:'pending',
      bandId,
      bandName:band.name
    })
  }

  // -------------------------------------------------------
  // Anfragen für Bands, die der Nutzer besitzt
  // -------------------------------------------------------
  if(req.method==='GET'&&url.pathname==='/api/bands/join-requests'){
    const rows=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        b.name AS bandName,
        r.user_id AS userId,
        u.name AS userName,
        u.username,
        r.status,
        r.created_at AS createdAt
      FROM band_join_requests r
      JOIN bands b ON b.id=r.band_id
      JOIN users u ON u.id=r.user_id
      JOIN band_members owner
        ON owner.band_id=r.band_id
       AND owner.user_id=?
       AND owner.role='owner'
      WHERE r.status='pending'
      ORDER BY r.created_at
    `).all(user.id)

    return json(res,200,rows)
  }

  // -------------------------------------------------------
  // Anfrage annehmen / ablehnen
  // -------------------------------------------------------
  const joinDecision=url.pathname.match(
    /^\/api\/bands\/join-requests\/([^/]+)\/(approve|reject)$/
  )

  if(req.method==='POST'&&joinDecision){
    const requestId=joinDecision[1]
    const action=joinDecision[2]

    const row=db.prepare(`
      SELECT
        r.id,
        r.band_id AS bandId,
        r.user_id AS userId,
        r.status
      FROM band_join_requests r
      JOIN band_members owner
        ON owner.band_id=r.band_id
       AND owner.user_id=?
       AND owner.role='owner'
      WHERE r.id=?
    `).get(user.id,requestId)

    if(!row)
      return json(res,404,{error:'Beitrittsanfrage nicht gefunden.'})

    if(row.status!=='pending')
      return json(res,409,{error:'Diese Anfrage wurde bereits bearbeitet.'})

    const now=new Date().toISOString()

    if(action==='approve'){
      db.prepare(`
        INSERT OR IGNORE INTO band_members
          (band_id,user_id,role,joined_at)
        VALUES (?,?,'member',?)
      `).run(row.bandId,row.userId,now)

      db.prepare(`
        UPDATE band_join_requests
        SET status='accepted',updated_at=?
        WHERE id=?
      `).run(now,requestId)

      return json(res,200,{ok:true,status:'accepted'})
    }

    db.prepare(`
      UPDATE band_join_requests
      SET status='rejected',updated_at=?
      WHERE id=?
    `).run(now,requestId)

    return json(res,200,{ok:true,status:'rejected'})
  }

  // -------------------------------------------------------
  // Einladung erzeugen
  // -------------------------------------------------------
  const bandInvites=url.pathname.match(
    /^\/api\/bands\/([^/]+)\/invites$/
  )

  if(req.method==='POST'&&bandInvites){
    const bandId=bandInvites[1]

    const owner=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=? AND role='owner'
    `).get(bandId,user.id)

    if(!owner)
      return json(res,403,{error:'Nur die Bandverwaltung darf Einladungen erstellen.'})

    const b=await bodyJson(req)

    const maxUses=Math.max(
      1,
      Math.min(100,Number(b.maxUses)||25)
    )

    const expiresDays=Math.max(
      1,
      Math.min(90,Number(b.expiresDays)||7)
    )

    let code

    do{
      code=db.prepare(
        "SELECT upper(hex(randomblob(4))) AS code"
      ).get().code
    }while(
      db.prepare('SELECT 1 FROM band_invites WHERE code=?').get(code)
    )

    const id=crypto.randomUUID()
    const createdAt=new Date().toISOString()
    const expiresAt=new Date(
      Date.now()+expiresDays*24*60*60*1000
    ).toISOString()

    db.prepare(`
      INSERT INTO band_invites
        (
          id,band_id,code,created_by,expires_at,
          max_uses,use_count,active,created_at
        )
      VALUES (?,?,?,?,?,?,0,1,?)
    `).run(
      id,
      bandId,
      code,
      user.id,
      expiresAt,
      maxUses,
      createdAt
    )

    return json(res,201,{
      id,
      code,
      bandId,
      expiresAt,
      maxUses,
      useCount:0
    })
  }

  if(req.method==='GET'&&bandInvites){
    const bandId=bandInvites[1]

    const owner=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=? AND role='owner'
    `).get(bandId,user.id)

    if(!owner)
      return json(res,403,{error:'Kein Zugriff.'})

    const rows=db.prepare(`
      SELECT
        id,
        code,
        expires_at AS expiresAt,
        max_uses AS maxUses,
        use_count AS useCount,
        active,
        created_at AS createdAt
      FROM band_invites
      WHERE band_id=?
      ORDER BY created_at DESC
    `).all(bandId)

    return json(res,200,rows.map(item=>({
      ...item,
      active:Boolean(item.active)
    })))
  }

  // -------------------------------------------------------
  // Mit Einladungscode beitreten
  // -------------------------------------------------------
  if(req.method==='POST'&&url.pathname==='/api/bands/join-by-code'){
    const b=await bodyJson(req)
    const code=String(b.code||'')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g,'')

    if(!code)
      return json(res,400,{error:'Bitte Einladungscode eingeben.'})

    const invite=db.prepare(`
      SELECT
        i.*,
        b.name AS band_name
      FROM band_invites i
      JOIN bands b ON b.id=i.band_id
      WHERE i.code=?
    `).get(code)

    if(!invite)
      return json(res,404,{error:'Einladungscode nicht gefunden.'})

    if(!invite.active)
      return json(res,410,{error:'Diese Einladung ist nicht mehr aktiv.'})

    if(invite.expires_at && Date.parse(invite.expires_at)<Date.now())
      return json(res,410,{error:'Diese Einladung ist abgelaufen.'})

    if(invite.use_count>=invite.max_uses)
      return json(res,410,{error:'Diese Einladung wurde bereits zu oft verwendet.'})

    const existing=db.prepare(`
      SELECT 1
      FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(invite.band_id,user.id)

    if(!existing){
      db.prepare(`
        INSERT INTO band_members
          (band_id,user_id,role,joined_at)
        VALUES (?,?,'member',?)
      `).run(
        invite.band_id,
        user.id,
        new Date().toISOString()
      )

      db.prepare(`
        UPDATE band_invites
        SET use_count=use_count+1
        WHERE id=?
      `).run(invite.id)
    }

    db.prepare(`
      UPDATE band_join_requests
      SET status='accepted',updated_at=?
      WHERE band_id=? AND user_id=?
    `).run(
      new Date().toISOString(),
      invite.band_id,
      user.id
    )

    return json(res,200,{
      ok:true,
      band:{
        id:invite.band_id,
        name:invite.band_name
      }
    })
  }

  if(req.method==='GET'&&url.pathname==='/api/bands'){
    const rows=db.prepare(`SELECT b.id,b.name,b.description,b.logo_path IS NOT NULL AS hasLogo,m.role
      FROM bands b
      JOIN band_members m ON m.band_id=b.id
      WHERE m.user_id=?
      ORDER BY lower(b.name),b.name`).all(user.id).map(item=>({
        ...item,
        hasLogo:Boolean(item.hasLogo),
        joined:true,
        active:item.id===bandId,
        canEdit:item.role==='owner'
      }))
    return json(res,200,rows)
  }

  if(req.method==='POST'&&url.pathname==='/api/bands'){
    const b=await bodyJson(req)
    const name=String(b.name||'').trim()
    const description=String(b.description||'').trim()

    if(name.length<2||name.length>80)
      return json(res,400,{error:'Der Bandname muss zwischen 2 und 80 Zeichen lang sein.'})

    if(description.length>300)
      return json(res,400,{error:'Die Beschreibung darf höchstens 300 Zeichen enthalten.'})

    const duplicate=db.prepare(`
      SELECT 1 FROM bands
      WHERE created_by=? AND lower(name)=lower(?)
    `).get(user.id,name)

    if(duplicate)
      return json(res,409,{error:'Du hast bereits eine Band mit diesem Namen.'})

    const id=randomUUID()
    const now=new Date().toISOString()

    db.exec('BEGIN')
    try{
      db.prepare('INSERT INTO bands (id,name,description,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(id,name,description,user.id,now)

      db.prepare('INSERT INTO band_members (band_id,user_id,role,joined_at) VALUES (?,?,?,?)')
        .run(id,user.id,'owner',now)

      db.exec('COMMIT')
    }catch(e){
      db.exec('ROLLBACK')
      throw e
    }

    res.setHeader('set-cookie',bandCookie(id))
    return json(res,201,{
      id,
      name,
      description,
      role:'owner',
      joined:true,
      active:true,
      canEdit:true
    })
  }

  const bandEdit=url.pathname.match(/^\/api\/bands\/([^/]+)$/)

  if(req.method==='PATCH'&&bandEdit){
    const membership=db.prepare(`
      SELECT role FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandEdit[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf diese Band bearbeiten.'})

    const b=await bodyJson(req)
    const name=String(b.name||'').trim()
    const description=String(b.description||'').trim()

    if(name.length<2||name.length>80)
      return json(res,400,{error:'Der Bandname muss zwischen 2 und 80 Zeichen lang sein.'})

    if(description.length>300)
      return json(res,400,{error:'Die Beschreibung darf höchstens 300 Zeichen enthalten.'})

    const duplicate=db.prepare(`
      SELECT 1 FROM bands
      WHERE created_by=? AND lower(name)=lower(?) AND id<>?
    `).get(user.id,name,bandEdit[1])

    if(duplicate)
      return json(res,409,{error:'Du hast bereits eine andere Band mit diesem Namen.'})

    db.prepare('UPDATE bands SET name=?,description=? WHERE id=?')
      .run(name,description,bandEdit[1])

    return json(res,200,{
      id:bandEdit[1],
      name,
      description,
      role:'owner',
      joined:true,
      active:bandEdit[1]===bandId,
      canEdit:true
    })
  }

  if(req.method==='DELETE'&&bandEdit){
    const membership=db.prepare(`
      SELECT role FROM band_members
      WHERE band_id=? AND user_id=?
    `).get(bandEdit[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf diese Band löschen.'})

    const bandRow=db.prepare('SELECT logo_path FROM bands WHERE id=?').get(bandEdit[1])

    db.exec('BEGIN')
    try{
      db.prepare('DELETE FROM appointments WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM sets WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_join_requests WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_invites WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_team WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_songs WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM band_members WHERE band_id=?').run(bandEdit[1])
      db.prepare('DELETE FROM bands WHERE id=?').run(bandEdit[1])
      db.exec('COMMIT')
    }catch(e){
      db.exec('ROLLBACK')
      throw e
    }

    if(bandRow?.logo_path)
      await unlink(bandRow.logo_path).catch(()=>{})

    if(bandEdit[1]===bandId)
      res.setHeader('set-cookie',bandCookie('',0))

    return json(res,200,{ok:true})
  }

  const bandLogo=url.pathname.match(/^\/api\/bands\/([^/]+)\/logo$/)

  if(req.method==='GET'&&bandLogo){
    const membership=db.prepare(
      'SELECT 1 FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership)return json(res,403,{error:'Kein Zugriff'})

    const row=db.prepare(
      'SELECT logo_path,logo_mime FROM bands WHERE id=?'
    ).get(bandLogo[1])

    if(!row?.logo_path)return json(res,404,{error:'Kein Band-Logo vorhanden.'})

    try{
      const data=await readFile(row.logo_path)
      res.writeHead(200,{
        'content-type':row.logo_mime||'image/png',
        'content-length':data.length,
        'cache-control':'private,max-age=3600'
      })
      return res.end(data)
    }catch{
      return json(res,404,{error:'Band-Logo nicht gefunden.'})
    }
  }

  if(req.method==='POST'&&bandLogo){
    const membership=db.prepare(
      'SELECT role FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf das Logo ändern.'})

    const request=new Request(url,{
      method:'POST',
      headers:req.headers,
      body:Readable.toWeb(req),
      duplex:'half'
    })

    const form=await request.formData()
    const logo=form.get('logo')

    if(!logo||!logo.size)
      return json(res,400,{error:'Bitte ein Band-Logo auswählen.'})

    const type=String(logo.type||'').toLowerCase()
    const allowed=['image/jpeg','image/png','image/webp']

    if(!allowed.includes(type))
      return json(res,400,{error:'Bitte JPG, PNG oder WebP verwenden.'})

    if(logo.size>30*1024*1024)
      return json(res,400,{error:'Das Band-Logo darf höchstens 30 MB groß sein.'})

    const logoPath=`${root}/band-logo-${bandLogo[1]}`

    await writeFile(
      logoPath,
      Buffer.from(await logo.arrayBuffer())
    )

    db.prepare(
      'UPDATE bands SET logo_path=?,logo_mime=? WHERE id=?'
    ).run(logoPath,type,bandLogo[1])

    return json(res,200,{ok:true})
  }

  if(req.method==='DELETE'&&bandLogo){
    const membership=db.prepare(
      'SELECT role FROM band_members WHERE band_id=? AND user_id=?'
    ).get(bandLogo[1],user.id)

    if(!membership||membership.role!=='owner')
      return json(res,403,{error:'Nur die Bandverwaltung darf das Logo entfernen.'})

    const row=db.prepare(
      'SELECT logo_path FROM bands WHERE id=?'
    ).get(bandLogo[1])

    if(row?.logo_path)
      await unlink(row.logo_path).catch(()=>{})

    db.prepare(
      'UPDATE bands SET logo_path=NULL,logo_mime=NULL WHERE id=?'
    ).run(bandLogo[1])

    return json(res,200,{ok:true})
  }

  if(req.method==='POST'&&url.pathname==='/api/bands/personal/select'){
    res.setHeader('set-cookie',bandCookie('',0))
    return json(res,200,{ok:true,activeBandId:null})
  }

  const bandSelect=url.pathname.match(/^\/api\/bands\/([^/]+)\/select$/)
  if(req.method==='POST'&&bandSelect){
    if(!db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandSelect[1],user.id))
      return json(res,403,{error:'Kein Zugriff auf diese Band.'})

    res.setHeader('set-cookie',bandCookie(bandSelect[1]))
    return json(res,200,{ok:true,activeBandId:bandSelect[1]})
  }

  const bandMembers=url.pathname.match(/^\/api\/bands\/([^/]+)\/members$/);if(req.method==='GET'&&bandMembers){if(!db.prepare('SELECT 1 FROM band_members WHERE band_id=? AND user_id=?').get(bandMembers[1],user.id))return json(res,403,{error:'Kein Zugriff'});const accounts=db.prepare('SELECT u.id,u.name,u.username,m.role FROM band_members m JOIN users u ON u.id=m.user_id WHERE m.band_id=? ORDER BY u.name').all(bandMembers[1]);const profiles=db.prepare('SELECT t.id,t.name,t.initials,t.roles FROM band_team bt JOIN team t ON t.id=bt.team_id WHERE bt.band_id=? ORDER BY t.name').all(bandMembers[1]).map(item=>({...item,roles:JSON.parse(item.roles),profile:true}));return json(res,200,{accounts,profiles})}
  if (req.method==='GET' && url.pathname==='/api/songs') return json(res,200,songRows(user.id,bandId))
  if (req.method==='POST' && url.pathname==='/api/songs') {
    const request = new Request(url, {method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'})
    const form = await request.formData(); const titles=JSON.parse(form.get('titles')||'[]'); const files=form.getAll('files'); const base=Date.now()
    if(!files.length||files.length>50)return json(res,400,{error:'Bitte 1 bis 50 PDF-Dateien auswählen.'})
    if(files.some(file=>(file.type&&file.type!=='application/pdf')||!file.name.toLowerCase().endsWith('.pdf')||file.size>20*1024*1024))return json(res,400,{error:'Bitte nur PDF-Dateien bis maximal 20 MB importieren.'})
    db.exec('BEGIN'); try { for (let i=0;i<files.length;i++) { const file=files[i]; const id=randomUUID(); const path=`${root}/pdfs/${id}.pdf`; await writeFile(path, Buffer.from(await file.arrayBuffer())); db.prepare('INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,titles[i]||file.name.replace(/\.pdf$/i,''),'Importierte PDF',file.name,file.size,path,base-i,new Date().toISOString(),'–',user.id);if(bandId)db.prepare('INSERT INTO band_songs VALUES (?,?)').run(bandId,id) } db.exec('COMMIT') } catch(e){db.exec('ROLLBACK');throw e}
    return json(res,201,songRows(user.id,bandId).slice(0,files.length))
  }
  if(req.method==='POST'&&url.pathname==='/api/scans'){
    const request=new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'});const form=await request.formData();const title=String(form.get('title')||'').trim();const pages=form.getAll('pages');
    if(!title||!pages.length||pages.length>8)return json(res,400,{error:'Bitte Titel und 1 bis 8 Scan-Seiten angeben.'});if(pages.some(page=>!String(page.type).startsWith('image/')||page.size>20*1024*1024))return json(res,400,{error:'Bitte nur Bilder bis 20 MB pro Seite verwenden.'});
    const dir=await mkdtemp(join(tmpdir(),'songbook-scan-'));const id=randomUUID();const path=`${root}/pdfs/${id}.pdf`;try{const inputs=[];for(let index=0;index<pages.length;index++){const input=join(dir,`page-${String(index).padStart(2,'0')}`);await writeFile(input,Buffer.from(await pages[index].arrayBuffer()));inputs.push(input)}await execFileAsync('/usr/bin/python3',['/var/www/songbook/scan_to_pdf.py',path,...inputs],{maxBuffer:20*1024*1024,timeout:90000})}finally{await rm(dir,{recursive:true,force:true})}
    db.prepare('INSERT INTO songs (id,title,artist,file_name,file_size,pdf_path,sort_order,created_at,song_key,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,title,'Gescannter Import',`${title}.pdf`,pages.reduce((sum,page)=>sum+page.size,0),path,Date.now(),new Date().toISOString(),'–',user.id);if(bandId)db.prepare('INSERT INTO band_songs VALUES (?,?)').run(bandId,id);return json(res,201,songRows(user.id,bandId).find(song=>song.id===id))
  }
  const protectedSong=url.pathname.match(/^\/api\/songs\/([^/]+)/)
  if(protectedSong&&!(bandId?db.prepare('SELECT 1 FROM band_songs WHERE song_id=? AND band_id=?').get(protectedSong[1],bandId):db.prepare('SELECT 1 FROM songs WHERE id=? AND owner_id=?').get(protectedSong[1],user.id)))return json(res,404,{error:'Song nicht gefunden'})
  const pdfMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/pdf$/)
  if(req.method==='GET'&&pdfMatch){const row=db.prepare('SELECT pdf_path,file_name FROM songs WHERE id=?').get(pdfMatch[1]);if(!row)return json(res,404,{error:'Nicht gefunden'});const data=await readFile(row.pdf_path);res.writeHead(200,{'content-type':'application/pdf','content-disposition':`inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`});return res.end(data)}
  const analyzeMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/analyze-chords$/)
  if(req.method==='POST'&&analyzeMatch){const saved=db.prepare('SELECT content FROM song_variants WHERE song_id=? AND source_key=target_key ORDER BY created_at DESC LIMIT 1').get(analyzeMatch[1]);if(saved?.content){const chordLines=saved.content.split('\n').filter(isChordLine);return json(res,200,{text:saved.content,method:'Kontrollierte Fassung',chordCount:chordLines.reduce((sum,line)=>sum+chordTokens(line).length,0),chordLines:chordLines.length})}}
  if(req.method==='POST'&&analyzeMatch){const row=db.prepare('SELECT pdf_path FROM songs WHERE id=?').get(analyzeMatch[1]);if(!row)return json(res,404,{error:'Song nicht gefunden'});let method='PDF-Text';let text='';try{const result=await execFileAsync('/usr/bin/pdftotext',['-layout','-nopgbrk',row.pdf_path,'-'],{maxBuffer:20*1024*1024});text=result.stdout.replace(/\r/g,'').trim()}catch{}let chordLines=text.split('\n').filter(isChordLine);if(!text||!chordLines.length){method='OCR';const dir=await mkdtemp(join(tmpdir(),'songbook-ocr-'));try{await execFileAsync('/usr/bin/pdftoppm',['-png','-r','300',row.pdf_path,join(dir,'page')],{maxBuffer:10*1024*1024});const pages=(await readdir(dir)).filter(name=>name.endsWith('.png')).sort();const outputs=[];for(const page of pages){let result;try{result=await execFileAsync('/usr/bin/tesseract',[join(dir,page),'stdout','-l','deu+eng','--psm','6','preserve_interword_spaces=1'],{maxBuffer:20*1024*1024})}catch{result=await execFileAsync('/usr/bin/tesseract',[join(dir,page),'stdout','-l','eng','--psm','6','preserve_interword_spaces=1'],{maxBuffer:20*1024*1024})}outputs.push(result.stdout.trim())}text=outputs.join('\n\n').trim()}finally{await rm(dir,{recursive:true,force:true})}chordLines=text.split('\n').filter(isChordLine)}if(!text)return json(res,422,{error:'Aus dieser PDF konnte kein Text erkannt werden.'});return json(res,200,{text,method,chordCount:chordLines.reduce((sum,line)=>sum+chordTokens(line).length,0),chordLines:chordLines.length})}
  const variantMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/variants$/)
  if(req.method==='POST'&&variantMatch){const b=await bodyJson(req);if(pitchMap[b.sourceKey]===undefined||pitchMap[b.targetKey]===undefined)return json(res,400,{error:'Ungültige Tonart'});const content=transposeText(b.text,b.sourceKey,b.targetKey);db.prepare('INSERT INTO song_variants (song_id,target_key,source_key,content,created_at) VALUES (?,?,?,?,?) ON CONFLICT(song_id,target_key) DO UPDATE SET source_key=excluded.source_key,content=excluded.content,created_at=excluded.created_at').run(variantMatch[1],b.targetKey,b.sourceKey,content,new Date().toISOString());db.prepare('UPDATE songs SET source_key=?,preferred_key=?,song_key=? WHERE id=?').run(b.sourceKey,b.targetKey,b.targetKey,variantMatch[1]);return json(res,201,{targetKey:b.targetKey,sourceKey:b.sourceKey,content})}
  if(req.method==='GET'&&variantMatch){const rows=db.prepare('SELECT target_key AS targetKey,source_key AS sourceKey,created_at AS createdAt FROM song_variants WHERE song_id=? ORDER BY created_at DESC').all(variantMatch[1]);return json(res,200,rows)}
  const chartMatch=url.pathname.match(/^\/api\/songs\/([^/]+)\/chart$/)
  if(req.method==='GET'&&chartMatch){const key=url.searchParams.get('key');const row=db.prepare('SELECT s.title,v.content,v.target_key AS targetKey FROM song_variants v JOIN songs s ON s.id=v.song_id WHERE v.song_id=? AND v.target_key=?').get(chartMatch[1],key);if(!row)return json(res,404,{error:'Fassung nicht gefunden'});const escape=value=>value.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(row.title)} – ${escape(row.targetKey)}</title><style>body{margin:0;background:#f3f0e8;color:#171717;font:16px/1.45 ui-monospace,monospace}main{max-width:900px;margin:auto;background:white;min-height:100vh;padding:36px;box-sizing:border-box}h1{font:700 26px system-ui;margin:0 0 6px}.key{color:#785d1f;font:700 14px system-ui;margin-bottom:28px}pre{white-space:pre-wrap;font:inherit}@media print{body{background:white}main{padding:0}}</style></head><body><main><h1>${escape(row.title)}</h1><div class="key">Tonart: ${escape(row.targetKey)}</div><pre>${escape(row.content)}</pre></main></body></html>`)}
  const songMatch=url.pathname.match(/^\/api\/songs\/([^/]+)$/)
  if(req.method==='PATCH'&&songMatch){const b=await bodyJson(req);db.prepare('UPDATE songs SET title=?,artist=?,song_key=? WHERE id=? AND owner_id=?').run(b.title,b.artist||'Importierte PDF',b.key||'–',songMatch[1],user.id);return json(res,200,{...b,id:songMatch[1],hasPdf:1})}
  if(req.method==='DELETE'&&songMatch){const row=db.prepare('SELECT pdf_path,is_protected FROM songs WHERE id=? AND owner_id=?').get(songMatch[1],user.id);if(!row)return json(res,404,{error:'Nicht gefunden'});if(row.is_protected)return json(res,403,{error:'Dieser bestehende Admin-Song ist geschützt.'});db.exec('BEGIN');try{db.prepare('DELETE FROM song_variants WHERE song_id=?').run(songMatch[1]);db.prepare('DELETE FROM band_songs WHERE song_id=?').run(songMatch[1]);const all=db.prepare('SELECT id,song_ids,leaders,song_keys FROM sets').all();for(const set of all){const ids=JSON.parse(set.song_ids).filter(id=>id!==songMatch[1]);const leaders=JSON.parse(set.leaders||'{}');const songKeys=JSON.parse(set.song_keys||'{}');delete leaders[songMatch[1]];delete songKeys[songMatch[1]];db.prepare('UPDATE sets SET song_ids=?,leaders=?,song_keys=? WHERE id=?').run(JSON.stringify(ids),JSON.stringify(leaders),JSON.stringify(songKeys),set.id)}db.prepare('DELETE FROM songs WHERE id=? AND owner_id=?').run(songMatch[1],user.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}await unlink(row.pdf_path).catch(()=>{});return json(res,200,{ok:true})}
  if(req.method==='GET'&&url.pathname==='/api/sets'){const rows=(bandId?db.prepare('SELECT * FROM sets WHERE band_id=? ORDER BY created_at DESC').all(bandId):db.prepare('SELECT * FROM sets WHERE owner_id=? AND band_id IS NULL ORDER BY created_at DESC').all(user.id)).map(r=>({...r,isProtected:Boolean(r.is_protected),songIds:JSON.parse(r.song_ids),leaders:JSON.parse(r.leaders||'{}'),songKeys:JSON.parse(r.song_keys||'{}'),eventTime:r.event_time||'',techNotes:r.tech_notes||'',technicianId:r.technician_id||'',arrivalTime:r.arrival_time||'',createdAt:r.created_at,song_ids:undefined,song_keys:undefined,created_at:undefined,event_time:undefined,tech_notes:undefined,technician_id:undefined,arrival_time:undefined}));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/sets'){const b=await bodyJson(req);const set={id:randomUUID(),title:b.title,date:b.date,eventTime:b.eventTime||'',arrivalTime:b.arrivalTime||'',band:b.band||band?.name||'',theme:b.theme||'',venue:b.venue||'',techNotes:'',technicianId:'',songIds:[],leaders:{},songKeys:{},createdAt:new Date().toISOString(),isProtected:false,bandId:bandId||null};db.prepare('INSERT INTO sets (id,title,date,song_ids,created_at,leaders,event_time,tech_notes,technician_id,band,theme,venue,arrival_time,song_keys,owner_id,band_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(set.id,set.title,set.date,'[]',set.createdAt,'{}',set.eventTime,'','',set.band,set.theme,set.venue,set.arrivalTime,'{}',user.id,bandId||null);return json(res,201,set)}
  const setMatch=url.pathname.match(/^\/api\/sets\/([^/]+)$/)
  if(setMatch&&!(bandId?db.prepare('SELECT 1 FROM sets WHERE id=? AND band_id=?').get(setMatch[1],bandId):db.prepare('SELECT 1 FROM sets WHERE id=? AND owner_id=? AND band_id IS NULL').get(setMatch[1],user.id)))return json(res,404,{error:'Set nicht gefunden'})
  if(req.method==='PUT'&&setMatch){const b=await bodyJson(req);const availableSongs=(b.songIds||[]).filter(id=>bandId?db.prepare('SELECT 1 FROM band_songs WHERE song_id=? AND band_id=?').get(id,bandId):db.prepare('SELECT 1 FROM songs WHERE id=? AND owner_id=?').get(id,user.id));if(bandId)db.prepare('UPDATE sets SET title=?,date=?,song_ids=?,leaders=?,event_time=?,tech_notes=?,technician_id=?,band=?,theme=?,venue=?,arrival_time=?,song_keys=? WHERE id=? AND band_id=?').run(b.title,b.date,JSON.stringify(availableSongs),JSON.stringify(b.leaders||{}),b.eventTime||'',b.techNotes||'',b.technicianId||'',b.band||band.name,b.theme||'',b.venue||'',b.arrivalTime||'',JSON.stringify(b.songKeys||{}),setMatch[1],bandId);else db.prepare('UPDATE sets SET title=?,date=?,song_ids=?,leaders=?,event_time=?,tech_notes=?,technician_id=?,band=?,theme=?,venue=?,arrival_time=?,song_keys=? WHERE id=? AND owner_id=?').run(b.title,b.date,JSON.stringify(availableSongs),JSON.stringify(b.leaders||{}),b.eventTime||'',b.techNotes||'',b.technicianId||'',b.band||'',b.theme||'',b.venue||'',b.arrivalTime||'',JSON.stringify(b.songKeys||{}),setMatch[1],user.id);return json(res,200,{...b,songIds:availableSongs,id:setMatch[1]})}
  if(req.method==='DELETE'&&setMatch){const set=bandId?db.prepare('SELECT is_protected FROM sets WHERE id=? AND band_id=?').get(setMatch[1],bandId):db.prepare('SELECT is_protected FROM sets WHERE id=? AND owner_id=?').get(setMatch[1],user.id);if(set.is_protected)return json(res,403,{error:'Dieses bestehende Admin-Set ist geschützt.'});db.prepare('DELETE FROM appointments WHERE set_id=?').run(setMatch[1]);db.prepare('DELETE FROM sets WHERE id=?').run(setMatch[1]);return json(res,200,{ok:true})}
  if(req.method==='GET'&&url.pathname==='/api/team'){const rows=(bandId?db.prepare('SELECT t.id,t.name,t.initials,t.roles,t.is_leader AS isLeader,t.is_organizer AS isOrganizer,t.is_designer AS isDesigner,t.is_technician AS isTechnician,t.photo_path IS NOT NULL AS hasPhoto,t.created_at AS createdAt FROM team t JOIN band_team bt ON bt.team_id=t.id WHERE bt.band_id=? ORDER BY t.name').all(bandId):db.prepare('SELECT id,name,initials,roles,is_leader AS isLeader,is_organizer AS isOrganizer,is_designer AS isDesigner,is_technician AS isTechnician,photo_path IS NOT NULL AS hasPhoto,created_at AS createdAt FROM team WHERE owner_id=? ORDER BY name').all(user.id)).map(m=>({...m,initials:m.initials||makeInitials(m.name),roles:JSON.parse(m.roles),isLeader:Boolean(m.isLeader),isOrganizer:Boolean(m.isOrganizer),isDesigner:Boolean(m.isDesigner),isTechnician:Boolean(m.isTechnician),hasPhoto:Boolean(m.hasPhoto)}));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/team'){const request=new Request(url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'});const form=await request.formData();const name=String(form.get('name')||'').trim();if(name.length<2||name.length>100)return json(res,400,{error:'Der Name muss zwischen 2 und 100 Zeichen lang sein.'});const id=randomUUID();const photo=form.get('photo');let photoPath=null,photoMime=null;if(photo&&photo.size){const type=String(photo.type||'').toLowerCase();if(!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type)||photo.size>30*1024*1024)return json(res,400,{error:'Bitte ein unterstütztes Bild bis maximal 30 MB verwenden.'});photoPath=`${root}/team-${id}`;photoMime=type;await writeFile(photoPath,Buffer.from(await photo.arrayBuffer()))}const member={id,name,initials:makeInitials(name),roles:JSON.parse(form.get('roles')||'[]'),isLeader:form.get('isLeader')==='true',isOrganizer:form.get('isOrganizer')==='true',isDesigner:form.get('isDesigner')==='true',isTechnician:form.get('isTechnician')==='true',hasPhoto:Boolean(photoPath),createdAt:new Date().toISOString()};db.prepare('INSERT INTO team (id,name,initials,roles,is_leader,is_organizer,photo_path,photo_mime,created_at,is_designer,is_technician,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,member.name,member.initials,JSON.stringify(member.roles),member.isLeader?1:0,member.isOrganizer?1:0,photoPath,photoMime,member.createdAt,member.isDesigner?1:0,member.isTechnician?1:0,user.id);if(bandId)db.prepare('INSERT INTO band_team VALUES (?,?)').run(bandId,id);return json(res,201,member)}
  const teamPhoto=url.pathname.match(/^\/api\/team\/([^/]+)\/photo$/);if(req.method==='GET'&&teamPhoto){const m=bandId?db.prepare('SELECT t.photo_path,t.photo_mime FROM team t JOIN band_team bt ON bt.team_id=t.id WHERE t.id=? AND bt.band_id=?').get(teamPhoto[1],bandId):db.prepare('SELECT photo_path,photo_mime FROM team WHERE id=? AND owner_id=?').get(teamPhoto[1],user.id);if(!m?.photo_path)return json(res,404,{error:'Kein Bild'});res.writeHead(200,{'content-type':m.photo_mime||'image/jpeg','cache-control':'private,max-age=3600'});return res.end(await readFile(m.photo_path))}
  const teamMatch=url.pathname.match(/^\/api\/team\/([^/]+)$/);if(req.method==='DELETE'&&teamMatch){if(bandId){if(!db.prepare('SELECT 1 FROM band_team WHERE band_id=? AND team_id=?').get(bandId,teamMatch[1]))return json(res,404,{error:'Teammitglied nicht gefunden'});db.prepare('DELETE FROM band_team WHERE band_id=? AND team_id=?').run(bandId,teamMatch[1]);const all=db.prepare('SELECT id,leaders FROM sets WHERE band_id=?').all(bandId);for(const set of all){const leaders=JSON.parse(set.leaders||'{}');for(const [songId,memberId] of Object.entries(leaders))if(memberId===teamMatch[1])delete leaders[songId];db.prepare('UPDATE sets SET leaders=? WHERE id=?').run(JSON.stringify(leaders),set.id)}return json(res,200,{ok:true})}const m=db.prepare('SELECT photo_path FROM team WHERE id=? AND owner_id=?').get(teamMatch[1],user.id);if(!m)return json(res,404,{error:'Teammitglied nicht gefunden'});db.prepare('DELETE FROM team WHERE id=? AND owner_id=?').run(teamMatch[1],user.id);const all=db.prepare('SELECT id,leaders FROM sets WHERE owner_id=?').all(user.id);for(const set of all){const leaders=JSON.parse(set.leaders||'{}');for(const [songId,memberId] of Object.entries(leaders))if(memberId===teamMatch[1])delete leaders[songId];db.prepare('UPDATE sets SET leaders=? WHERE id=? AND owner_id=?').run(JSON.stringify(leaders),set.id,user.id)}if(m?.photo_path)await unlink(m.photo_path).catch(()=>{});return json(res,200,{ok:true})}
  if(req.method==='GET'&&url.pathname==='/api/appointments'){const rows=(bandId?db.prepare('SELECT id,set_id AS setId,type,title,date,time,location,notes,created_at AS createdAt FROM appointments WHERE band_id=? ORDER BY date,time').all(bandId):db.prepare('SELECT id,set_id AS setId,type,title,date,time,location,notes,created_at AS createdAt FROM appointments WHERE owner_id=? AND band_id IS NULL ORDER BY date,time').all(user.id));return json(res,200,rows)}
  if(req.method==='POST'&&url.pathname==='/api/appointments'){const b=await bodyJson(req);if(!(bandId?db.prepare('SELECT 1 FROM sets WHERE id=? AND band_id=?').get(b.setId,bandId):db.prepare('SELECT 1 FROM sets WHERE id=? AND owner_id=?').get(b.setId,user.id)))return json(res,400,{error:'Set nicht gefunden'});const item={id:randomUUID(),setId:b.setId,type:b.type,title:b.title,date:b.date,time:b.time||'',location:b.location||'',notes:b.notes||'',createdAt:new Date().toISOString()};db.prepare('INSERT INTO appointments (id,set_id,type,title,date,time,location,notes,created_at,owner_id,band_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(item.id,item.setId,item.type,item.title,item.date,item.time,item.location,item.notes,item.createdAt,user.id,bandId||null);return json(res,201,item)}
  const appointmentMatch=url.pathname.match(/^\/api\/appointments\/([^/]+)$/);if(req.method==='DELETE'&&appointmentMatch){if(bandId)db.prepare('DELETE FROM appointments WHERE id=? AND band_id=?').run(appointmentMatch[1],bandId);else db.prepare('DELETE FROM appointments WHERE id=? AND owner_id=?').run(appointmentMatch[1],user.id);return json(res,200,{ok:true})}
  return json(res,404,{error:'Nicht gefunden'})
} catch(e){console.error(e);json(res,500,{error:'Interner Serverfehler.'})} }).listen(8791,'127.0.0.1',()=>console.log('Songbook API on 127.0.0.1:8791'))
