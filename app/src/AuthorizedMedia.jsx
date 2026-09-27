import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { authorizedObjectUrl, isNativeRuntime, toApiPath, apiFetch } from './apiConfig'
import { isLikelyIosNative } from './nativePlatform'
import { tStatic, useI18n } from './i18n'
import { lockBodyScroll, unlockBodyScroll } from './modalLock'
import {
  cacheGetMedia,
  cacheGetMediaObjectUrl,
  cachePagesPayload,
  cachePutMedia,
  chartCacheKey,
  isNetworkError,
  isProbablyOffline,
  loadCachedPageUrls,
  mediaKeyForApiPath,
  pdfCacheKey,
} from './offlineCache'
import { useScreenWakeLock } from './screenWakeLock'

/**
 * <img> that loads protected API media with Bearer on native (blob URL).
 * On web, uses the normal same-origin URL.
 */
export function AuthorizedImg({ path, alt = '', className, ...rest }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''

    const show = (url) => {
      if (!active) {
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
        return
      }
      if (objectUrl && objectUrl !== url && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
      objectUrl = url || ''
      setSrc(objectUrl)
    }

    async function load() {
      if (!path) {
        show('')
        return
      }
      const apiPath = toApiPath(path) || path
      const mediaKey = mediaKeyForApiPath(apiPath)
      const cached = mediaKey ? await cacheGetMediaObjectUrl(mediaKey) : ''
      if (!active) {
        if (cached?.startsWith('blob:')) URL.revokeObjectURL(cached)
        return
      }
      if (cached) show(cached)
      if (isProbablyOffline()) {
        if (!cached) show('')
        return
      }
      try {
        const response = await apiFetch(apiPath)
        if (!response.ok) throw new Error('media')
        const blob = await response.blob()
        if (!blob.size) throw new Error('empty')
        const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'image/jpeg'
        if (mediaKey) {
          const buffer = await blob.arrayBuffer()
          await cachePutMedia(mediaKey, {
            mime,
            buffer,
            meta: { kind: 'thumb', priority: 2 },
          })
        }
        const url = URL.createObjectURL(blob)
        show(url)
      } catch {
        if (!cached && mediaKey) {
          const fallback = await cacheGetMediaObjectUrl(mediaKey)
          if (fallback) {
            show(fallback)
            return
          }
        }
        if (!cached) show('')
      }
    }

    load()
    return () => {
      active = false
      if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [path])

  if (!src) return null
  return <img src={src} alt={alt} className={className} {...rest} />
}

/**
 * Raster page images for the Original view on every device.
 * The browser PDF plugin (iPad / desktop) lets the player drag the sheet
 * inside the frame. Images scale to the frame and stay fixed.
 */
export function OriginalPagesViewer({ songId, title, className, onViewChange }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const rootRef = useRef(null)
  const onViewChangeRef = useRef(onViewChange)
  const multi = pages.length > 1

  useEffect(() => {
    onViewChangeRef.current = onViewChange
  }, [onViewChange])

  useEffect(() => {
    let active = true
    const blobUrls = []
    const revoke = () => {
      while (blobUrls.length) {
        const url = blobUrls.pop()
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
      }
    }
    async function load() {
      if (!songId) {
        setPages([])
        setLoading(false)
        setError('')
        return
      }
      setLoading(true)
      setError('')
      let showedCache = false
      try {
        const cached = await loadCachedPageUrls(songId)
        if (!active) {
          cached?.forEach((url) => URL.revokeObjectURL(url))
          return
        }
        if (cached?.length) {
          blobUrls.push(...cached)
          setPages(cached.map((url) => ({ dataUrl: url })))
          setLoading(false)
          setError('')
          showedCache = true
          if (isProbablyOffline()) return
        }
        const response = await apiFetch(`/api/songs/${songId}/pages`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || tStatic('offline.pagesFailed'))
        cachePagesPayload(songId, data.pages, { title, priority: 0 }).catch(() => {})
        if (!active) return
        revoke()
        setPages(data.pages || [])
        setLoading(false)
        setError('')
      } catch (caught) {
        if (!active) return
        if (showedCache) return
        const offline = isProbablyOffline() || isNetworkError(caught)
        setPages([])
        setError(offline ? tStatic('offline.notCached') : (caught?.message || tStatic('offline.pagesFailed')))
        setLoading(false)
      }
    }
    load()
    return () => {
      active = false
      revoke()
    }
  }, [songId, title])

  useEffect(() => {
    const el = rootRef.current
    if (!el || multi) return undefined
    const block = (event) => {
      if (el.classList.contains('is-autoscrolling')) return
      event.preventDefault()
    }
    el.addEventListener('wheel', block, { passive: false })
    el.addEventListener('touchmove', block, { passive: false })
    el.addEventListener('gesturestart', block)
    return () => {
      el.removeEventListener('wheel', block)
      el.removeEventListener('touchmove', block)
      el.removeEventListener('gesturestart', block)
    }
  }, [multi, loading, error, pages.length])

  useEffect(() => {
    onViewChangeRef.current?.({ index: 0, count: pages.length })
  }, [pages])

  useEffect(() => {
    const root = rootRef.current
    if (!root || pages.length < 2) return undefined
    const images = [...root.querySelectorAll('.original-page-image')]
    if (!images.length) return undefined
    const observer = new IntersectionObserver((entries) => {
      const best = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!best) return
      const index = images.indexOf(best.target)
      if (index >= 0) onViewChangeRef.current?.({ index, count: pages.length })
    }, { root, threshold: [0.45, 0.7] })
    images.forEach((image) => observer.observe(image))
    return () => observer.disconnect()
  }, [pages])

  const frameClass = `original-pages${multi ? ' is-multi' : ' is-single'}${className ? ` ${className}` : ''}`

  if (loading) {
    return (
      <div className={`pdf-media-loading original-pages is-single${className ? ` ${className}` : ''}`}>
        <strong>{title || 'Original'}</strong>
        <span>Lädt …</span>
      </div>
    )
  }
  if (error || !pages.length) {
    return (
      <div className={`pdf-media-error original-pages is-single${className ? ` ${className}` : ''}`}>
        <strong>{title || 'Original'}</strong>
        <span>{error || 'Keine Seiten im Original.'}</span>
      </div>
    )
  }

  return (
    <div ref={rootRef} className={frameClass}>
      {pages.map((page, index) => (
        <img
          key={index}
          src={page.dataUrl}
          alt={`${title || 'Seite'} ${index + 1}`}
          className="original-page-image"
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        />
      ))}
    </div>
  )
}

function useStageFrameHeight(fitContent, src = '') {
  const frameRef = useRef(null)

  const fitFrameToContent = useCallback(() => {
    const frame = frameRef.current
    if (!frame || !fitContent) return false
    try {
      const doc = frame.contentDocument
      if (!doc?.documentElement) return false
      const body = doc.body
      const root = doc.documentElement
      // Prefer real content height; never smaller than the stage viewport.
      const contentHeight = Math.max(
        body?.scrollHeight || 0,
        body?.offsetHeight || 0,
        root.scrollHeight || 0,
        root.offsetHeight || 0,
      )
      const stageHeight = frame.parentElement?.clientHeight || 0
      const next = Math.max(contentHeight, stageHeight, 1)
      frame.style.height = `${next}px`
      return true
    } catch {
      return false
    }
  }, [fitContent])

  useEffect(() => {
    if (!fitContent || !src) return undefined
    const frame = frameRef.current
    // Retry after layout/fonts settle (iframe may mount after this effect first runs).
    const t0 = window.setTimeout(fitFrameToContent, 0)
    const t1 = window.setTimeout(fitFrameToContent, 50)
    const t2 = window.setTimeout(fitFrameToContent, 250)
    const onResize = () => { fitFrameToContent() }
    window.addEventListener('resize', onResize)

    let observer
    const watch = window.setTimeout(() => {
      try {
        const doc = frameRef.current?.contentDocument
        if (doc?.body && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => fitFrameToContent())
          observer.observe(doc.body)
        }
      } catch {
        // cross-origin / PDF plugin — parent will fall back to stage-fill
      }
    }, 60)

    return () => {
      window.clearTimeout(t0)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(watch)
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [fitContent, fitFrameToContent, src])

  return { frameRef, fitFrameToContent }
}

function bufferToUtf8(buffer) {
  if (!buffer) return ''
  try {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer)
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

function PdfNativeViewer({ src, title, className, fitContent = false }) {
  const ios = isLikelyIosNative()
  const { frameRef, fitFrameToContent } = useStageFrameHeight(fitContent, src)
  // iOS WKWebView: <embed type="application/pdf"> helps real PDFs, but blank-screens
  // HTML lead sheets (blob/srcdoc). Charts always use iframe.
  if (ios && !fitContent) {
    return (
      <embed
        title={title}
        className={className}
        src={src}
        type="application/pdf"
      />
    )
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      className={className}
      src={src}
      onLoad={fitFrameToContent}
    />
  )
}

/**
 * Protected PDFs/charts — blob URL on native, direct URL on web.
 * iOS WKWebView often fails to render PDFs inside iframes; embed is used there for PDFs only.
 * HTML lead sheets (fitContent) always use iframe srcDoc — never PDF embed (that was blank on iPad).
 * Song originals use OriginalPagesViewer on every device (phone, tablet, desktop)
 * so the sheet scales to the frame and cannot be dragged. iOS PDF embed stays
 * only for non-page fallbacks.
 * fitContent: size HTML chart iframes to document height so the stage can scroll
 * while keeping pointer-events none (song swipe stays on the stage).
 */
export function AuthorizedFrame({ path, title, className, hash = '', songId = '', preferPageImages = false, fitContent = false }) {
  const usePages = Boolean(preferPageImages && songId)
  const [frameClassName, setFrameClassName] = useState(className || '')
  const [src, setSrc] = useState('')
  const [htmlDoc, setHtmlDoc] = useState('')
  const [loading, setLoading] = useState(() => Boolean(path && !usePages))
  const [error, setError] = useState('')
  const frameToken = fitContent ? (htmlDoc ? `html:${htmlDoc.length}` : '') : src
  const { frameRef, fitFrameToContent } = useStageFrameHeight(fitContent && !usePages, frameToken)

  useEffect(() => {
    setFrameClassName(className || '')
  }, [className])

  useEffect(() => {
    let active = true
    let objectUrl = ''

    async function load() {
      if (usePages) return
      if (!path) {
        if (active) {
          setSrc('')
          setHtmlDoc('')
          setLoading(false)
          setError('')
        }
        return
      }
      const apiPath = toApiPath(path) || path
      const chartMatch = String(apiPath).match(/\/api\/songs\/([^/?]+)\/chart\?key=([^&]+)/)
      const pdfMatch = String(apiPath).match(/\/api\/songs\/([^/?]+)\/pdf/)
      const mediaKey = chartMatch
        ? chartCacheKey(chartMatch[1], decodeURIComponent(chartMatch[2]))
        : pdfMatch
          ? pdfCacheKey(pdfMatch[1])
          : ''

      const tryCacheHtml = async () => {
        if (!mediaKey) return ''
        const row = await cacheGetMedia(mediaKey)
        return bufferToUtf8(row?.buffer)
      }

      const tryCacheObjectUrl = async () => {
        if (!mediaKey) return ''
        return cacheGetMediaObjectUrl(mediaKey)
      }

      // Edited lead sheets: always fetch HTML and render via srcDoc.
      // Avoids iOS PDF-embed blank screens, blob iframe quirks, and cookie/X-Frame issues.
      if (fitContent) {
        setLoading(true)
        setError('')
        setSrc('')
        try {
          if (isProbablyOffline()) {
            const cachedHtml = await tryCacheHtml()
            if (cachedHtml && active) {
              setHtmlDoc(cachedHtml)
              setLoading(false)
              setError('')
              return
            }
          }
          const response = await apiFetch(apiPath)
          if (!response.ok) throw new Error('Chart konnte nicht geladen werden.')
          const text = await response.text()
          if (!active) return
          setHtmlDoc(text)
          setLoading(false)
          setError('')
          if (mediaKey) {
            await cachePutMedia(mediaKey, {
              mime: 'text/html; charset=utf-8',
              buffer: new TextEncoder().encode(text).buffer,
            })
          }
        } catch (caught) {
          const cachedHtml = await tryCacheHtml()
          if (cachedHtml && active) {
            setHtmlDoc(cachedHtml)
            setLoading(false)
            setError('')
            return
          }
          if (active) {
            setHtmlDoc('')
            setError(caught?.message || 'Chart konnte nicht geladen werden.')
            setLoading(false)
          }
        }
        return
      }

      setHtmlDoc('')
      if (!isNativeRuntime()) {
        // Web PDF fallback (not the in-app page viewer): cached blob offline, live URL online.
        if (isProbablyOffline()) {
          const cached = mediaKey ? await tryCacheObjectUrl() : ''
          if (cached && active) {
            objectUrl = cached
            setSrc(cached)
            setLoading(false)
            setError('')
            return
          }
          if (active) {
            setSrc('')
            setHtmlDoc('')
            setError(tStatic('offline.notCached'))
            setLoading(false)
          }
          return
        }
        if (active) {
          setSrc(`${path}${hash || ''}`)
          setLoading(false)
          setError('')
        }
        return
      }
      setLoading(true)
      setError('')
      try {
        if (isProbablyOffline() && mediaKey) {
          const cached = await tryCacheObjectUrl()
          if (cached) {
            objectUrl = cached
            if (active) {
              setSrc(cached)
              setLoading(false)
              setError('')
            }
            return
          }
        }
        const url = await authorizedObjectUrl(apiPath, { mimeHint: 'application/pdf' })
        if (!active) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
        setLoading(false)
        if (mediaKey) {
          try {
            const response = await apiFetch(apiPath)
            if (response.ok) {
              const buf = await response.arrayBuffer()
              await cachePutMedia(mediaKey, {
                mime: 'application/pdf',
                buffer: buf,
              })
            }
          } catch {}
        }
      } catch (caught) {
        const cached = mediaKey ? await tryCacheObjectUrl() : ''
        if (cached && active) {
          objectUrl = cached
          setSrc(cached)
          setLoading(false)
          setError('')
          return
        }
        if (active) {
          setSrc('')
          const offline = isProbablyOffline() || isNetworkError(caught)
          setError(offline ? tStatic('offline.notCached') : (caught?.message || 'PDF konnte nicht geladen werden.'))
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      active = false
      if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
    }
  }, [path, hash, fitContent, usePages])

  const handleFrameLoad = () => {
    if (!fitContent) return
    const ok = fitFrameToContent()
    if (!ok) {
      // PDF plugin / opaque document: fill stage and scroll inside the frame.
      const fallback = (className || '').replace(/\bstage-fit-content\b/g, 'stage-fill').trim() || 'stage-fill'
      setFrameClassName(fallback)
      if (frameRef.current) {
        frameRef.current.style.height = ''
        frameRef.current.style.pointerEvents = 'auto'
      }
    }
  }

  if (usePages) {
    return <OriginalPagesViewer songId={songId} title={title} className={className} />
  }

  if (loading) {
    return (
      <div className={`pdf-media-loading${className ? ` ${className}` : ''}`}>
        <strong>{title || (fitContent ? 'Chart' : 'PDF')}</strong>
        <span>Lädt …</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className={`pdf-media-error${className ? ` ${className}` : ''}`}>
        <strong>{title || (fitContent ? 'Chart' : 'PDF')}</strong>
        <span>{error}</span>
        {path && !isNativeRuntime() && !fitContent && !isProbablyOffline() ? (
          <a href={`${path}${hash || ''}`} target="_blank" rel="noopener noreferrer">In neuem Tab öffnen</a>
        ) : null}
      </div>
    )
  }

  if (fitContent) {
    if (!htmlDoc) return null
    return (
      <iframe
        ref={frameRef}
        title={title}
        className={frameClassName}
        srcDoc={htmlDoc}
        onLoad={handleFrameLoad}
      />
    )
  }

  if (!src) return null

  if (isNativeRuntime()) {
    return <PdfNativeViewer src={src} title={title} className={frameClassName} fitContent={false} />
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      className={frameClassName}
      src={src}
      onLoad={handleFrameLoad}
    />
  )
}

/** One history entry per open, even if React StrictMode remounts the effect. */
let originalViewerHistoryPushed = false

/**
 * Fullscreen original scan. Always shows a way back — the raw PDF viewer
 * in a standalone PWA does not.
 */
export function OriginalViewerOverlay({ song, onClose }) {
  const { t } = useI18n()
  const onCloseRef = useRef(onClose)
  const closingRef = useRef(false)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const backRef = useRef(null)
  const swipeRef = useRef(null)
  const [view, setView] = useState({ index: 0, count: 0 })
  const onViewChange = useCallback((next) => setView(next), [])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (originalViewerHistoryPushed && window.history.state?.sbOriginalViewer) {
      window.history.back()
      window.setTimeout(() => {
        if (closingRef.current) onCloseRef.current()
      }, 300)
      return
    }
    originalViewerHistoryPushed = false
    onCloseRef.current()
  }, [])

  useEffect(() => {
    if (!originalViewerHistoryPushed) {
      window.history.pushState({ sbOriginalViewer: true }, '')
      originalViewerHistoryPushed = true
    }
    const onPop = () => {
      originalViewerHistoryPushed = false
      closingRef.current = true
      onCloseRef.current()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      requestClose()
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
    }
  }, [requestClose])

  useEffect(() => {
    lockBodyScroll()
    backRef.current?.focus()
    return () => unlockBodyScroll()
  }, [])

  const onBarTouchStart = (event) => {
    const touch = event.touches[0]
    swipeRef.current = { x: touch.clientX, y: touch.clientY }
  }
  const onBarTouchEnd = (event) => {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    const dy = touch.clientY - start.y
    const dx = touch.clientX - start.x
    if (dy > 72 && Math.abs(dx) < 80) requestClose()
  }

  const wakeBlocked = useScreenWakeLock(true)
  const pageLabel = view.count > 1
    ? t('songs.pageOf', { current: view.index + 1, total: view.count })
    : ''

  return (
    <div
      className="original-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={song?.title || t('songs.originalPdf')}
    >
      <div
        className="original-viewer-bar"
        onTouchStart={onBarTouchStart}
        onTouchEnd={onBarTouchEnd}
      >
        <button
          ref={backRef}
          type="button"
          className="original-viewer-back"
          onClick={requestClose}
        >
          <ChevronLeft size={22} aria-hidden="true"/>
          {t('common.back')}
        </button>
        {pageLabel ? <span className="original-viewer-count">{pageLabel}</span> : <span className="original-viewer-count original-viewer-title">{song?.title || ''}</span>}
        <button
          type="button"
          className="original-viewer-close"
          onClick={requestClose}
          aria-label={t('common.close')}
        >
          <X size={22}/>
        </button>
      </div>
      {wakeBlocked ? <p className="wake-lock-hint original-viewer-wake" role="status">{t('sets.wakeLockHint')}</p> : null}
      <OriginalPagesViewer
        songId={song?.id}
        title={song?.title || t('songs.originalPdf')}
        className="original-viewer-pages"
        onViewChange={onViewChange}
      />
    </div>
  )
}
