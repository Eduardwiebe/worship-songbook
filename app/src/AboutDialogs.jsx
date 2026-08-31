import { Music2 } from 'lucide-react'
import { useI18n } from './i18n'
import { openExternal } from './openExternal'
import {
  APP_NAME,
  APP_VERSION,
  APP_COPYRIGHT,
  APP_AUTHOR,
  URL_LYRUMA_STUDIO,
  URL_EDUARD_WIEBE,
  URL_GITHUB_RELEASES,
} from './appMeta'

export function AboutDialog({ onClose }) {
  const { t } = useI18n()
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal about-modal">
        <div className="modal-header">
          <div className="about-brand">
            <span className="brand-mark">L</span>
            <div>
              <p className="eyebrow">{APP_NAME}</p>
              <h2>{t('about.title')}</h2>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('about.close')}>×</button>
        </div>
        <div className="about-body">
          <p><Music2 size={16}/> {t('about.version', { version: APP_VERSION })}</p>
          <p>{APP_COPYRIGHT}</p>
          <p>{t('about.developedBy')}</p>
          <p className="about-websites-label">{t('about.websites')}</p>
          <nav className="about-links">
            <button type="button" onClick={() => openExternal(URL_LYRUMA_STUDIO)}>{URL_LYRUMA_STUDIO}</button>
            <button type="button" onClick={() => openExternal(URL_EDUARD_WIEBE)}>{URL_EDUARD_WIEBE}</button>
          </nav>
          <p className="about-author">{APP_AUTHOR}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="add-button compact" onClick={onClose}>{t('about.close')}</button>
        </div>
      </section>
    </div>
  )
}

export function UpdateDialog({ result, onClose }) {
  const { t } = useI18n()
  const checking = !result
  const error = result?.status === 'error'
  const available = result?.status === 'updateAvailable'
  const upToDate = result?.status === 'upToDate'

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal">
        <div className="modal-header">
          <div>
            <p className="eyebrow">{APP_NAME}</p>
            <h2>{t('updates.title')}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('updates.close')}>×</button>
        </div>
        <div className="about-body">
          {checking && <p>{t('updates.checking')}</p>}
          {error && <p className="auth-error">{result.message || t('updates.error')}</p>}
          {upToDate && (
            <>
              <p>{t('updates.upToDate')}</p>
              <p>{t('updates.current', { version: result.currentVersion || APP_VERSION })}</p>
            </>
          )}
          {available && (
            <>
              <p><strong>{t('updates.available', { version: result.latestVersion })}</strong></p>
              <p>{t('updates.current', { version: result.currentVersion || APP_VERSION })}</p>
              <p className="settings-role-badge">{t('updates.phaseNote')}</p>
            </>
          )}
        </div>
        <div className="modal-actions">
          {available && (
            <button type="button" className="add-button compact" onClick={() => openExternal(result.releaseUrl || URL_GITHUB_RELEASES)}>
              {t('updates.openRelease')}
            </button>
          )}
          <button type="button" className="cancel-button" onClick={onClose}>{t('updates.close')}</button>
        </div>
      </section>
    </div>
  )
}
