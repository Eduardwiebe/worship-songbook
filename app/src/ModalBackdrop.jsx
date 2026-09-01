import { useCallback, useEffect } from 'react'
import { dismissModal, lockBodyScroll, logViewportState, unlockBodyScroll } from './modalLock'

/**
 * Shared modal shell: overflow lock without position:fixed body hack,
 * blur + viewport restore on dismiss via dismissModal().
 */
export function ModalBackdrop({ onClose, children, className = '' }) {
  const requestClose = useCallback(() => dismissModal(onClose), [onClose])

  useEffect(() => {
    lockBodyScroll()
    logViewportState('modal-open')
    return () => {
      unlockBodyScroll()
    }
  }, [])

  return (
    <div
      className={`modal-backdrop${className ? ` ${className}` : ''}`}
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      {children}
    </div>
  )
}
