import { useState } from 'react'
import { Upload, Trash2, RotateCcw, LogOut, RefreshCw } from 'lucide-react'
import { changePassword, deleteProfilePhoto, profilePhotoUrl, updateProfile, uploadProfilePhoto } from './authStore'
import { AuthorizedImg } from './AuthorizedMedia'
import { useI18n } from './i18n'
import { useTheme } from './theme.jsx'
import { checkForUpdates } from './updateCheck'
import { AboutDialog, UpdateDialog } from './AboutDialogs'
import { APP_VERSION } from './appMeta'

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1
    ? `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase()
    : (parts[0]?.slice(0, 2).toUpperCase() || '')
}

export default function SettingsPage({ user, onUser, onLogout, onRestartOnboarding, Header }) {
  const { t, locale, setLocale } = useI18n()
  const { theme, setTheme } = useTheme()
  const [profile, setProfile] = useState({
    name: user.name,
    username: user.username,
    email: user.email,
  })
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [securityMessage, setSecurityMessage] = useState('')
  const [securityError, setSecurityError] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateResult, setUpdateResult] = useState(undefined)
  const [aboutOpen, setAboutOpen] = useState(false)

  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await uploadProfilePhoto(file)
      onUser(result.user)
      setProfileMessage(t('settings.photoSaved'))
    } catch (e) {
      setProfileError(e.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  const removePhoto = async () => {
    setPhotoBusy(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await deleteProfilePhoto()
      onUser(result.user)
      setProfileMessage(t('settings.photoRemoved'))
    } catch (e) {
      setProfileError(e.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  const saveProfile = async () => {
    setProfileBusy(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await updateProfile(profile)
      onUser(result.user)
      setProfileMessage(t('settings.profileSaved'))
    } catch (e) {
      setProfileError(e.message)
    } finally {
      setProfileBusy(false)
    }
  }

  const savePassword = async () => {
    setPasswordBusy(true)
    setSecurityError('')
    setSecurityMessage('')
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrent('')
      setNext('')
      setSecurityMessage(t('settings.passwordChanged'))
    } catch (e) {
      setSecurityError(e.message)
    } finally {
      setPasswordBusy(false)
    }
  }

  return (
    <>
      <Header title={t('settings.title')} subtitle={t('settings.subtitle')}/>
      <div className="settings-page">
        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.profileTitle')}</p>
            <h2>{t('settings.profileTitle')}</h2>
            <p>{t('settings.profileHint')}</p>
          </div>

          <div className="settings-profile-layout">
            <div className="settings-profile-photo">
              <div className="account-photo">
                {user.hasPhoto
                  ? <AuthorizedImg path={profilePhotoUrl(user)} alt=""/>
                  : <span>{initials(user.name)}</span>}
              </div>
              <div className="settings-profile-photo-actions">
                <label className="settings-action profile-photo-button">
                  <Upload size={16}/>
                  {photoBusy ? t('settings.saving') : (user.hasPhoto ? t('settings.newPhoto') : t('settings.uploadPhoto'))}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={photoBusy} onChange={uploadPhoto}/>
                </label>
                {user.hasPhoto && (
                  <button type="button" className="profile-photo-remove" disabled={photoBusy} onClick={removePhoto}>
                    <Trash2 size={16}/>{t('settings.removePhoto')}
                  </button>
                )}
                <small>{t('settings.photoHint')}</small>
              </div>
            </div>

            <div className="settings-profile-fields">
              <label className="settings-field-stack">
                {t('settings.name')}
                <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} autoComplete="name"/>
              </label>
              <label className="settings-field-stack">
                {t('settings.username')}
                <input value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} autoComplete="username"/>
              </label>
              <label className="settings-field-stack settings-email-field">
                {t('settings.email')}
                <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} autoComplete="email"/>
              </label>
              <button type="button" className="settings-action settings-save-profile" disabled={profileBusy} onClick={saveProfile}>
                {profileBusy ? t('settings.saving') : t('settings.saveProfile')}
              </button>
              <p className="settings-role-badge">
                {user.role === 'admin' ? t('settings.admin') : t('settings.personal')}
              </p>
            </div>
          </div>

          {profileMessage && <p className="settings-message">{profileMessage}</p>}
          {profileError && <p className="auth-error">{profileError}</p>}
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.securityTitle')}</p>
            <h2>{t('settings.securityTitle')}</h2>
            <p>{t('settings.securityHint')}</p>
          </div>
          <div className="settings-field-grid settings-security-grid">
            <label>
              {t('settings.currentPassword')}
              <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password"/>
            </label>
            <label>
              {t('settings.newPassword')}
              <input type="password" minLength="8" value={newPassword} onChange={(e) => setNext(e.target.value)} autoComplete="new-password"/>
            </label>
          </div>
          <div className="settings-card-actions">
            <button type="button" className="settings-action" disabled={passwordBusy || !currentPassword || newPassword.length < 8} onClick={savePassword}>
              {passwordBusy ? t('settings.saving') : t('settings.changePassword')}
            </button>
          </div>
          {securityMessage && <p className="settings-message">{securityMessage}</p>}
          {securityError && <p className="auth-error">{securityError}</p>}
        </section>

        <section className="settings-card settings-card-muted">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.setupTitle')}</p>
            <h2>{t('settings.setupTitle')}</h2>
            <p>{t('settings.setupHint')}</p>
          </div>
          <button type="button" className="settings-secondary" onClick={onRestartOnboarding}>
            <RotateCcw size={16}/>{t('settings.restartSetup')}
          </button>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.appearanceTitle')}</p>
            <h2>{t('settings.appearanceTitle')}</h2>
            <p>{t('settings.appearanceHint')}</p>
          </div>
          <label className="settings-field-stack">
            {t('settings.theme')}
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="auto">{t('settings.themeAuto')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </select>
            <small>{t('settings.themeAutoHint')}</small>
          </label>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.languageTitle')}</p>
            <h2>{t('settings.languageTitle')}</h2>
            <p>{t('settings.languageHint')}</p>
          </div>
          <label className="settings-field-stack">
            {t('settings.language')}
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="de">{t('settings.langDe')}</option>
              <option value="en">{t('settings.langEn')}</option>
            </select>
          </label>
          <div className="settings-card-actions" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="settings-secondary"
              onClick={async () => {
                setUpdateResult(undefined)
                setUpdateOpen(true)
                try {
                  setUpdateResult(await checkForUpdates())
                } catch (error) {
                  setUpdateResult({ status: 'error', message: error?.message || String(error) })
                }
              }}
            >
              <RefreshCw size={16}/>{t('updates.title')}
            </button>
            <button type="button" className="settings-secondary" onClick={() => setAboutOpen(true)}>
              {t('about.title')} · {APP_VERSION}
            </button>
          </div>
        </section>

        <section className="settings-card settings-card-logout">
          <div className="settings-card-head">
            <p className="eyebrow">{t('settings.logoutTitle')}</p>
            <h2>{t('settings.logoutTitle')}</h2>
            <p>{t('settings.logoutHint')}</p>
          </div>
          <button type="button" className="logout-button" onClick={onLogout}>
            <LogOut size={17}/>{t('settings.logoutSafe')}
          </button>
        </section>
      </div>
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)}/>}
      {updateOpen && <UpdateDialog result={updateResult} onClose={() => { setUpdateOpen(false); setUpdateResult(undefined) }}/>}
    </>
  )
}
