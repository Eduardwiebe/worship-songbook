import { useEffect, useRef, useState } from 'react'
import { getSongMusicXml } from './songStore'
import { useI18n } from './i18n'

/**
 * Real lead-sheet renderer (MusicXML + OpenSheetMusicDisplay).
 * This is not the chord-view chart.
 */
export function LeadSheetOsmd({ songId, targetKey, title }) {
  const { t } = useI18n()
  const hostRef = useRef(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let osmd = null
    ;(async () => {
      setLoading(true)
      setError('')
      setMissing(false)
      try {
        const xml = await getSongMusicXml(songId, targetKey)
        if (cancelled) return
        if (!xml || !/<score-partwise/i.test(xml) || !/<note[\s>]/i.test(xml)) {
          setMissing(true)
          setLoading(false)
          return
        }
        const mod = await import('opensheetmusicdisplay')
        if (cancelled || !hostRef.current) return
        const OSMD = mod.OpenSheetMusicDisplay || mod.default?.OpenSheetMusicDisplay
        if (!OSMD) throw new Error('OpenSheetMusicDisplay export missing')
        osmd = new OSMD(hostRef.current, {
          autoResize: true,
          backend: 'svg',
          drawingParameters: 'compact',
          drawTitle: false,
          drawSubtitle: false,
          drawComposer: false,
          drawLyricist: false,
          drawCredits: false,
          drawPartNames: false,
          drawMeasureNumbers: false,
        })
        const width = hostRef.current.clientWidth || 600
        osmd.zoom = width < 520 ? 0.78 : 1
        await osmd.load(xml)
        osmd.render()
        try { osmd.renderRemaining?.() } catch {}
        setLoading(false)
      } catch (caught) {
        if (!cancelled) {
          setError(caught?.message || t('songs.leadsheetMissing'))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
      try { osmd?.clear?.() } catch {}
    }
  }, [songId, targetKey, t])

  return (
    <article className="editor-paper leadsheet-paper">
      <header>
        <div>
          <h2>{title}</h2>
          <p className="chart-header-meta">{t('songs.leadsheetHint')}</p>
        </div>
      </header>
      {loading && <p className="leadsheet-status">{t('songs.preparing')}</p>}
      {missing && !loading && <p className="leadsheet-status">{t('songs.leadsheetMissing')}</p>}
      {error && !loading && <p className="leadsheet-status form-error">{error}</p>}
      <div className="osmd-host" ref={hostRef} hidden={missing || Boolean(error)} />
    </article>
  )
}
