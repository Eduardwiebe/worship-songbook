/**
 * Local band-rehearsal capture. Nothing is uploaded.
 * Safari/iPad: audio/mp4 (AAC) saved as .m4a.
 * Other browsers: webm/opus, then a WAV fallback when MediaRecorder is missing.
 */

export const RECORDINGS_DB = 'songbook-rehearsal-recordings'
export const RECORDINGS_STORE = 'recordings'
const MAX_RECORDINGS = 8

const MIME_CANDIDATES = [
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/aac', ext: 'm4a' },
  { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' },
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
]

export function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export function rehearsalFileName({ band = '', title = '', at = new Date(), ext = 'm4a' } = {}) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
  const parts = [sanitizeFilePart(band), sanitizeFilePart(title), stamp].filter(Boolean)
  const safeExt = String(ext || 'm4a').replace(/^\./, '') || 'm4a'
  return `${parts.join('-') || `Aufnahme-${stamp}`}.${safeExt}`
}

export function pickRecordingFormat(isTypeSupported) {
  const hasRecorder = typeof isTypeSupported === 'function' || typeof MediaRecorder !== 'undefined'
  if (!hasRecorder) return { mime: '', ext: 'wav', via: 'wav' }
  const probe = typeof isTypeSupported === 'function'
    ? isTypeSupported
    : (type) => {
      try { return MediaRecorder.isTypeSupported(type) } catch { return false }
    }
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (probe(candidate.mime)) return { ...candidate, via: 'media-recorder' }
    } catch { /* try the next container */ }
  }
  return { mime: '', ext: 'webm', via: 'media-recorder' }
}

export function recorderSupportsPause() {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.prototype?.pause === 'function'
    && typeof MediaRecorder.prototype?.resume === 'function'
}

export function recordingErrorKey(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'sets.recordMicDenied'
  }
  if (name === 'NotFoundError' || name === 'NotSupportedError' || name === 'NotReadableError') {
    return 'sets.recordMicUnsupported'
  }
  return 'sets.recordError'
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return url
}

export async function deliverRecording(blob, filename, mime) {
  const type = mime || blob.type || 'application/octet-stream'
  const file = new File([blob], filename, { type })
  const payload = { files: [file], title: filename }
  if (typeof navigator !== 'undefined' && navigator.canShare?.(payload)) {
    await navigator.share(payload)
    return 'shared'
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, length * 2, true)
  let offset = 44
  chunks.forEach((chunk) => {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  })
  return new Blob([buffer], { type: 'audio/wav' })
}

async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('getUserMedia missing')
    error.name = 'NotSupportedError'
    throw error
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    })
  } catch (error) {
    if (error?.name === 'OverconstrainedError' || error?.name === 'NotReadableError') {
      return navigator.mediaDevices.getUserMedia({ audio: true })
    }
    throw error
  }
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => {
    try { track.stop() } catch { /* already stopped */ }
  })
}

function startWavCapture(stream) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) {
    const error = new Error('AudioContext missing')
    error.name = 'NotSupportedError'
    throw error
  }
  const ctx = new AudioCtx()
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  const chunks = []
  let paused = false
  processor.onaudioprocess = (event) => {
    if (paused) return
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)
  return {
    pause() { paused = true },
    resume() { paused = false },
    async stop() {
      processor.onaudioprocess = null
      try { processor.disconnect() } catch { /* ignore */ }
      try { source.disconnect() } catch { /* ignore */ }
      try { mute.disconnect() } catch { /* ignore */ }
      const blob = encodeWav(chunks, ctx.sampleRate || 44100)
      ctx.close?.().catch(() => {})
      return blob
    },
  }
}

export function createRehearsalSession({ band = '', title = '', at = () => new Date() } = {}) {
  let stream = null
  let recorder = null
  let wav = null
  let format = null
  let chunks = []
  let accumulated = 0
  let startedAt = 0
  let running = false
  let mode = 'idle'
  let disposed = false

  function elapsedMs() {
    const live = running ? performance.now() - startedAt : 0
    return accumulated + live
  }

  async function start() {
    if (mode === 'recording' || mode === 'paused') return
    stream = await openMic()
    if (disposed) {
      stopStream(stream)
      stream = null
      return null
    }
    format = pickRecordingFormat()
    chunks = []
    accumulated = 0
    startedAt = performance.now()
    running = true
    mode = 'recording'
    try {
      if (format.via === 'wav') {
        wav = startWavCapture(stream)
        return { format, canPause: true }
      }
      let rec
      try {
        rec = format.mime ? new MediaRecorder(stream, { mimeType: format.mime }) : new MediaRecorder(stream)
      } catch {
        rec = new MediaRecorder(stream)
        format = { mime: rec.mimeType || '', ext: format.ext || 'webm', via: 'media-recorder' }
      }
      recorder = rec
      rec.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) chunks.push(event.data)
      })
      rec.start()
      return { format, canPause: recorderSupportsPause() }
    } catch (error) {
      stopTracks()
      throw error
    }
  }

  function pause() {
    if (mode !== 'recording') return
    accumulated += performance.now() - startedAt
    running = false
    mode = 'paused'
    try { (wav || recorder)?.pause?.() } catch { /* pause unsupported */ }
  }

  function resume() {
    if (mode !== 'paused') return
    startedAt = performance.now()
    running = true
    mode = 'recording'
    try { (wav || recorder)?.resume?.() } catch { /* resume unsupported */ }
  }

  function buildResult(blob) {
    const mime = blob.type || format?.mime || (format?.ext === 'wav' ? 'audio/wav' : 'application/octet-stream')
    const ext = format?.ext || (mime.includes('wav') ? 'wav' : mime.includes('webm') ? 'webm' : 'm4a')
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: rehearsalFileName({ band, title, at: at(), ext }),
      mime,
      blob,
      durationMs: Math.round(elapsedMs()),
      createdAt: Date.now(),
    }
  }

  function stopTracks() {
    stopStream(stream)
    stream = null
    recorder = null
    wav = null
    running = false
    mode = 'idle'
  }

  async function blobFromRecorder() {
    if (wav) return wav.stop()
    const rec = recorder
    if (!rec || rec.state === 'inactive') {
      const type = format?.mime || 'application/octet-stream'
      return new Blob(chunks, { type })
    }
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        const type = rec.mimeType || format?.mime || 'application/octet-stream'
        resolve(new Blob(chunks, { type }))
      }
      rec.addEventListener('stop', finish, { once: true })
      try { rec.requestData?.() } catch { /* ignore */ }
      try { rec.stop() } catch { finish() }
    })
  }

  async function stop() {
    if (mode === 'idle') return null
    const blob = await blobFromRecorder()
    const result = buildResult(blob)
    stopTracks()
    return result
  }

  function dispose() {
    disposed = true
    if (mode === 'idle') {
      stopTracks()
      return Promise.resolve(null)
    }
    return stop()
  }

  return { start, pause, resume, stop, dispose, elapsedMs, get mode() { return mode } }
}

let dbPromise = null

function openRecordingsDb() {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.reject(new Error('IndexedDB unavailable'))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(RECORDINGS_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbPromise = null
      reject(req.error || new Error('IndexedDB open failed'))
    }
  })
  return dbPromise
}

function withStore(mode, fn) {
  return openRecordingsDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(RECORDINGS_STORE, mode)
    const store = tx.objectStore(RECORDINGS_STORE)
    let value
    let failed = false
    tx.oncomplete = () => { if (!failed) resolve(value) }
    tx.onerror = () => { failed = true; reject(tx.error || new Error('IndexedDB transaction failed')) }
    tx.onabort = () => { failed = true; reject(tx.error || new Error('IndexedDB transaction aborted')) }
    Promise.resolve()
      .then(() => fn(store))
      .then((result) => { value = result })
      .catch((error) => {
        failed = true
        reject(error)
        try { tx.abort() } catch { /* already finished */ }
      })
  }))
}

function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveRecording(record) {
  await withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const putReq = store.put(record)
    putReq.onerror = () => reject(putReq.error)
    putReq.onsuccess = () => {
      const allReq = store.getAll()
      allReq.onerror = () => reject(allReq.error)
      allReq.onsuccess = () => {
        const extra = [...(allReq.result || [])]
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(MAX_RECORDINGS)
        if (!extra.length) {
          resolve()
          return
        }
        let pending = extra.length
        extra.forEach((item) => {
          const del = store.delete(item.id)
          del.onerror = () => reject(del.error)
          del.onsuccess = () => {
            pending -= 1
            if (pending === 0) resolve()
          }
        })
      }
    }
  }))
}

export async function listRecordingMeta() {
  try {
    const all = await withStore('readonly', (store) => idbReq(store.getAll()))
    return [...(all || [])]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, MAX_RECORDINGS)
      .map(({ id, name, mime, createdAt, durationMs }) => ({ id, name, mime, createdAt, durationMs }))
  } catch {
    return []
  }
}

export async function getRecording(id) {
  try {
    return await withStore('readonly', (store) => idbReq(store.get(id)))
  } catch {
    return null
  }
}
