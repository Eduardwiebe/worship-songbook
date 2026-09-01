import { useEffect, useState } from 'react'
import { isLikelyMobileNative } from './nativePlatform'

/** iOS WKWebView auto-zooms inputs <16px; autoFocus also triggers keyboard corruption. */
export function useAvoidMobileAutoFocus() {
  const [avoid, setAvoid] = useState(true)
  useEffect(() => {
    const mobile =
      isLikelyMobileNative()
      || window.matchMedia('(max-width: 767px)').matches
    setAvoid(mobile)
  }, [])
  return avoid
}
