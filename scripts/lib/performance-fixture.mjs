import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

export function testPdf(text = 'Band original') {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  const stream = `BT /F1 18 Tf 30 350 Td (${text}) Tj ET\n`
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object,i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
export async function performanceFixture() {
  const dataDir = await mkdtemp(join(tmpdir(),'songbook-performance-test-'))
  const child = spawn(process.execPath,['server.mjs'], { cwd: fileURLToPath(new URL('../..',import.meta.url)), env: {...process.env,SONGBOOK_DATA_DIR:dataDir,SONGBOOK_PORT:'0'}, stdio:['ignore','pipe','pipe'] })
  let output=''; child.stderr.on('data',c=>{output+=c})
  const close = async () => { if(child.exitCode===null){ child.kill(); await once(child,'exit') }; await rm(dataDir,{recursive:true,force:true}) }
  try {
    const port = await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(output)),15000)
      child.on('exit',()=>{clearTimeout(timer);reject(new Error(output))})
      child.stdout.on('data',c=>{output+=c;const match=output.match(/Songbook API on 127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[1])}})
    })
    const base=`http://127.0.0.1:${port}`
    async function request(path,{cookie,headers={},method='GET',body}={}) {
      const res=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})
      const data=res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer())
      return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0]}
    }
    async function account(username){const result=await request('/api/auth/register',{method:'POST',body:{name:username,username,email:`${username}@example.test`,password:'local-test-password'}});assert.equal(result.status,201,JSON.stringify(result.data));const user=(await request('/api/auth/me',{cookie:result.cookie})).data.user;return{cookie:result.cookie,user}}
    const owner=await account('bandnotesowner'),member=await account('bandnotesmember'),other=await account('bandnotesother')
    const band=(await request('/api/bands',{cookie:owner.cookie,method:'POST',body:{name:'Performance test band'}})).data.id
    const db=new DatabaseSync(join(dataDir,'songbook.sqlite'))
    db.prepare('INSERT INTO band_members VALUES (?,?,?,?)').run(band,member.user.id,'member',new Date().toISOString())
    const pdfPath=join(dataDir,'pdfs','original.pdf');const pdf=testPdf();await writeFile(pdfPath,pdf)
    db.prepare('INSERT INTO songs (id,title,artist,owner_id,file_name,file_size,pdf_path,song_key) VALUES (?,?,?,?,?,?,?,?)').run('original','Shared original','Band',owner.user.id,'original.pdf',pdf.length,pdfPath,'C')
    db.prepare('INSERT INTO band_songs VALUES (?,?)').run(band,'original')
    const headers={'X-Songbook-Band':band}
    let set=(await request('/api/sets',{cookie:owner.cookie,headers,method:'POST',body:{title:'Frozen concert',date:'2026-10-08'}})).data
    set=(await request(`/api/sets/${set.id}`,{cookie:owner.cookie,headers,method:'PUT',body:{...set,songIds:['original'],leaders:{original:'group'},songBriefings:{original:{cue:'Guitar starts',rehearsedRevision:''}}}})).data
    db.close()
    return {base,dataDir,request,close,owner,member,other,band,headers,set,pdfPath,pdf}
  } catch(error){await close();throw error}
}
