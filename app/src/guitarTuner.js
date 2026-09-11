/** Guitar tuner pitch detection (autocorrelation). A4 = 440 Hz default. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Standard guitar open strings (low → high). */
export const GUITAR_STRINGS = [
  { name: 'E2', hz: 82.4069 },
  { name: 'A2', hz: 110.0 },
  { name: 'D3', hz: 146.8324 },
  { name: 'G3', hz: 195.9977 },
  { name: 'B3', hz: 246.9417 },
  { name: 'E4', hz: 329.6276 },
]

export function frequencyToNote(hz, a4 = 440) {
  if (!Number.isFinite(hz) || hz <= 0) return null
  const midi = 69 + 12 * Math.log2(hz / a4)
  const rounded = Math.round(midi)
  const cents = Math.round((midi - rounded) * 100)
  const noteIndex = ((rounded % 12) + 12) % 12
  const octave = Math.floor(rounded / 12) - 1
  return {
    hz,
    name: NOTE_NAMES[noteIndex],
    octave,
    label: `${NOTE_NAMES[noteIndex]}${octave}`,
    cents,
    midi: rounded,
  }
}

export function nearestGuitarString(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null
  let best = GUITAR_STRINGS[0]
  let bestCents = Infinity
  for (const string of GUITAR_STRINGS) {
    const cents = Math.abs(1200 * Math.log2(hz / string.hz))
    if (cents < bestCents) {
      bestCents = cents
      best = string
    }
  }
  const cents = Math.round(1200 * Math.log2(hz / best.hz))
  return { ...best, cents }
}

/**
 * Autocorrelation pitch estimate.
 * @param {Float32Array} buffer
 * @param {number} sampleRate
 * @param {{ minHz?: number, maxHz?: number }} [opts]
 * @returns {number|null} frequency in Hz
 */
export function detectPitchAutocorrelation(buffer, sampleRate, opts = {}) {
  const minHz = opts.minHz ?? 70
  const maxHz = opts.maxHz ?? 1100
  if (!buffer?.length || !sampleRate) return null

  // RMS gate — ignore silence / noise floor
  let rms = 0
  for (let i = 0; i < buffer.length; i += 1) rms += buffer[i] * buffer[i]
  rms = Math.sqrt(rms / buffer.length)
  if (rms < 0.01) return null

  const size = buffer.length
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxLag = Math.min(size - 2, Math.floor(sampleRate / minHz))
  if (maxLag <= minLag) return null

  // Difference function (YIN-style) for clearer troughs
  const diff = new Float32Array(maxLag + 1)
  for (let tau = minLag; tau <= maxLag; tau += 1) {
    let sum = 0
    for (let i = 0; i < size - tau; i += 1) {
      const d = buffer[i] - buffer[i + tau]
      sum += d * d
    }
    diff[tau] = sum
  }

  // Cumulative mean normalized difference
  const cmnd = new Float32Array(maxLag + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxLag; tau += 1) {
    running += diff[tau]
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1
  }

  const threshold = 0.15
  let tauEstimate = -1
  for (let tau = minLag; tau <= maxLag; tau += 1) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau += 1
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate < 0) {
    // Fallback: global minimum
    let best = minLag
    for (let tau = minLag + 1; tau <= maxLag; tau += 1) {
      if (cmnd[tau] < cmnd[best]) best = tau
    }
    if (cmnd[best] > 0.4) return null
    tauEstimate = best
  }

  // Parabolic interpolation around trough
  const x0 = tauEstimate > 0 ? cmnd[tauEstimate - 1] : cmnd[tauEstimate]
  const x1 = cmnd[tauEstimate]
  const x2 = tauEstimate + 1 <= maxLag ? cmnd[tauEstimate + 1] : cmnd[tauEstimate]
  const denom = 2 * (2 * x1 - x2 - x0)
  const betterTau = denom !== 0 ? tauEstimate + (x2 - x0) / denom : tauEstimate
  if (betterTau <= 0) return null
  return sampleRate / betterTau
}

/**
 * Start microphone capture + continuous pitch detection.
 * Returns a controller with stop().
 */
export function startTunerMic({
  onPitch,
  onError,
  a4 = 440,
  bufferSize = 2048,
} = {}) {
  let stream = null
  let audioContext = null
  let analyser = null
  let source = null
  let raf = 0
  let stopped = false
  const buffer = new Float32Array(bufferSize)

  const tick = () => {
    if (stopped || !analyser) return
    analyser.getFloatTimeDomainData(buffer)
    const hz = detectPitchAutocorrelation(buffer, audioContext.sampleRate)
    if (hz) {
      const note = frequencyToNote(hz, a4)
      const string = nearestGuitarString(hz)
      onPitch?.({ hz, note, string, quiet: false })
    } else {
      onPitch?.({ hz: null, note: null, string: null, quiet: true })
    }
    raf = requestAnimationFrame(tick)
  }

  const start = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      const err = new Error('MIC_UNSUPPORTED')
      onError?.(err)
      throw err
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
    } catch (error) {
      const code = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
        ? 'MIC_DENIED'
        : error?.name === 'NotFoundError'
          ? 'MIC_NOT_FOUND'
          : 'MIC_ERROR'
      const wrapped = new Error(code)
      wrapped.cause = error
      onError?.(wrapped)
      throw wrapped
    }

    const Ctx = window.AudioContext || window.webkitAudioContext
    audioContext = new Ctx()
    if (audioContext.state === 'suspended') {
      try { await audioContext.resume() } catch { /* ignore */ }
    }
    analyser = audioContext.createAnalyser()
    analyser.fftSize = bufferSize * 2
    analyser.smoothingTimeConstant = 0
    source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
    raf = requestAnimationFrame(tick)
  }

  const stop = () => {
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    try { source?.disconnect() } catch { /* ignore */ }
    try { analyser?.disconnect() } catch { /* ignore */ }
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop() } catch { /* ignore */ }
      }
    }
    stream = null
    if (audioContext) {
      audioContext.close().catch(() => {})
    }
    audioContext = null
    analyser = null
    source = null
  }

  return { start, stop }
}
