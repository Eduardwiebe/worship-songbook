import { useEffect, useRef, useState } from 'react'
import { cropScanFile, inspectScanFile, isValidScanQuad } from './documentDetect'
import { useI18n } from './i18n'
import './scanCropEditor.css'

/** Every correction starts from the source photo, never from a previous crop. */
export function ScanCropEditor({ sourceFile, onConfirm, onCancel, canTakeAnother = false }) {
  const { t } = useI18n()
  const [source, setSource] = useState(null)
  const [quad, setQuad] = useState(null)
  const [whole, setWhole] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(null)
  const sheet = useRef(null)
  const sourceUrl = useRef('')
  const previewUrl = useRef('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    sourceUrl.current = URL.createObjectURL(sourceFile)
    inspectScanFile(sourceFile).then(info => {
      if (!alive.current) return
      const inset = [[.03, .03], [.97, .03], [.97, .97], [.03, .97]]
        .map(([x, y]) => [x * (info.width - 1), y * (info.height - 1)])
      setSource({ ...info, url: sourceUrl.current })
      setQuad(info.quad || inset)
      setWhole(!info.quad)
    }).catch(() => { if (alive.current) setError(t('scan.cropFailed')) })
    return () => {
      alive.current = false
      URL.revokeObjectURL(sourceUrl.current)
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    }
  }, [sourceFile, t])
  const valid = source && (whole || isValidScanQuad(quad, source.width, source.height))
  function changeCorner(index, x, y) {
    setQuad(current => current.map((p, i) => i === index ? [
      Math.max(0, Math.min(source.width - 1, x)),
      Math.max(0, Math.min(source.height - 1, y)),
    ] : p))
    setWhole(false)
  }
  function movePointer(event, index) {
    const rect = sheet.current.getBoundingClientRect()
    changeCorner(index, (event.clientX - rect.left) / rect.width * (source.width - 1),
      (event.clientY - rect.top) / rect.height * (source.height - 1))
  }
  function bookPage(right) {
    const outer = source.quad || [[0,0],[source.width-1,0],[source.width-1,source.height-1],[0,source.height-1]]
    const mid = (a,b) => [(a[0]+b[0])/2,(a[1]+b[1])/2]
    const top = mid(outer[0],outer[1]), bottom = mid(outer[3],outer[2])
    setQuad(right ? [top,outer[1],outer[2],bottom] : [outer[0],top,bottom,outer[3]])
    setWhole(false)
  }
  async function makePreview() {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const file = await cropScanFile(sourceFile, whole ? null : quad, rotation)
      if (!alive.current) return
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = URL.createObjectURL(file)
      setPreview({ file, url: previewUrl.current, detected: !whole })
    } catch { if (alive.current) setError(t('scan.cropFailed')) }
    finally { if (alive.current) setBusy(false) }
  }
  function confirm(keepOpen) {
    if (!preview || busy) return
    onConfirm(preview.file, preview.detected, keepOpen, sourceFile)
  }
  return <section className="scan-crop-editor" role="dialog" aria-modal="true" aria-label={t('scan.cropTitle')}>
    <header><strong>{t(preview ? 'scan.cropPreview' : 'scan.cropTitle')}</strong>
      <button type="button" onClick={onCancel} disabled={busy}>{t('common.back')}</button></header>
    <p className="scan-crop-hint">{t(preview ? 'scan.cropCheck' : 'scan.cropHint')}</p>
    <div className="scan-crop-stage">
      {preview ? <img className="scan-crop-result" src={preview.url} alt={t('scan.cropPreview')} /> : source &&
        <div className="scan-crop-sheet" ref={sheet} style={{ '--scan-aspect': source.width / source.height }}>
          <img src={source.url} alt={t('scan.cropSource')} draggable="false" />
          {!whole && <>
            <svg viewBox={`0 0 ${source.width - 1} ${source.height - 1}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={`M0 0 H${source.width - 1} V${source.height - 1} H0 Z M${quad.map(p => p.join(' ')).join(' L')} Z`} fill="rgba(0,0,0,.5)" fillRule="evenodd" />
              <polygon points={quad.map(p => p.join(',')).join(' ')} fill="none" stroke={valid ? '#82cfff' : '#ff7373'} strokeWidth={source.width * .004} />
            </svg>
            {quad.map(([x, y], index) => <button type="button" key={index} className="scan-crop-corner"
              aria-label={t('scan.cropCorner', { n: index + 1 })}
              style={{ left: `${x / (source.width - 1) * 100}%`, top: `${y / (source.height - 1) * 100}%` }}
              onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDrag(index) }}
              onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) movePointer(event, index) }}
              onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDrag(null) }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={event => {
                const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
                if (!delta) return
                event.preventDefault(); changeCorner(index, x + delta[0] * source.width * .005, y + delta[1] * source.height * .005)
              }}>{index + 1}</button>)}
            {drag !== null && <div className="scan-crop-loupe" aria-hidden="true" style={{
              backgroundImage: `url("${source.url}")`, backgroundSize: `${source.width / Math.max(source.width, source.height) * 1200}px ${source.height / Math.max(source.width, source.height) * 1200}px`,
              backgroundPosition: `${60 - quad[drag][0] / Math.max(source.width, source.height) * 1200}px ${60 - quad[drag][1] / Math.max(source.width, source.height) * 1200}px`,
            }} />}
          </>}
        </div>}
    </div>
    {source && Math.min(source.width, source.height) < 1200 && <p className="scan-crop-warning">{t('scan.lowResolution', { w: source.width, h: source.height })}</p>}
    {source && source.sharpness < 35 && <p className="scan-crop-warning">{t('scan.blurWarning')}</p>}
    {error && <p className="form-error">{error}</p>}
    <footer>
      {preview ? <>
        <button type="button" onClick={() => setPreview(null)}>{t('scan.cropAdjust')}</button>
        <button type="button" className="primary" onClick={() => confirm(false)}>{t('scan.liveUse')}</button>
        {canTakeAnother && <button type="button" onClick={() => confirm(true)}>{t('scan.liveAnother')}</button>}
      </> : <>
        <button type="button" onClick={() => bookPage(false)} disabled={!source || busy}>{t('scan.cropLeft')}</button>
        <button type="button" onClick={() => bookPage(true)} disabled={!source || busy}>{t('scan.cropRight')}</button>
        <button type="button" onClick={() => setWhole(v => !v)} disabled={!source || busy}>{t(whole ? 'scan.cropManual' : 'scan.cropWhole')}</button>
        <button type="button" onClick={() => { setQuad(source.quad || quad); setWhole(!source.quad); setRotation(0) }} disabled={!source || busy}>{t('scan.cropReset')}</button>
        <button type="button" onClick={() => setRotation(v => (v + 90) % 360)} disabled={!source || busy}>{t('scan.cropRotate', { n: rotation })}</button>
        <button type="button" className="primary" onClick={makePreview} disabled={!valid || busy}>{t(busy ? 'scan.detecting' : 'scan.cropPreview')}</button>
      </>}
    </footer>
  </section>
}
