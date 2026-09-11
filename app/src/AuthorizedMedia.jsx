import { useCallback, useEffect, useRef, useState } from 'react'
import { authorizedObjectUrl, isNativeRuntime, toApiPath, apiFetch } from './apiConfig'
import { isLikelyIosNative } from './nativePlatform'
import { cacheGetMedia, cacheGetMediaObjectUrl, cachePutMedia, chartCacheKey, pdfCacheKey, isProbablyOffline } from './offlineCache'

/**
 * <img> that loads protected API media with Bearer on native (blob URL).
 * On web, uses the normal same-origin URL.
 */
export function AuthorizedImg({ path, alt = '', className, ...rest }) {
  const [src, setSrc] = useState(() => (isNativeRuntime() ? '' : path || ''))

  useEffect(() => {
    let active = true
    let objectUrl = ''

    async function load() {
      if (!path) {
        if (active) setSrc('')
        return
      }
      if (!isNativeRuntime()) {
        if (active) setSrc(path)
        return
      }
      try {
        const url = await authorizedObjectUrl(toApiPath(path) || path)
        if (!active) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
      } catch {
        if (active) setSrc('')
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
 * iOS WKWebView: render PDF pages as full-width images (no crop).
 * Avoids incomplete PDF embed/iframe rendering.
 */
export function OriginalPagesViewer({ songId, title, className }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      if (!songId) {
        setPages([])
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const response = await apiFetch(`/api/songs/${songId}/pages`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Seiten konnten nicht geladen werden.')
        if (active) {
          setPages(data.pages || [])
          setLoading(false)
        }
      } catch (caught) {
        if (active) {
          setError(caught?.message || 'Seiten konnten nicht geladen werden.')
          setLoading(false)
        }
      }
    }
    load()
    return () => { active = false }
  }, [songId])

  if (loading) {
    return (
      <div className={`pdf-media-loading original-pages${className ? ` ${className}` : ''}`}>
        <strong>{title || 'Original'}</strong>
        <span>Lädt …</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className={`pdf-media-error original-pages${className ? ` ${className}` : ''}`}>
        <strong>{title || 'Original'}</strong>
        <span>{error}</span>
      </div>
    )
  }
  if (!pages.length) return null

  return (
    <div className={`original-pages${className ? ` ${className}` : ''}`}>
      {pages.map((page, index) => (
        <img
          key={index}
          src={page.dataUrl}
          alt={`${title || 'Seite'} ${index + 1}`}
          className="original-page-image"
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
 * For song originals on iOS, prefer OriginalPagesViewer (full page images).
 * fitContent: size HTML chart iframes to document height so the stage can scroll
 * while keeping pointer-events none (song swipe stays on the stage).
 */
export function AuthorizedFrame({ path, title, className, hash = '', songId = '', preferPageImages = false, fitContent = false }) {
  const usePages = preferPageImages && songId && isLikelyIosNative()
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
        // Web PDF: prefer live URL when online; fall back to cached blob offline.
        if (isProbablyOffline() && mediaKey) {
          const cached = await tryCacheObjectUrl()
          if (cached && active) {
            objectUrl = cached
            setSrc(cached)
            setLoading(false)
            setError('')
            return
          }
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
          setError(caught?.message || 'PDF konnte nicht geladen werden.')
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
        {path && !isNativeRuntime() && !fitContent ? (
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
