import { useEffect, useRef } from 'react'

/**
 * Autoscroll used to bump scrollTop on `.original-pages.is-multi` only.
 * After the original sheet was locked to the frame, a one-page scan has
 * overflow:hidden and a fitted image, and multi-page sheets snap every
 * 1px step back to the page. Neither target moves.
 * While autoscroll is on, size the page images so the stack is taller
 * than the stage, turn snap off, and advance scrollTop. Fit-lock returns
 * when autoscroll stops.
 *
 * Sub-pixel scrollTop is truncated to 0 on several engines, so the pace is
 * applied in whole pixels. The previous default was 1px every 70ms
 * (~14.3px/s). A one-page chart then finishes in well under a minute, which
 * is too fast to sing. 1px every 280ms (~3.6px/s) is four times slower:
 * about three to four minutes per screenful, slow enough to follow a chart.
 */
export const AUTOSCROLL_PX_PER_SEC = 1000 / 280

/**
 * Scale a fitted sheet only when it has almost no vertical travel.
 * A page that is already taller than the stage stays at its natural width.
 */
export function autoscrollScale(totalNaturalHeight, viewHeight) {
  if (!(viewHeight > 0) || !(totalNaturalHeight > 0)) return 1
  const travel = totalNaturalHeight - viewHeight
  if (travel >= viewHeight * 0.2) return 1
  return (viewHeight * 1.35) / totalNaturalHeight
}

export function measureAutoscrollLayout(viewWidth, viewHeight, aspects) {
  if (!(viewWidth > 0) || !(viewHeight > 0) || !aspects?.length) return null
  const naturalHeights = aspects.map((ratio) => viewWidth * ratio)
  const total = naturalHeights.reduce((sum, height) => sum + height, 0)
  const scale = autoscrollScale(total, viewHeight)
  return {
    scale,
    width: viewWidth * scale,
    heights: naturalHeights.map((height) => height * scale),
    marginLeft: (viewWidth - viewWidth * scale) / 2,
  }
}

export function advanceSheetScroll(scroller, deltaPx) {
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const current = scroller.scrollTop || 0
  if (max <= 1) return { scrollTop: current, done: true, max }
  const next = Math.min(max, current + Math.max(0, deltaPx))
  // Assign scrollTop directly. scrollTo() follows scroll-behavior and can
  // restart a smooth animation every frame, which leaves the sheet at 0.
  scroller.scrollTop = next
  return { scrollTop: scroller.scrollTop, done: scroller.scrollTop >= max - 0.5, max }
}

export function findSheetScroller(root) {
  if (!root) return null
  if (root.classList?.contains('original-pages')) return root
  return root.querySelector?.('.original-pages') || null
}

export function applyAutoscrollLayout(scroller) {
  const images = [...scroller.querySelectorAll('.original-page-image')]
  if (!images.length || images.some((img) => !img.naturalWidth || !img.naturalHeight)) return false
  const viewW = scroller.clientWidth
  const viewH = scroller.clientHeight
  if (!viewW || !viewH) return false
  const signature = `${viewW}x${viewH}:${images.map((img) => `${img.naturalWidth}x${img.naturalHeight}`).join(',')}`
  scroller.classList.add('is-autoscrolling')
  scroller.style.display = 'block'
  scroller.style.overflowX = 'hidden'
  scroller.style.overflowY = 'auto'
  scroller.style.scrollSnapType = 'none'
  scroller.style.touchAction = 'pan-y'
  if (scroller.dataset.autoscrollLayout === signature) return true
  const layout = measureAutoscrollLayout(
    viewW,
    viewH,
    images.map((img) => img.naturalHeight / img.naturalWidth),
  )
  if (!layout) return false
  images.forEach((img, index) => {
    img.style.width = `${layout.width}px`
    img.style.height = `${layout.heights[index]}px`
    img.style.maxWidth = 'none'
    img.style.maxHeight = 'none'
    img.style.marginLeft = `${layout.marginLeft}px`
    img.style.objectFit = 'fill'
    img.style.scrollSnapAlign = 'none'
    img.style.scrollSnapStop = 'normal'
  })
  scroller.dataset.autoscrollLayout = signature
  return true
}

export function clearAutoscrollLayout(scroller) {
  if (!scroller) return
  scroller.classList.remove('is-autoscrolling')
  scroller.style.display = ''
  scroller.style.overflowX = ''
  scroller.style.overflowY = ''
  scroller.style.scrollSnapType = ''
  scroller.style.touchAction = ''
  delete scroller.dataset.autoscrollLayout
  scroller.querySelectorAll('.original-page-image').forEach((img) => {
    img.style.width = ''
    img.style.height = ''
    img.style.maxWidth = ''
    img.style.maxHeight = ''
    img.style.marginLeft = ''
    img.style.objectFit = ''
    img.style.scrollSnapAlign = ''
    img.style.scrollSnapStop = ''
  })
}

function bindManualHold(scroller, hold) {
  if (scroller.dataset.autoscrollHold === '1') return () => {}
  scroller.dataset.autoscrollHold = '1'
  const down = () => { hold.holding = true }
  const up = () => { hold.holding = false; hold.last = 0 }
  scroller.addEventListener('pointerdown', down)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  return () => {
    scroller.removeEventListener('pointerdown', down)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    delete scroller.dataset.autoscrollHold
  }
}

/**
 * Smoothly scrolls the original page stack. Stops at the bottom.
 * Manual dragging pauses the motion so pinch/pan of the sheet still works.
 */
export function useSheetAutoscroll(active, rootRef, { onReachEnd } = {}) {
  const onEndRef = useRef(onReachEnd)
  useEffect(() => {
    onEndRef.current = onReachEnd
  })

  useEffect(() => {
    if (!active) return undefined
    const root = rootRef.current
    let raf = 0
    let stopped = false
    const hold = { holding: false, last: 0, carry: 0 }
    let unbind = () => {}
    let bound = null

    const tick = (now) => {
      if (stopped) return
      const scroller = findSheetScroller(rootRef.current || root)
      if (!scroller) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (bound !== scroller) {
        unbind()
        unbind = bindManualHold(scroller, hold)
        bound = scroller
        hold.last = 0
      }
      if (!applyAutoscrollLayout(scroller)) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (hold.holding) {
        hold.last = now
        raf = requestAnimationFrame(tick)
        return
      }
      if (!hold.last) hold.last = now
      const dt = Math.min(48, Math.max(0, now - hold.last))
      hold.last = now
      // Some engines truncate scrollTop to integers, so sub-pixel steps never move.
      hold.carry += (AUTOSCROLL_PX_PER_SEC * dt) / 1000
      const whole = Math.floor(hold.carry)
      if (whole < 1) {
        raf = requestAnimationFrame(tick)
        return
      }
      hold.carry -= whole
      const step = advanceSheetScroll(scroller, whole)
      if (step.done) {
        stopped = true
        onEndRef.current?.()
        return
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      unbind()
      clearAutoscrollLayout(findSheetScroller(root))
    }
  }, [active, rootRef])
}
