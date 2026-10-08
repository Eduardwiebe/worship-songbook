import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { once } from 'node:events'
import { chromium } from '../app/node_modules/playwright/index.mjs'
import { performanceFixture } from './lib/performance-fixture.mjs'

const f=await performanceFixture()
const dist=new URL('../app/dist/',import.meta.url).pathname
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost')
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const c of req)chunks.push(c)
      const body=Buffer.concat(chunks)
      const upstream=await fetch(f.base+url.pathname+url.search,{method:req.method,headers:{...req.headers,host:new URL(f.base).host,origin:f.base},...(body.length?{body}:{})})
      res.writeHead(upstream.status,Object.fromEntries(upstream.headers));res.end(Buffer.from(await upstream.arrayBuffer()));return
    }
    let path=join(dist,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname));if(!path.startsWith(dist))throw new Error('Bad path')
    try{await stat(path)}catch{path=join(dist,'index.html')}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'}
    res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(await readFile(path))
  }catch(error){res.writeHead(500);res.end(error.message)}
})
server.listen(0,'127.0.0.1');await once(server,'listening')
const base=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true})
async function session(account){const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const [name,value]=account.cookie.split('=');await context.addCookies([{name,value,url:base},{name:'songbook_band',value:f.band,url:base}]);await context.addInitScript(()=>localStorage.setItem('songbook-locale','de'));return{context,page:await context.newPage()}}
let errors=[]
try{
  const {context,page}=await session(f.owner)
  page.on('pageerror',error=>errors.push(error.message))
  page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'Anna leitet · Bridge 2x':undefined))
  await page.goto(`${base}/#/songs/original/editor`)
  await page.getByRole('button',{name:'Notizen bearbeiten',exact:true}).click()
  await page.getByLabel('Gemeinsame Bandnotizen').fill('Anna leitet. Intro – Vers – Refrain – Bridge 2x.')
  const layer=page.getByLabel('Notizebene Seite 1')
  await layer.waitFor({state:'visible'})
  const box=await layer.boundingBox()

  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.35,{steps:10});await page.mouse.up()

  assert.equal(await layer.locator('polyline').count(),1)
  // Exercise actual touch input via Chromium's touch protocol, not a mouse-only simulation.
  const cdp=await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.2,y:box.y+box.height*.5}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.5,y:box.y+box.height*.55}]})
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  assert.equal(await layer.locator('polyline').count(),2)
  await page.getByLabel('Notizwerkzeug').selectOption('text');await layer.click({position:{x:box.width*.25,y:box.height*.7}})
  assert.equal(await layer.locator('text').textContent(),'Anna leitet · Bridge 2x')
  await page.getByRole('button',{name:'Rückgängig',exact:true}).click();assert.equal(await layer.locator('text').count(),0)
  await layer.click({position:{x:box.width*.25,y:box.height*.7}})
  await page.getByRole('button',{name:'Notizen speichern',exact:true}).click()
  await page.getByText('Notizen für die Band gespeichert',{exact:true}).waitFor()
  const stored=(await f.request('/api/songs/original/annotations',{cookie:f.member.cookie,headers:f.headers})).data
  assert.equal(stored.pages[0].length,3);assert.equal(stored.notes,'Anna leitet. Intro – Vers – Refrain – Bridge 2x.')
  await page.reload();await layer.locator('polyline').first().waitFor();assert.equal(await layer.locator('polyline').count(),2)
  const {page:memberPage}=await session(f.member)
  memberPage.on('dialog',dialog=>dialog.accept())
  await memberPage.goto(`${base}/#/songs/original/editor`);await memberPage.getByRole('button',{name:'Notizen bearbeiten',exact:true}).click()
  assert.equal(await memberPage.getByLabel('Gemeinsame Bandnotizen').inputValue(),stored.notes)
  await page.getByRole('button',{name:'Notizen bearbeiten',exact:true}).click()
  await page.getByLabel('Gemeinsame Bandnotizen').fill('Owner newer note')
  await page.getByRole('button',{name:'Notizen speichern',exact:true}).click();await page.getByText('Notizen für die Band gespeichert',{exact:true}).waitFor()
  await memberPage.getByLabel('Gemeinsame Bandnotizen').fill('Member conflict draft')
  await memberPage.getByRole('button',{name:'Notizen speichern',exact:true}).click();await memberPage.getByText(/Konflikt: Ein anderes Bandmitglied/).waitFor()
  assert.equal(await memberPage.getByLabel('Gemeinsame Bandnotizen').inputValue(),'Member conflict draft')
  await memberPage.reload();await memberPage.getByText(/Ungespeicherter Entwurf/).waitFor();assert.equal(await memberPage.getByLabel('Gemeinsame Bandnotizen').inputValue(),'Member conflict draft')
  await memberPage.getByRole('button',{name:'Gespeicherte Notizen laden',exact:true}).click();await memberPage.waitForFunction(()=>document.querySelector('[aria-label="Gemeinsame Bandnotizen"]')?.value==='Owner newer note')
  await page.goto(`${base}/#/sets/${f.set.id}`)
  await page.getByRole('button',{name:'Neue Auftrittsfassung freigeben',exact:true}).click()
  await page.getByText(/Auftrittsfassung v1 freigegeben/).waitFor()
  await page.getByRole('button',{name:'Diese Fassung offline laden',exact:true}).click()
  await page.getByText('Offline vollständig gespeichert · der Band bestätigt.',{exact:true}).waitFor()
  const frozen=(await f.request(`/api/sets/${f.set.id}/performances`,{cookie:f.owner.cookie,headers:f.headers})).data[0]
  const fresh=(await f.request('/api/songs/original/annotations',{cookie:f.owner.cookie,headers:f.headers})).data
  await f.request('/api/songs/original/annotations',{cookie:f.owner.cookie,headers:f.headers,method:'PUT',body:{...fresh,notes:'Not in published performance'}})
  await page.getByRole('button',{name:'Auftrittsfassung starten',exact:true}).click()
  await page.locator('.run-mode .annotation-shared-text').getByText('Owner newer note',{exact:true}).waitFor()
  assert.equal(await page.locator('.run-mode .annotation-layer polyline').count(),2)
  await page.locator('.run-mode').getByRole('button',{name:'Schließen',exact:true}).click()
  await page.evaluate(async()=>{await navigator.serviceWorker.ready})
  await context.setOffline(true)
  await page.reload({waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Auftrittsfassung starten',exact:true}).click()
  await page.locator('.run-mode .original-page-image').waitFor()
  await page.locator('.run-mode .annotation-shared-text').getByText('Owner newer note',{exact:true}).waitFor()
  assert.equal(await page.locator('.run-mode .annotation-layer text').textContent(),'Anna leitet · Bridge 2x')
  // Narrow phone rendering must preserve the original's aspect ratio and drawing alignment.
  await page.setViewportSize({width:390,height:844})
  const alignment=await page.locator('.run-mode .annotated-page').evaluate(el=>{const i=el.querySelector('img'),s=el.querySelector('svg');const a=i.getBoundingClientRect(),b=s.getBoundingClientRect();return{ratio:a.width/a.height,natural:i.naturalWidth/i.naturalHeight,aligned:Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1}})
  assert.ok(alignment.aligned);assert.ok(Math.abs(alignment.ratio-alignment.natural)<.02,JSON.stringify(alignment))
  assert.equal(frozen.songs[0].annotations.notes,'Owner newer note')
  await page.locator('.run-mode').getByRole('button',{name:'Schließen',exact:true}).click()
  const storedKey=`scope:${JSON.stringify([f.owner.user.id,f.band])}:performance-pages:${frozen.id}:original`
  await page.evaluate(async key=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('songbook-offline-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()},storedKey)
  await page.getByRole('button',{name:'Auftrittsfassung starten',exact:true}).click()
  await page.getByText('Diese Fassung ist auf diesem Gerät nicht vollständig gespeichert.',{exact:true}).waitFor()
  assert.equal(await page.locator('.run-mode').count(),0,'missing offline bytes must prevent a performance start')
  assert.deepEqual(errors,[])
  console.log('ok: production UI, mouse/touch/text/undo, shared persistence, conflict draft recovery, published notes and sheet, offline reload and phone alignment')
}finally{await browser.close();server.close();server.closeAllConnections();await f.close()}
