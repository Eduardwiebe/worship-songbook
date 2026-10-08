import { useEffect, useState } from 'react'
import { getPerformances, getPerformanceReceipts, performanceIsPrepared, preparePerformance, publishPerformance } from './bandNotesStore'
import { cacheContextToken, isProbablyOffline } from './offlineCache'

export function PerformancePanel({set,hasPending,onStart}) {
  const [versions,setVersions]=useState([]),[selected,setSelected]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[receipts,setReceipts]=useState([])
  const publication=versions.find(p=>p.id===selected)
  const refresh=async()=>{
    const token=cacheContextToken()
    try{const data=await getPerformances(set.id);if(token!==cacheContextToken())return;setVersions(data);setSelected(current=>data.some(p=>p.id===current)?current:data[0]?.id||'')}catch(error){setMessage(error.message)}
  }
  useEffect(()=>{refresh()},[set.id])
  useEffect(()=>{
    let active=true;setReady(false);setReceipts([])
    if(publication){performanceIsPrepared(publication).then(value=>{if(active)setReady(value)});if(!isProbablyOffline())getPerformanceReceipts(publication).then(data=>{if(active)setReceipts(data)}).catch(()=>{})}
    return()=>{active=false}
  },[publication])
  const publish=async()=>{
    if(hasPending()||busy)return
    setBusy(true);setMessage('Originale und Bandnotizen werden festgeschrieben …');const token=cacheContextToken()
    try{const created=await publishPerformance(set);if(token!==cacheContextToken())return;setSelected(created.id);await refresh();setMessage(`Auftrittsfassung v${created.version} freigegeben. Jedes Gerät muss diese Fassung offline laden.`)}catch(error){setMessage(error.message)}finally{setBusy(false)}
  }
  const prepare=async()=>{
    setBusy(true);setMessage('Diese Auftrittsfassung wird auf diesem Gerät gespeichert …');const token=cacheContextToken()
    try{const result=await preparePerformance(publication);if(token!==cacheContextToken())return;setReady(true);setMessage(result.reportedAt?'Offline vollständig gespeichert · der Band bestätigt.':'Offline vollständig gespeichert · Bestätigung an die Band noch ausstehend.');setReceipts(await getPerformanceReceipts(publication).catch(()=>[]))}catch(error){setReady(false);setMessage(error.message)}finally{setBusy(false)}
  }
  return <section className="panel performance-panel"><h2>Auftrittsfassung</h2><p>Freigeben hält Reihenfolge, Originalblätter, Songleitung, Einsatzhinweise und Bandnotizen fest. Weitere Änderungen bleiben im Entwurf.</p>
    <div className="performance-actions"><button type="button" disabled={busy||hasPending()||isProbablyOffline()||!set.songIds.length} onClick={publish}>Neue Auftrittsfassung freigeben</button><button type="button" disabled={busy||isProbablyOffline()} onClick={refresh}>Fassungen aktualisieren</button></div>
    {versions.length>0&&<><div className="performance-actions"><select aria-label="Auftrittsfassung wählen" value={selected} onChange={e=>setSelected(e.target.value)}>{versions.map(p=><option key={p.id} value={p.id}>v{p.version} · {new Date(p.createdAt).toLocaleString('de-DE')}</option>)}</select><button type="button" disabled={busy||!publication||isProbablyOffline()} onClick={prepare}>Diese Fassung offline laden</button><button type="button" disabled={busy||!publication||(isProbablyOffline()&&!ready)} onClick={async()=>{if(isProbablyOffline()&&!await performanceIsPrepared(publication)){setReady(false);setMessage('Diese Fassung ist auf diesem Gerät nicht vollständig gespeichert.');return}onStart(publication)}}>Auftrittsfassung starten</button></div><p className="performance-status">{ready?`v${publication?.version} auf diesem Gerät vollständig offline gespeichert`:`v${publication?.version} auf diesem Gerät noch nicht vollständig offline gespeichert`}</p><p>Bestätigungen zeigen den letzten gemeldeten Download. Der aktuelle Gerätespeicher wird nur auf dem jeweiligen Gerät geprüft.</p>{receipts.length>0&&<ul className="performance-receipts">{receipts.map(r=><li key={`${r.name}-${r.deviceId}`}>{r.name} · Gerät …{r.deviceId.slice(-6)} · {new Date(r.preparedAt).toLocaleString('de-DE')}</li>)}</ul>}</>}
    {message&&<p role="status">{message}</p>}
  </section>
}
