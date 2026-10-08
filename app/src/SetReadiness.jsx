import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, AlertCircle } from 'lucide-react'
import { apiFetch } from './apiConfig'
import { isProbablyOffline, prefetchSongOriginals } from './offlineCache'
import { evaluateSetReadiness, readSetOfflineStatus, songIsRehearsed } from './setReadiness'
import { useI18n } from './i18n'
import './setReadiness.css'

export function SetReadiness({ set, songs, team }) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshRef = useRef(null)
  const signature = JSON.stringify([set.id, set.songIds, songs.map((song) => [song.id, song.fileSize, song.fileName])])
  const checking = snapshot?.signature !== signature
  const status = checking ? {} : snapshot.status
  useEffect(() => {
    let active = true
    let revision = 0
    const refresh = async () => {
      const current = ++revision
      const next = await readSetOfflineStatus(set, songs)
      if (active && current === revision) setSnapshot({ signature, status: next })
    }
    refreshRef.current = refresh
    refresh()
    const onProgress = (event) => { if (event.detail?.status !== 'running') refresh() }
    window.addEventListener('songbook-offline-prep', onProgress)
    window.addEventListener('focus', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      active = false
      refreshRef.current = null
      window.removeEventListener('songbook-offline-prep', onProgress)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [set, songs, signature])
  const result = evaluateSetReadiness(set, songs, team, status)
  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      await prefetchSongOriginals(songs.filter((song) => set.songIds.includes(song.id)), { apiFetch, sets: [set] })
      await refreshRef.current?.()
    } catch { setError(t('readiness.failed')) }
    finally { setBusy(false) }
  }
  return <section className="panel set-readiness" aria-labelledby="set-readiness-title">
    <div className="readiness-heading">
      <div><p className="eyebrow">{t('readiness.eyebrow')}</p><h2 id="set-readiness-title">{t('readiness.title')}</h2></div>
      <button type="button" className="add-button compact" disabled={busy || checking || !result.entries.length || isProbablyOffline()} onClick={prepare}>
        <Download size={17}/>{t(busy ? 'readiness.preparing' : 'readiness.prepare')}
      </button>
    </div>
    <p className={`readiness-summary${!checking && result.sheetsReady ? ' is-ready' : ''}`} role="status">
      {!checking && result.sheetsReady ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}
      {checking ? t('readiness.checking') : t(result.sheetsReady ? 'readiness.stored' : 'readiness.count', { count: result.offlineCount, total: result.entries.length })}
    </p>
    <p className="readiness-hint">{t('readiness.hint')}</p>
    <p className="readiness-hint">{t('briefing.count', { count: result.entries.filter((entry) => songIsRehearsed(entry.song, set.songBriefings?.[entry.id])).length, total: result.entries.length })}</p>
    {!checking && result.entries.some((entry) => entry.issues.length) && <ul className="readiness-issues">
      {result.entries.filter((entry) => entry.issues.length).map((entry) => <li key={`${entry.id}-${entry.index}`}>
        <strong>{entry.index + 1}. {entry.song?.title || t('readiness.unknown')}</strong>
        <span>{entry.issues.map((issue) => t(`readiness.${issue}`)).join(' · ')}</span>
      </li>)}
    </ul>}
    {error && <p role="alert">{error}</p>}
  </section>
}
