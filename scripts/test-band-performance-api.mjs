import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { performanceFixture, testPdf } from './lib/performance-fixture.mjs'
const f=await performanceFixture()
try {
  const {request,owner,member,other,headers,set}=f
  const opts={cookie:owner.cookie,headers}
  const path='/api/songs/original/annotations'
  let notes=(await request(path,opts)).data
  const mark={id:'pen-one',kind:'stroke',color:'#d32f2f',width:.003,points:[[.1,.2],[.3,.4]]}
  const draft={...notes,notes:'Anna leads. Verse, Chorus, Bridge.',pages:{0:[mark]}}
  const parallel=await Promise.all([owner,member].map(account=>request(path,{cookie:account.cookie,headers,method:'PUT',body:draft})))
  assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409])
  notes=(await request(path,{cookie:member.cookie,headers})).data
  assert.equal(notes.revision,1);assert.deepEqual(notes.pages[0],[mark]);assert.equal(notes.notes,draft.notes)
  assert.equal((await request(path,{...opts,method:'PUT',body:{...notes,notes:'Revised'}})).data.revision,2)
  assert.equal((await request(path,{...opts,method:'PUT',body:notes})).status,409)
  assert.equal((await request(path,{...opts,method:'PUT',body:{...notes,revision:2,pages:{0:[{...mark,points:[[NaN,2]]}]}}})).status,400)
  assert.equal((await request(path,{cookie:other.cookie,headers})).status,403)
  const privateNotes=(await request(path,{cookie:owner.cookie,headers:{'X-Songbook-Band':'personal'}})).data
  assert.equal(privateNotes.revision,0);assert.equal(privateNotes.notes,'')
  const pubPath=`/api/sets/${set.id}/performances`
  assert.equal((await request(pubPath,{...opts,method:'POST',body:{}})).status,409)
  const pub=await request(pubPath,{...opts,method:'POST',body:{revision:set.revision}})
  assert.equal(pub.status,201,JSON.stringify(pub.data));assert.equal(pub.data.version,1)
  assert.equal(pub.data.songs[0].annotations.notes,'Revised');assert.equal(pub.data.songs[0].leader,'Alle gemeinsam')
  const frozenPdf=(await request(pub.data.songs[0].pdfUrl,{cookie:member.cookie,headers})).data
  assert.deepEqual(frozenPdf,f.pdf)
  const pages=await request(pub.data.songs[0].pagesUrl,{cookie:member.cookie,headers});assert.equal(pages.data.pages.length,1)
  assert.equal(pages.data.sourceHash,pub.data.songs[0].sourceHash)
  notes=(await request(path,opts)).data
  await request(path,{...opts,method:'PUT',body:{...notes,notes:'Changed after publication'}})
  const nextDraft=(await request(`/api/sets/${set.id}`,{...opts,method:'PUT',body:{...set,title:'New draft',songBriefings:{original:{cue:'Drums start'}}}})).data
  const second=await request(pubPath,{...opts,method:'POST',body:{revision:nextDraft.revision}})
  assert.equal(second.status,201);assert.equal(second.data.version,2)
  assert.equal(second.data.songs[0].annotations.notes,'Changed after publication')
  assert.equal((await request(`${pubPath}/${pub.data.id}`,{...opts,method:'PUT',body:{title:'overwrite'}})).status,405)
  assert.equal(testPdf('New original!').length,f.pdf.length)
  await writeFile(f.pdfPath,testPdf('New original!'))
  const stillFrozen=(await request(`${pubPath}/${pub.data.id}`,opts)).data
  assert.equal(stillFrozen.set.title,'Frozen concert');assert.equal(stillFrozen.set.songBriefings.original.cue,'Guitar starts')
  assert.equal(stillFrozen.songs[0].annotations.notes,'Revised');assert.deepEqual((await request(stillFrozen.songs[0].pdfUrl,opts)).data,f.pdf)
  assert.equal((await request(path,{...opts,method:'PUT',body:{...notes,revision:3}})).status,409,'changed content is detected even when filename and size are unchanged')
  assert.equal((await request(pubPath,{cookie:other.cookie,headers})).status,403)
  assert.equal((await request(`${pubPath}/${pub.data.id}`,{cookie:owner.cookie,headers:{'X-Songbook-Band':'personal'}})).status,404)
  await request(`${pubPath}/${pub.data.id}/receipts`,{cookie:member.cookie,headers,method:'POST',body:{deviceId:'tablet-test-123'}})
  const receipt=(await request(`${pubPath}/${pub.data.id}/receipts`,opts)).data[0];assert.equal(receipt.name,member.user.name);assert.ok(receipt.preparedAt)
  const db=new DatabaseSync(join(f.dataDir,'songbook.sqlite'));db.prepare('DELETE FROM band_songs WHERE song_id=?').run('original');db.prepare('DELETE FROM songs WHERE id=?').run('original');db.close()
  assert.equal((await request(pub.data.songs[0].pagesUrl,{cookie:member.cookie,headers})).status,200,'frozen original survives library deletion')
  assert.deepEqual(await readFile(f.pdfPath),testPdf('New original!'),'annotation writes never alter original')
  console.log('ok: shared pen/text annotations, CAS conflicts, scope isolation, immutable sheets/notes/set, content hashes, receipts and archived access after library deletion')
} finally {await f.close()}
