import { useI18n } from './i18n'
import { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { getPerformances, getPerformanceReceipts, performanceIsPrepared, preparePerformance, publishPerformance } from './bandNotesStore'
import { cacheContextToken, isProbablyOffline } from './offlineCache'

export function PerformancePanel({set,hasPending,onStart}) {
  const {t,locale}=useI18n()
  const [versions,setVersions]=useState([]),[selected,setSelected]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[receipts,setReceipts]=useState([])
  const activeSet=useRef(set.id),alive=useRef(true)
  useLayoutEffect(()=>{activeSet.current=set.id},[set.id])
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const publication=versions.find(p=>p.id===selected)
  const refresh=async()=>{
    const token=cacheContextToken(),setId=set.id
    try{const data=await getPerformances(setId);if(!alive.current||token!==cacheContextToken()||activeSet.current!==setId)return;setVersions(data);setSelected(current=>data.some(p=>p.id===current)?current:data[0]?.id||'')}catch(error){setMessage(error.message)}
  }
  useEffect(()=>{setVersions([]);setSelected('');setMessage('');setBusy(false);refresh()},[set.id])
  useEffect(()=>{
    let active=true;setReady(false);setReceipts([])
    if(publication){performanceIsPrepared(publication).then(value=>{if(active)setReady(value)});if(!isProbablyOffline())getPerformanceReceipts(publication).then(data=>{if(active)setReceipts(data)}).catch(()=>{})}
    return()=>{active=false}
  },[publication])
  const publish=async()=>{
    if(hasPending()||busy)return
    setBusy(true);setMessage(t('performance.publishing'));const token=cacheContextToken(),setId=set.id
    try{const created=await publishPerformance(set);if(!alive.current||token!==cacheContextToken()||activeSet.current!==setId)return;setSelected(created.id);await refresh();setMessage(t('performance.published',{version:created.version}))}catch(error){setMessage(error.message)}finally{setBusy(false)}
  }
  const prepare=async()=>{
    setBusy(true);setMessage(t('performance.preparing'));const token=cacheContextToken(),setId=set.id
    try{const result=await preparePerformance(publication);if(!alive.current||token!==cacheContextToken()||activeSet.current!==setId)return;setReady(true);setMessage(result.reportedAt?t('performance.reported'):t('performance.pending'));setReceipts(await getPerformanceReceipts(publication).catch(()=>[]))}catch(error){setReady(false);setMessage(error.message)}finally{setBusy(false)}
  }
  return <section className="panel performance-panel"><h2>{t('performance.title')}</h2><p>{t('performance.hint')}</p>
    <div className="performance-actions"><button type="button" disabled={busy||hasPending()||isProbablyOffline()||!set.songIds.length} onClick={publish}>{t('performance.publish')}</button><button type="button" disabled={busy||isProbablyOffline()} onClick={refresh}>{t('performance.refresh')}</button></div>
    {versions.length>0&&<><div className="performance-actions"><select aria-label={t('performance.select')} value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{versions.map(p=><option key={p.id} value={p.id}>v{p.version} · {new Date(p.createdAt).toLocaleString(locale==='en'?'en-GB':'de-DE')}</option>)}</select><button type="button" disabled={busy||!publication||isProbablyOffline()} onClick={prepare}>{t('performance.prepare')}</button><button type="button" disabled={busy||!publication||(isProbablyOffline()&&!ready)} onClick={async()=>{if(isProbablyOffline()&&!await performanceIsPrepared(publication)){setReady(false);setMessage(t('performance.incomplete'));return}onStart(publication)}}>{t('performance.start')}</button></div><p className="performance-status">{ready?t('performance.ready',{version:publication?.version}):t('performance.notReady',{version:publication?.version})}</p><p>{t('performance.receiptHint')}</p>{receipts.length>0&&<ul className="performance-receipts">{receipts.map(r=><li key={`${r.name}-${r.deviceId}`}>{r.name} · {t('performance.device')} …{r.deviceId.slice(-6)} · {new Date(r.preparedAt).toLocaleString(locale==='en'?'en-GB':'de-DE')}</li>)}</ul>}</>}
    {message&&<p role="status">{message}</p>}
  </section>
}
