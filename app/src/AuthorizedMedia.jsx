import { useEffect, useState } from 'react'
import { authorizedObjectUrl, isNativeRuntime, toApiPath } from './apiConfig'

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
 * <iframe> for protected PDFs/charts — blob URL on native, direct URL on web.
 */
export function AuthorizedFrame({ path, title, className, hash = '' }) {
  const [src, setSrc] = useState(() => {
    if (!path) return ''
    if (isNativeRuntime()) return ''
    return `${path}${hash || ''}`
  })

  useEffect(() => {
    let active = true
    let objectUrl = ''

    async function load() {
      if (!path) {
        if (active) setSrc('')
        return
      }
      if (!isNativeRuntime()) {
        if (active) setSrc(`${path}${hash || ''}`)
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
  }, [path, hash])

  if (!src) return null
  return <iframe title={title} className={className} src={src} />
}
