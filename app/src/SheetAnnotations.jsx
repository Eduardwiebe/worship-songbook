import { useEffect, useRef, useState } from 'react'
import { cacheContextToken, cacheGetList, cachePutList } from './offlineCache'
import { draftKey, getSongAnnotations, saveSongAnnotations } from './bandNotesStore'
import './sheetAnnotations.css'

export function useSheetAnnotations(songId, editable, frozen) {
  const [doc,setDoc]=useState(null),[editing,setEditing]=useState(false),[dirty,setDirty]=useState(false),[status,setStatus]=useState(''),[saving,setSaving]=useState(false)
  const generation=useRef(0),editRevision=useRef(0),savedDoc=useRef(null),currentState=useRef({dirty,editing})
  currentState.current={dirty,editing}
  const load=async(restoreDraft=false)=>{
    const token=cacheContextToken(),generationId=++generation.current
    try {
      const fresh=await getSongAnnotations(songId)
      const draft=restoreDraft&&editable?await cacheGetList(draftKey(songId)):null
      if(token!==cacheContextToken()||generationId!==generation.current)return
      savedDoc.current=fresh
      if(draft?.document){setDoc(draft.document);setDirty(true);setEditing(true);setStatus('Ungespeicherter Entwurf auf diesem Gerät wiederhergestellt.')}else{setDoc(fresh);setDirty(false);setStatus('')}
    }catch(error){if(generationId===generation.current)setStatus(error.message)}
  }
  useEffect(()=>{
    setEditing(false);setDirty(false);setDoc(frozen||null);setStatus('');savedDoc.current=frozen||null
    if(!frozen)load(true)
    const onSaved=(e)=>{if(e.detail===songId&&!currentState.current.dirty&&!currentState.current.editing&&!frozen)load(false)}
    window.addEventListener('songbook-annotations-saved',onSaved)
    return()=>{generation.current++;window.removeEventListener('songbook-annotations-saved',onSaved)}
  },[songId,frozen])
  useEffect(()=>{
    if(!dirty)return
    const warn=(e)=>{e.preventDefault();e.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return()=>window.removeEventListener('beforeunload',warn)
  },[dirty])
  // Persist immediately with the captured scope. Saved drafts survive an offline restart.
  const change=(next)=>{
    editRevision.current++;setDoc(next);setDirty(true);setStatus('Entwurf auf diesem Gerät · noch nicht für die Band gespeichert')
    cachePutList(draftKey(songId),{document:next}).catch(()=>{})
  }
  const save=async()=>{
    if(saving||!doc)return
    setSaving(true);setStatus('Notizen werden gespeichert …');const revision=editRevision.current,token=cacheContextToken()
    try{
      const saved=await saveSongAnnotations(songId,doc)
      if(token!==cacheContextToken())return
      savedDoc.current=saved
      if(revision===editRevision.current){setDoc(saved);setDirty(false);setStatus('Notizen für die Band gespeichert')}else{setDoc(current=>{const next={...current,revision:saved.revision};cachePutList(draftKey(songId),{document:next});return next});setStatus('Neuere Änderungen sind noch nicht gespeichert.')}
    }catch(error){if(token===cacheContextToken())setStatus(error.status===409?'Konflikt: Ein anderes Bandmitglied hat die Notizen geändert. Dein Entwurf bleibt erhalten.':`Nicht gespeichert: ${error.message}`)}finally{setSaving(false)}
  }
  const reload=()=>{if(!dirty||window.confirm('Deinen Entwurf verwerfen und die gespeicherten Bandnotizen laden?')){cachePutList(draftKey(songId),null);load(false)}}
  const stale=doc&&doc.currentSourceHash&&doc.sourceHash!==doc.currentSourceHash
  return {doc,visible:stale?null:doc,editing,dirty,status,saving,change,save,reload,stale,toggle:()=>setEditing(e=>!e),adopt:()=>{if(window.confirm('Die Notizen auf das geänderte Original übernehmen? Prüfe anschließend ihre Position.'))change({...doc,sourceHash:doc.currentSourceHash})}}
}
export function AnnotationToolbar({state}) {
  const {doc,editing,dirty,status,saving,stale}=state
  const [tool,setTool]=useState('pen'),[color,setColor]=useState('#d32f2f')
  return <div className="annotation-controls">
    <div className="annotation-toolbar"><button type="button" onClick={state.toggle} disabled={!doc?.sourceHash} aria-pressed={editing}>{editing?'Lesemodus':'Notizen bearbeiten'}</button>
      {editing&&<><select aria-label="Notizwerkzeug" value={tool} onChange={e=>{setTool(e.target.value);state.setTool?.(e.target.value)}}><option value="pen">Stift / Finger</option><option value="text">Text auf dem Blatt</option><option value="erase">Markierung löschen</option><option value="scroll">Blättern / Scrollen</option></select><select aria-label="Notizfarbe" value={color} onChange={e=>{setColor(e.target.value);state.setColor?.(e.target.value)}}><option value="#d32f2f">Rot</option><option value="#1565c0">Blau</option><option value="#111111">Schwarz</option><option value="#2e7d32">Grün</option></select><button type="button" onClick={state.undo} disabled={!state.canUndo}>Rückgängig</button><button type="button" onClick={state.save} disabled={!dirty||saving||stale}>{saving?'Speichert …':'Notizen speichern'}</button><button type="button" onClick={state.reload} disabled={saving}>Gespeicherte Notizen laden</button></>}
    </div>
    {editing&&<label className="annotation-notes">Gemeinsame Bandnotizen · Songleitung, Struktur & Arrangement<textarea aria-label="Gemeinsame Bandnotizen" maxLength={5000} rows={2} value={doc?.notes||''} onChange={e=>state.change({...doc,notes:e.target.value})}/></label>}
    {stale&&<p role="alert">Das Original wurde geändert. Notizen zuerst prüfen. <button type="button" onClick={state.adopt}>Dem neuen Original zuordnen</button></p>}
    {status&&<p role="status">{status}</p>}
  </div>
}
export function AnnotatedPage({page,index,title,document,editing=false,tool='pen',color='#d32f2f',onChange,onBeforeChange}) {
  const [size,setSize]=useState({width:300,height:420}),[fit,setFit]=useState(null),[stroke,setStroke]=useState(null)
  const pageRef=useRef(null)
  useEffect(()=>{
    const container=pageRef.current?.parentElement
    if(!container)return
    const resize=()=>{const ratio=size.width/size.height;const width=Math.min(container.clientWidth,container.clientHeight*ratio);setFit({width:Math.max(1,width),height:Math.max(1,width/ratio)})}
    const observer=new ResizeObserver(resize);observer.observe(container);resize()
    return()=>observer.disconnect()
  },[size.width,size.height])
  const svg=useRef(null),pending=useRef(null),pointer=useRef(null)
  const marks=document?.pages?.[index]||[]
  const position=(e)=>{const rect=svg.current.getBoundingClientRect();return[Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))]}
  const commit=(next)=>{onBeforeChange?.();onChange?.({...document,pages:{...document.pages,[index]:next}})}
  const draw=editing&&tool!=='scroll'
  const down=(e)=>{
    if(!draw||pointer.current!==null||(e.pointerType==='mouse'&&e.button!==0))return
    e.preventDefault();e.stopPropagation();pointer.current=e.pointerId;svg.current.setPointerCapture(e.pointerId)
    const [x,y]=position(e)
    if(tool==='text'){
      const text=window.prompt('Notiz auf dem Blatt (z. B. „Anna leitet“, „Bridge 2×“):')
      if(text?.trim())commit([...marks,{id:crypto.randomUUID(),kind:'text',x,y,text:text.trim().slice(0,300),color}])
      pointer.current=null;return
    }
    if(tool==='erase'){
      const id=e.target.closest?.('[data-mark-id]')?.getAttribute('data-mark-id')
      if(id)commit(marks.filter(m=>m.id!==id));pointer.current=null;return
    }
    pending.current={id:crypto.randomUUID(),kind:'stroke',points:[[x,y]],width:.003,color};setStroke(pending.current)
  }
  const move=(e)=>{
    if(e.pointerId!==pointer.current||!pending.current)return
    e.preventDefault();e.stopPropagation()
    const coalesced=e.nativeEvent?.getCoalescedEvents?.()
    const events=coalesced?.length?coalesced:[e]
    const points=[...pending.current.points,...events.map(position)].slice(0,2000)
    pending.current={...pending.current,points};setStroke(pending.current)
  }
  const finish=(e,cancel=false)=>{
    if(e.pointerId!==pointer.current)return
    e.stopPropagation();if(pending.current&&!cancel)commit([...marks,pending.current]);pending.current=null;pointer.current=null;setStroke(null)
  }
  const render=(mark)=>mark.kind==='text'?<text data-mark-id={mark.id} key={mark.id} x={mark.x*size.width} y={mark.y*size.height} fill={mark.color} fontSize={size.width*.025}>{mark.text}</text>:<polyline data-mark-id={mark.id} key={mark.id} points={mark.points.map(([x,y])=>`${x*size.width},${y*size.height}`).join(' ')} fill="none" stroke={mark.color} strokeWidth={mark.width*size.width} strokeLinecap="round" strokeLinejoin="round"/>
  return <div ref={pageRef} className={`annotated-page${draw?' is-drawing':''}`} style={{...fit,aspectRatio:`${size.width}/${size.height}`}}>
    <img src={page.dataUrl} alt={`${title||'Seite'} ${index+1}`} className="original-page-image" draggable={false} onLoad={e=>setSize({width:e.currentTarget.naturalWidth||300,height:e.currentTarget.naturalHeight||420})}/>
    <svg ref={svg} className="annotation-layer" viewBox={`0 0 ${size.width} ${size.height}`} aria-label={`Notizebene Seite ${index+1}`} style={{pointerEvents:draw?'auto':'none',touchAction:draw?'none':'pan-y'}} onPointerDown={down} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)}>{marks.map(render)}{stroke&&render(stroke)}</svg>
  </div>
}
