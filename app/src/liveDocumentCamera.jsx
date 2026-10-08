import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useI18n } from './i18n'
import { detectDocumentQuad, jpegFileFromRgba, scanSharpness } from './documentDetect'
import { ScanCropEditor } from './ScanCropEditor'
import { LIVE_STABLE_HITS, pushQuadSample, quadToViewPoints } from './liveScanGeometry'

const LIVE_LONG_SIDE = 480
const CAPTURE_LONG_SIDE = 4600
const ARM_MS = 900
const DETECT_MS = 140

function readAnalysisFrame(video, canvas) {
  const videoW = video.videoWidth
  const videoH = video.videoHeight
  if (!videoW || !videoH) return null
  const scale = Math.min(1, LIVE_LONG_SIDE / Math.max(videoW, videoH))
  const aw = Math.max(2, Math.round(videoW * scale))
  const ah = Math.max(2, Math.round(videoH * scale))
  canvas.width = aw
  canvas.height = ah
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, aw, ah)
  const rgba = ctx.getImageData(0, 0, aw, ah).data
  const gray = new Uint8Array(aw * ah)
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  }
  return { gray, aw, ah, videoW, videoH }
}

async function frameToFile(video) {
  // Freeze an uncut source frame so the user can recover every edge.
  const scale = Math.min(1, CAPTURE_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight))
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, width, height)
  const file = await jpegFileFromRgba(ctx.getImageData(0, 0, width, height).data, width, height, `scan-live-${Date.now()}.jpg`, .97)
  return { file, detected: false }
}

function paintOverlay(canvas, stage, video, quad, analysis, locked) {
  if (!canvas || !stage) return
  const viewW = stage.clientWidth
  const viewH = stage.clientHeight
  if (!viewW || !viewH) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pxW = Math.round(viewW * dpr)
  const pxH = Math.round(viewH * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewW, viewH)
  const points = quad && analysis && video?.videoWidth
    ? quadToViewPoints(quad, analysis.aw, analysis.ah, video.videoWidth, video.videoHeight, viewW, viewH)
    : null
  if (!points) {
    const guideW = Math.min(viewW, viewH) * 0.66
    const guideH = Math.min(viewH * 0.78, guideW * 1.35)
    const x = (viewW - guideW) / 2
    const y = (viewH - guideH) / 2
    ctx.setLineDash([9, 8])
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(126, 182, 255, 0.7)'
    ctx.strokeRect(x, y, guideW, guideH)
    ctx.setLineDash([])
    return
  }

  ctx.beginPath()
  ctx.rect(0, 0, viewW, viewH)
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < 4; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
  ctx.fillStyle = 'rgba(3, 8, 16, 0.46)'
  ctx.fill('evenodd')

  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < 4; i += 1) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
  ctx.save()
  ctx.shadowColor = 'rgba(28, 102, 220, 0.9)'
  ctx.shadowBlur = locked ? 28 : 18
  ctx.fillStyle = locked ? 'rgba(80, 160, 255, 0.38)' : 'rgba(61, 143, 255, 0.28)'
  ctx.fill()
  ctx.restore()
  ctx.lineJoin = 'round'
  ctx.lineWidth = locked ? 4 : 3
  ctx.strokeStyle = locked ? '#e7f3ff' : '#8ec2ff'
  ctx.stroke()
  for (const [x, y] of points) {
    ctx.beginPath()
    ctx.arc(x, y, locked ? 7 : 6, 0, Math.PI * 2)
    ctx.fillStyle = '#f4f8ff'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#2f7de0'
    ctx.stroke()
  }
}

export function LiveDocumentCamera({ stream, canTakeAnother, onAccept, onClose }) {
  const { t } = useI18n()
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const stageRef = useRef(null)
  const quadRef = useRef(null)
  const sampleRef = useRef(null)
  const historyRef = useRef([])
  const phaseRef = useRef('search')
  const captureRef = useRef(async () => {})
  const captureLock = useRef(false)
  const previewUrlRef = useRef('')
  const armedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const [phase, setPhase] = useState('search')
  const [hasQuad, setHasQuad] = useState(false)
  const [preview, setPreview] = useState(null)
  const [flash, setFlash] = useState(false)
  const [localError, setLocalError] = useState('')
  const [sharp, setSharp] = useState(true)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return undefined
    video.srcObject = stream
    const play = () => { video.play().catch(() => {}) }
    video.addEventListener('loadedmetadata', play)
    play()
    return () => {
      video.removeEventListener('loadedmetadata', play)
      video.srcObject = null
    }
  }, [stream])

  useEffect(() => () => {
    mountedRef.current = false
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
  }, [])

  useEffect(() => {
    const sampleCanvas = document.createElement('canvas')
    armedAtRef.current = performance.now() + ARM_MS
    let raf = 0
    const timer = window.setInterval(() => {
      if (phaseRef.current === 'capture' || phaseRef.current === 'preview') return
      const video = videoRef.current
      if (!video || video.readyState < 2) return
      try {
        const sample = readAnalysisFrame(video, sampleCanvas)
        if (!sample) return
        sampleRef.current = sample
        const quad = detectDocumentQuad(sample.gray, sample.aw, sample.ah)
        quadRef.current = quad
        const isSharp = scanSharpness(sample.gray, sample.aw, sample.ah, quad) >= 35
        setSharp(isSharp)
        const history = pushQuadSample(historyRef.current, quad, sample.aw, sample.ah)
        historyRef.current = history
        setHasQuad(Boolean(quad))
        if (!quad) {
          if (phaseRef.current !== 'search') {
            phaseRef.current = 'search'
            setPhase('search')
          }
          return
        }
        const stable = history.length >= LIVE_STABLE_HITS
        if (stable && isSharp && performance.now() >= armedAtRef.current) {
          captureRef.current()
          return
        }
        const next = stable ? 'locked' : 'hold'
        if (phaseRef.current !== next) {
          phaseRef.current = next
          setPhase(next)
        }
      } catch {
        /* keep the preview running */
      }
    }, DETECT_MS)

    const draw = () => {
      if (phaseRef.current !== 'preview') {
        paintOverlay(
          overlayRef.current,
          stageRef.current,
          videoRef.current,
          quadRef.current,
          sampleRef.current,
          phaseRef.current === 'locked' || phaseRef.current === 'capture',
        )
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      window.clearInterval(timer)
      cancelAnimationFrame(raf)
    }
  }, [stream])

  async function capture() {
    if (captureLock.current || phaseRef.current === 'preview') return
    const video = videoRef.current
    if (!video?.videoWidth) return
    captureLock.current = true
    phaseRef.current = 'capture'
    setPhase('capture')
    setFlash(true)
    window.setTimeout(() => {
      if (mountedRef.current) setFlash(false)
    }, 200)
    try {
      const shot = await frameToFile(video)
      if (!mountedRef.current) return
      const url = URL.createObjectURL(shot.file)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = url
      setPreview({ url, file: shot.file, detected: shot.detected })
      phaseRef.current = 'preview'
      setPhase('preview')
      setLocalError('')
    } catch {
      phaseRef.current = 'search'
      setPhase('search')
      setLocalError(t('scan.liveFailed'))
    } finally {
      captureLock.current = false
    }
  }
  useEffect(() => {
    captureRef.current = capture
  })

  function resetLive() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = ''
    setPreview(null)
    historyRef.current = []
    quadRef.current = null
    setHasQuad(false)
    armedAtRef.current = performance.now() + ARM_MS
    phaseRef.current = 'search'
    setPhase('search')
    setLocalError('')
  }

  const status = phase === 'preview'
    ? (preview?.detected ? t('scan.livePreviewTitle') : t('scan.livePreviewPlain'))
    : phase === 'capture' || phase === 'locked'
      ? t('scan.liveLocked')
      : phase === 'hold'
        ? t(sharp ? 'scan.liveHold' : 'scan.liveBlur')
        : t('scan.liveSearching')

  return (
    <div className="live-scan" role="dialog" aria-modal="true" aria-label={t('scan.liveTitle')}>
      <header className="live-scan-top">
        <button type="button" className="live-scan-close" onClick={onClose} aria-label={t('scan.liveClose')}><X size={20} /></button>
        <p className="live-scan-status">{status}</p>
      </header>
      <div className="live-scan-stage" ref={stageRef} data-quad={hasQuad ? '1' : '0'} data-phase={phase}>
        <video
          ref={videoRef}
          className={phase === 'preview' ? 'is-hidden' : ''}
          playsInline
          autoPlay
          muted
        />
        <canvas ref={overlayRef} className={`live-scan-overlay${phase === 'preview' ? ' is-hidden' : ''}`} />
        {phase === 'preview' && preview && (
          <img className="live-scan-preview" src={preview.url} alt={status} />
        )}
        <div className={`live-scan-flash${flash ? ' is-on' : ''}`} />
      </div>
      <footer className="live-scan-bottom">
        {phase !== 'preview' && (
          <>
            <p>{t('scan.liveHint')}</p>
            <button type="button" className="live-scan-shutter" onClick={capture} disabled={phase === 'capture'} aria-label={t('scan.liveShutter')} />
            <small>{t('scan.liveAutoHint')}</small>
          </>
        )}
        {localError && <p className="form-error">{localError}</p>}
      </footer>
      {phase === 'preview' && preview && <ScanCropEditor sourceFile={preview.file} canTakeAnother={canTakeAnother}
        onCancel={resetLive} onConfirm={(file, detected, keepOpen, sourceFile) => {
          onAccept(file, detected, keepOpen, sourceFile)
          if (keepOpen) resetLive()
        }} />}
    </div>
  )
}
