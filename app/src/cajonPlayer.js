import { useEffect } from 'react'

/** Acoustic-like cajón hit (self-generated, royalty-free). Served from app/public. */
export const CAJON_SAMPLE_URL = `${import.meta.env.BASE_URL || '/'}cajon-hit.mp3`.replace(/([^:]\/)\/+/g, '$1')

let sharedCtx = null
let sharedBuffer = null
let loadPromise = null

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext()
  }
  return sharedCtx
}

/** Call from a user gesture (Cajón play button) so mobile Safari unlocks audio. */
export function unlockCajonAudio() {
  const ctx = getAudioContext()
  if (!ctx) return Promise.resolve()
  return ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(() => {})
}

/**
 * Most reliable iOS path: HTMLAudioElement.play() inside the tap gesture.
 * Used as the first hit and as fallback when the Web Audio buffer is missing.
 */
export function playCajonHtmlHit({ strong = false } = {}) {
  try {
    const audio = new Audio(CAJON_SAMPLE_URL)
    audio.preload = 'auto'
    audio.playsInline = true
    audio.setAttribute('playsinline', 'true')
    audio.volume = strong ? 1 : 0.82
    const playPromise = audio.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {})
    }
    return playPromise || Promise.resolve()
  } catch {
    return Promise.resolve()
  }
}

export function preloadCajonSample() {
  if (sharedBuffer) return Promise.resolve(sharedBuffer)
  if (loadPromise) return loadPromise
  const ctx = getAudioContext()
  if (!ctx) return Promise.resolve(null)
  loadPromise = (async () => {
    const response = await fetch(CAJON_SAMPLE_URL)
    if (!response.ok) throw new Error(`cajón sample HTTP ${response.status}`)
    const raw = await response.arrayBuffer()
    // decodeAudioData may detach the buffer; pass a copy for Safari friendliness
    sharedBuffer = await ctx.decodeAudioData(raw.slice(0))
    return sharedBuffer
  })().catch((error) => {
    console.warn('cajón sample preload failed', error)
    loadPromise = null
    return null
  })
  return loadPromise
}

function playWebAudioHit({ strong = false } = {}) {
  const ctx = getAudioContext()
  if (!ctx || !sharedBuffer) return false
  void ctx.resume()
  const source = ctx.createBufferSource()
  source.buffer = sharedBuffer
  // Soft body on downbeat, slightly brighter tap on off-beats
  source.playbackRate.value = strong ? 0.94 : 1.06
  const gain = ctx.createGain()
  const level = strong ? 0.95 : 0.72
  const now = ctx.currentTime
  gain.gain.setValueAtTime(level, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + Math.min(0.5, sharedBuffer.duration + 0.02))
  source.connect(gain)
  gain.connect(ctx.destination)
  source.start(now)
  return true
}

/**
 * Play one cajón hit. `strong` = downbeat (slightly warmer / louder).
 * Prefers Web Audio when the buffer is ready; otherwise HTMLAudioElement.
 */
export function playCajonHit({ strong = false } = {}) {
  if (playWebAudioHit({ strong })) return
  playCajonHtmlHit({ strong })
}

/**
 * Unlock + preload + first audible hit, chained from the play-button click.
 * HTMLAudio.play() is fired immediately (same gesture) so iOS Safari is not silent
 * while decodeAudioData is still in flight.
 */
export async function startCajonFromGesture() {
  playCajonHtmlHit({ strong: true })
  await unlockCajonAudio()
  await preloadCajonSample()
  if (sharedBuffer) playWebAudioHit({ strong: true })
}

/** BPM-synced Cajón loop for Set play + song editor. First tap hit is played in the gesture. */
export function useCajon(cajonOn, bpm) {
  useEffect(() => {
    if (!cajonOn) return undefined
    let cancelled = false
    let timer = null
    let beat = 1
    const tempo = Math.max(40, Math.min(240, Number(bpm) || 120))

    ;(async () => {
      await unlockCajonAudio()
      await preloadCajonSample()
      if (cancelled) return
      timer = window.setInterval(() => {
        playCajonHit({ strong: beat % 4 === 0 })
        beat += 1
      }, 60000 / tempo)
    })()

    return () => {
      cancelled = true
      if (timer != null) window.clearInterval(timer)
    }
  }, [cajonOn, bpm])
}
