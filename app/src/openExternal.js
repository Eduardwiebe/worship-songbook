import { isNativeRuntime } from './apiConfig'

/**
 * Open https URLs in the system browser on native; keep web target=_blank behavior.
 */
export async function openExternal(url) {
  if (!url) return
  if (isNativeRuntime()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (error) {
      console.warn('[openExternal] opener unavailable:', error?.message || error)
      if (String(url).startsWith('mailto:')) {
        window.location.href = url
        return
      }
    }
  }
  if (String(url).startsWith('mailto:')) {
    window.location.href = url
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Capture clicks on http(s) anchors and legal .html paths when running in Tauri. */
export function installNativeExternalLinkHandler() {
  if (!isNativeRuntime()) return () => {}

  const onClick = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = event.target?.closest?.('a[href]')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return

    if (/^https?:\/\//i.test(href)) {
      event.preventDefault()
      openExternal(href)
      return
    }

    if (href.startsWith('/') && href.includes('.html')) {
      event.preventDefault()
      openExternal(`https://songbook.lyruma.app${href}`)
    }
  }

  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
