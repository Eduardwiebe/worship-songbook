import { useEffect, useState } from 'react'
import { authorizedObjectUrl, isNativeRuntime, toApiPath } from './apiConfig'
import { isLikelyIosNative } from './nativePlatform'

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

function PdfNativeViewer({ src, title, className }) {
  const ios = isLikelyIosNative()
  if (ios) {
    return (
      <embed
        title={title}
        className={className}
        src={src}
        type="application/pdf"
      />
    )
  }
  return <iframe title={title} className={className} src={src} />
}

/**
 * Protected PDFs/charts — blob URL on native, direct URL on web.
 * iOS WKWebView often fails to render PDFs inside iframes; embed is used there.
 */
export function AuthorizedFrame({ path, title, className, hash = '' }) {
  const [src, setSrc] = useState(() => {
    if (!path) return ''
    if (isNativeRuntime()) return ''
    return `${path}${hash || ''}`
  })
  const [loading, setLoading] = useState(() => Boolean(path && isNativeRuntime()))
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''

    async function load() {
      if (!path) {
        if (active) {
          setSrc('')
          setLoading(false)
          setError('')
        }
        return
      }
      if (!isNativeRuntime()) {
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
        const url = await authorizedObjectUrl(toApiPath(path) || path, { mimeHint: 'application/pdf' })
        if (!active) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setSrc(url)
        setLoading(false)
      } catch (caught) {
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
  }, [path, hash])

  if (loading) {
    return (
      <div className={`pdf-media-loading${className ? ` ${className}` : ''}`}>
        <strong>{title || 'PDF'}</strong>
        <span>Lädt …</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className={`pdf-media-error${className ? ` ${className}` : ''}`}>
        <strong>{title || 'PDF'}</strong>
        <span>{error}</span>
        {path && !isNativeRuntime() ? (
          <a href={`${path}${hash || ''}`} target="_blank" rel="noopener noreferrer">In neuem Tab öffnen</a>
        ) : null}
      </div>
    )
  }
  if (!src) return null

  if (isNativeRuntime()) {
    return <PdfNativeViewer src={src} title={title} className={className} />
  }
  return <iframe title={title} className={className} src={src} />
}
