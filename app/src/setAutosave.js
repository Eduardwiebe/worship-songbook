// One request at a time. New edits replace the waiting snapshot, never the
// request already in flight. Failed drafts stay pending until an explicit retry.
export function createSetAutosave({ save, delay = 350, initialRevision = 0, isCurrent = () => true }) {
  let pending = null
  let saving = false
  let revision = initialRevision
  let timer
  let status = { state: 'idle', error: null }
  const listeners = new Set()
  const emit = (state, error = null) => {
    status = { state, error }
    listeners.forEach((listener) => listener(status))
  }
  const drain = async (retry = false) => {
    clearTimeout(timer)
    if (status.state === 'conflict' || (status.state === 'error' && !retry)) return
    if (saving || !pending || !isCurrent()) return
    const draft = pending
    pending = null
    saving = true
    emit('saving')
    try {
      const result = await save({ ...draft, revision })
      revision = result.revision ?? revision
      saving = false
      if (!isCurrent()) { pending = null; emit('idle'); return }
      if (pending) void drain()
      else emit('saved')
    } catch (error) {
      saving = false
      pending ||= draft
      if (!isCurrent()) { pending = null; emit('idle'); return }
      emit(error.status === 409 ? 'conflict' : 'error', error)
    }
  }
  return {
    submit(draft) {
      pending = draft
      if (status.state === 'error' || status.state === 'conflict') return
      emit('saving')
      clearTimeout(timer)
      timer = setTimeout(() => void drain(), delay)
    },
    retry() { if (status.state !== 'conflict') void drain(true) },
    reset(nextRevision) {
      if (saving) return false
      clearTimeout(timer)
      pending = null
      revision = nextRevision ?? 0
      emit('idle')
      return true
    },
    hasPending: () => isCurrent() && Boolean(pending || saving),
    subscribe(listener) { listeners.add(listener); listener(status); return () => listeners.delete(listener) },
  }
}
