import { useEffect, useState } from 'react'
import { createSetAutosave } from './setAutosave'
import { cacheContextToken } from './offlineCache'
import { saveSet } from './setStore'

const queues = new Map()
export function useSetSaveExitWarning() {
  useEffect(() => {
    const warn = (event) => {
      if (![...queues.values()].some((item) => item.hasPending())) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
}
export function useSetAutosave(set) {
  const context = cacheContextToken()
  const key = `${context}:${set?.id || ''}`
  if (set && !queues.has(key)) {
    const queue = createSetAutosave({ save: saveSet, initialRevision: set.revision ?? 0, isCurrent: () => context === cacheContextToken() })
    queues.set(key, queue)
  }
  const queue = queues.get(key)
  const [status, setStatus] = useState({ state: 'idle', error: null })
  useEffect(() => queue?.subscribe(setStatus), [queue])
  return { queue, status }
}
