import { useEffect, useRef, useState } from 'react'
import { X, AudioLines } from 'lucide-react'
import { ModalBackdrop } from './ModalBackdrop'
import { dismissModal } from './modalLock'
import { useI18n } from './i18n'
import { GUITAR_STRINGS, startTunerMic } from './guitarTuner'

function centsClamp(cents) {
  if (!Number.isFinite(cents)) return 0
  return Math.max(-50, Math.min(50, cents))
}

function formatHz(hz) {
  if (!Number.isFinite(hz)) return '—'
  return hz < 100 ? hz.toFixed(1) : hz.toFixed(0)
}

function formatCents(cents) {
  if (!Number.isFinite(cents)) return '—'
  const abs = Math.abs(cents)
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : ''
  return `${sign}${abs}¢`
}

export function GuitarTunerModal({ onClose }) {
  const { t } = useI18n()
  const [status, setStatus] = useState('starting') // starting | listening | denied | unsupported | error | quiet
  const [note, setNote] = useState(null)
  const [stringHit, setStringHit] = useState(null)
  const [hz, setHz] = useState(null)
  const [cents, setCents] = useState(0)
  const controllerRef = useRef(null)

  const close = () => {
    controllerRef.current?.stop()
    controllerRef.current = null
    dismissModal(onClose)
  }

  useEffect(() => {
    let cancelled = false
    const controller = startTunerMic({
      onPitch: ({ hz: nextHz, note: nextNote, string: nextString, quiet }) => {
        if (cancelled) return
        if (quiet || !nextNote) {
          setStatus((prev) => (prev === 'listening' || prev === 'quiet' ? 'quiet' : prev))
          setNote(null)
          setStringHit(null)
          setHz(null)
          setCents(0)
          return
        }
        setStatus('listening')
        setNote(nextNote)
        setStringHit(nextString)
        setHz(nextHz)
        setCents(nextNote.cents)
      },
      onError: (error) => {
        if (cancelled) return
        const code = error?.message
        if (code === 'MIC_DENIED') setStatus('denied')
        else if (code === 'MIC_UNSUPPORTED') setStatus('unsupported')
        else setStatus('error')
      },
    })
    controllerRef.current = controller
    controller.start().then(() => {
      if (!cancelled) setStatus((prev) => (prev === 'starting' ? 'quiet' : prev))
    }).catch(() => {
      /* status set in onError */
    })

    return () => {
      cancelled = true
      controller.stop()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [])

  const needle = centsClamp(cents)
  const inTune = note && Math.abs(cents) <= 5
  const statusMessage = {
    starting: t('songs.tunerStarting'),
    quiet: t('songs.tunerListening'),
    listening: inTune ? t('songs.tunerInTune') : t('songs.tunerListening'),
    denied: t('songs.tunerMicDenied'),
    unsupported: t('songs.tunerMicUnsupported'),
    error: t('songs.tunerMicError'),
  }[status]

  return (
    <ModalBackdrop onClose={close} className="tuner-backdrop">
      <section className="modal tuner-modal" role="dialog" aria-modal="true" aria-labelledby="tuner-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{t('songs.tunerEyebrow')}</p>
            <h2 id="tuner-title">{t('songs.tunerTitle')}</h2>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>

        <div className={`tuner-display${inTune ? ' is-in-tune' : ''}`}>
          <div className="tuner-note-row">
            <AudioLines size={22} />
            <strong className="tuner-note">{note ? note.label : '–'}</strong>
            <span className="tuner-cents">{note ? formatCents(cents) : '—'}</span>
          </div>
          <div className="tuner-meter" aria-hidden="true">
            <div className="tuner-meter-track">
              <span className="tuner-meter-mark left">−50</span>
              <span className="tuner-meter-center" />
              <span className="tuner-meter-mark right">+50</span>
              <span
                className={`tuner-needle${note ? ' is-active' : ''}`}
                style={{ transform: `translateX(-50%) translateX(${(needle / 50) * 100}%)` }}
              />
            </div>
          </div>
          <p className="tuner-hz">{hz != null ? `${formatHz(hz)} Hz · A4=440` : 'A4 = 440 Hz'}</p>
          <p className={`tuner-status status-${status}`} role="status">{statusMessage}</p>
        </div>

        <div className="tuner-strings" aria-label={t('songs.tunerStringsAria')}>
          {GUITAR_STRINGS.map((string) => {
            const active = stringHit?.name === string.name && Math.abs(stringHit.cents) < 50
            const tuned = active && Math.abs(stringHit.cents) <= 5
            return (
              <div
                key={string.name}
                className={`tuner-string${active ? ' is-active' : ''}${tuned ? ' is-tuned' : ''}`}
                title={`${string.name} · ${string.hz.toFixed(1)} Hz`}
              >
                <strong>{string.name.replace(/[0-9]/g, '')}</strong>
                <small>{string.name}</small>
              </div>
            )
          })}
        </div>

        <p className="tuner-hint">{t('songs.tunerHint')}</p>
        <div className="modal-actions">
          <button type="button" className="add-button compact" onClick={close}>{t('common.close')}</button>
        </div>
      </section>
    </ModalBackdrop>
  )
}
