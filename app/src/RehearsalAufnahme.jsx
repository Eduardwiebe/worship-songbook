import { useEffect, useRef, useState } from 'react'
import { Download, Mic, Pause, Play, Square } from 'lucide-react'
import { useI18n } from './i18n'
import {
  createRehearsalSession,
  deliverRecording,
  downloadBlob,
  formatElapsed,
  getRecording,
  listRecordingMeta,
  recordingErrorKey,
  saveRecording,
} from './rehearsalRecorder'

export function RehearsalAufnahme({ band = '', setTitle = '' }) {
  const { t } = useI18n()
  const sessionRef = useRef(null)
  const [phase, setPhase] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [canPause, setCanPause] = useState(true)
  const [latest, setLatest] = useState(null)
  const [recent, setRecent] = useState([])

  useEffect(() => {
    listRecordingMeta().then(setRecent).catch(() => {})
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return undefined
    const timer = window.setInterval(() => {
      setElapsed(sessionRef.current?.elapsedMs() || 0)
    }, 200)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => () => {
    const session = sessionRef.current
    sessionRef.current = null
    session?.dispose()?.then((result) => {
      if (result?.blob) saveRecording(result).catch(() => {})
    }).catch(() => {})
  }, [])

  async function start() {
    setError('')
    try {
      const session = createRehearsalSession({ band, title: setTitle })
      sessionRef.current = session
      const started = await session.start()
      if (!started) return
      setCanPause(started.canPause !== false)
      setElapsed(0)
      setPhase('recording')
    } catch (caught) {
      setPhase('idle')
      setError(t(recordingErrorKey(caught)))
    }
  }

  function pauseOrResume() {
    const session = sessionRef.current
    if (!session) return
    if (phase === 'recording') {
      session.pause()
      setElapsed(session.elapsedMs())
      setPhase('paused')
      return
    }
    session.resume()
    setPhase('recording')
  }

  async function finish(result) {
    if (!result?.blob) {
      setPhase('idle')
      return
    }
    setLatest(result)
    setPhase('idle')
    setElapsed(result.durationMs || 0)
    try {
      await saveRecording(result)
      setRecent(await listRecordingMeta())
    } catch (caught) {
      console.warn('[aufnahme] could not store recording', caught)
    }
    try {
      await deliverRecording(result.blob, result.name, result.mime)
    } catch (caught) {
      if (caught?.name === 'AbortError') return
      try { downloadBlob(result.blob, result.name) } catch { /* keep the save button */ }
    }
  }

  async function stop() {
    const session = sessionRef.current
    if (!session) return
    try {
      const result = await session.stop()
      await finish(result)
    } catch (caught) {
      setPhase('idle')
      setError(t('sets.recordError'))
      console.warn('[aufnahme] stop failed', caught)
    }
  }

  async function saveLatest() {
    if (!latest?.blob) return
    setError('')
    try {
      await deliverRecording(latest.blob, latest.name, latest.mime)
    } catch (caught) {
      if (caught?.name === 'AbortError') return
      setError(t('sets.recordError'))
    }
  }

  async function saveRecent(id) {
    if (!id) return
    setError('')
    try {
      const stored = await getRecording(id)
      if (!stored?.blob) return
      await deliverRecording(stored.blob, stored.name, stored.mime)
    } catch (caught) {
      if (caught?.name === 'AbortError') return
      setError(t('sets.recordError'))
    }
  }

  const recording = phase === 'recording' || phase === 'paused'

  return (
    <div className={`tool-group record-tool${phase === 'recording' ? ' is-recording' : ''}${phase === 'paused' ? ' is-paused' : ''}`} data-state={phase}>
      <span>{t('sets.record')}</span>
      {!recording && (
        <button type="button" onClick={start} aria-label={t('sets.recordStart')} title={t('sets.recordStart')}>
          <Mic size={18} />
        </button>
      )}
      {recording && (
        <span className="record-time" role="timer" aria-label={t('sets.recordElapsed')}>
          <i className="record-dot" aria-hidden="true" />
          {formatElapsed(elapsed)}
        </span>
      )}
      {recording && canPause && (
        <button type="button" onClick={pauseOrResume} aria-label={phase === 'paused' ? t('sets.recordResume') : t('sets.recordPause')} title={phase === 'paused' ? t('sets.recordResume') : t('sets.recordPause')}>
          {phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}
        </button>
      )}
      {recording && (
        <button type="button" className="record-stop" onClick={stop} aria-label={t('sets.recordStop')} title={t('sets.recordStop')}>
          <Square size={16} />
        </button>
      )}
      {!recording && latest?.blob && (
        <button type="button" onClick={saveLatest} aria-label={t('sets.recordDownload')} title={latest.name}>
          <Download size={18} />
        </button>
      )}
      {!recording && recent.length > 0 && (
        <select aria-label={t('sets.recordRecent')} value="" onChange={(event) => { const id = event.target.value; event.target.value = ''; saveRecent(id) }}>
          <option value="">{t('sets.recordRecent')}</option>
          {recent.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      )}
      {error && <p className="record-error" role="alert">{error}</p>}
    </div>
  )
}
