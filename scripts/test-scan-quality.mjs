import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { detectDocumentQuad, isValidScanQuad, scanSharpness, warpRgba } from '../app/src/documentDetect.js'
import { pushQuadSample, LIVE_STABLE_HITS } from '../app/src/liveScanGeometry.js'
import { performanceFixture } from './lib/performance-fixture.mjs'

const width=240,height=320
function sheet(background=190) {
  const gray=new Uint8Array(width*height).fill(background)
  for(let y=35;y<=280;y++)for(let x=35;x<=200;x++)gray[y*width+x]=245
  for(let y=55;y<265;y+=12)for(let x=48;x<190;x++)gray[y*width+x]=12
  return gray
}
const gray=sheet()
assert.ok(detectDocumentQuad(gray,width,height),'page on a light grey table must be detected')
const blank=sheet(); for(let y=55;y<265;y++)for(let x=48;x<190;x++)blank[y*width+x]=245
assert.ok(scanSharpness(gray,width,height)>35)
assert.ok(scanSharpness(blank,width,height)<35,'a sharp paper edge must not mask a blurred/blank interior')
const irregular=new Uint8Array(width*height).fill(30)
for(let y=40;y<280;y++)for(let x=40;x<200;x++)if(Math.hypot((x-120)/80,(y-160)/120)<1)irregular[y*width+x]=245
assert.equal(detectDocumentQuad(irregular,width,height),null,'a bright rounded object must not become a twisted sheet')
const quad=[[35,35],[200,35],[200,280],[35,280]]
assert.equal(isValidScanQuad([quad[0],quad[2],quad[1],quad[3]],width,height),false)
assert.equal(isValidScanQuad([[NaN,0],...quad.slice(1)],width,height),false)
const rgba=new Uint8ClampedArray(width*height*4).fill(255)
// Distinct corner colours catch mirrored/rotated output, not just crop dimensions.
const colours=[[255,0,0],[0,200,0],[0,0,255],[230,200,0]]
quad.forEach(([x,y],corner)=>{for(let j=-6;j<=6;j++)for(let i=-6;i<=6;i++)rgba.set([...colours[corner],255],((y+j)*width+x+i)*4)})
const warped=warpRgba(rgba,width,height,quad)
const outputCorners=[[1,1],[warped.width-2,1],[warped.width-2,warped.height-2],[1,warped.height-2]]
outputCorners.forEach(([x,y],i)=>assert.deepEqual([...warped.data.slice((y*warped.width+x)*4,(y*warped.width+x)*4+3)],colours[i]))
let history=[]
for(let i=0;i<LIVE_STABLE_HITS;i++) history=pushQuadSample(history,quad.map(([x,y])=>[x+i*4,y]),width,height)
assert.ok(history.length<LIVE_STABLE_HITS,'slow continuous drift must not trigger capture')
console.log('OK bright-table detection, irregular-object rejection, interior sharpness, winding/colour geometry and slow movement')

const dir=await mkdtemp(join(tmpdir(),'songbook-scan-quality-'))
let fixture
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout}
try {
  const png=join(dir,'page.png'),jpg=join(dir,'page.jpg')
  run('python3',['-c',`
from PIL import Image,ImageDraw
import sys
p=Image.new('RGB',(480,680),(35,40,45));d=ImageDraw.Draw(p)
d.rectangle((50,60,430,620),fill=(242,239,220))
d.text((58,64),'C   G/B   Am7   F#dim',fill=(12,12,12))
d.text((58,110),'Exact lyrics and spacing',fill=(12,12,12))
d.line((51,61,425,61),fill=(160,161,162),width=1)
p.save(sys.argv[1]);p.save(sys.argv[2],quality=94,subsampling=0)
`,png,jpg])
  const pdf=join(dir,'reviewed.pdf')
  run('python3',['scan_to_pdf.py',pdf,'--preserve',png,jpg])
  run('pdfimages',['-png','-j',pdf,join(dir,'saved')])
  assert.deepEqual(await readFile(join(dir,'saved-001.jpg')),await readFile(jpg),'reviewed JPEG bytes must be embedded without recompression')
  run('python3',['-c',`
from PIL import Image,ImageChops
import sys
a=Image.open(sys.argv[1]).convert('RGB');b=Image.open(sys.argv[2]).convert('RGB')
assert a.size==b.size and ImageChops.difference(a,b).getbbox() is None, 'reviewed PNG pixels changed'
`,png,join(dir,'saved-000.png')])
  run('pdftoppm',['-f','1','-singlefile','-scale-to','680','-png',pdf,join(dir,'render')])
  console.log('OK saved PDF: PNG pixels identical, JPEG bytes identical, rendered with Poppler')

  const previous=process.env.SONGBOOK_OCR_PYTHON
  process.env.SONGBOOK_OCR_PYTHON=run('python3',['-c','import sys; print(sys.executable)']).trim()
  try{fixture=await performanceFixture()}finally{if(previous===undefined)delete process.env.SONGBOOK_OCR_PYTHON;else process.env.SONGBOOK_OCR_PYTHON=previous}
  async function upload(processing){const form=new FormData();form.set('title','Reviewed scan');form.set('pageProcessing',processing);form.append('pages',new Blob([await readFile(png)],{type:'image/png'}),'page.png');return fetch(fixture.base+'/api/scans',{method:'POST',headers:{cookie:fixture.owner.cookie,origin:fixture.base},body:form})}
  const invalid=await upload('silently-crop-again');assert.equal(invalid.status,400)
  const result=await upload('preserve');const song=await result.json();assert.equal(result.status,201,JSON.stringify(song))
  const db=new DatabaseSync(join(fixture.dataDir,'songbook.sqlite'));const row=db.prepare('SELECT pdf_path FROM songs WHERE id=?').get(song.id);db.close()
  run('pdfimages',['-png',row.pdf_path,join(dir,'api')])
  run('python3',['-c',`from PIL import Image,ImageChops;import sys;a=Image.open(sys.argv[1]);b=Image.open(sys.argv[2]);assert a.size==b.size and ImageChops.difference(a,b).getbbox() is None`,png,join(dir,'api-000.png')])
  console.log('OK isolated authenticated scan API stores the reviewed image unchanged and rejects invalid processing mode')
}finally{await fixture?.close();await rm(dir,{recursive:true,force:true})}
