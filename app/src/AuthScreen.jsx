import { useState } from 'react'
import { Music2, LockKeyhole } from 'lucide-react'
import { login, register, changePassword, logout } from './authStore'
import { useI18n } from './i18n'
import { URL_LYRUMA_STUDIO } from './appMeta'

export function AuthScreen({ onAuthenticated }) {
  const { t } = useI18n()
  const [gate, setGate] = useState('choice') // choice | login | register
  const [values, setValues] = useState({ name: '', username: '', email: '', identifier: '', password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const result = gate === 'login'
        ? await login({ identifier: values.identifier, password: values.password })
        : await register({ name: values.name, username: values.username, email: values.email, password: values.password })
      onAuthenticated(result.user)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const field = (key) => ({
    value: values[key],
    onChange: (event) => setValues((current) => ({ ...current, [key]: event.target.value })),
  })

  const tagline = t('auth.tagline').split('\n')

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <a className="brand" href={URL_LYRUMA_STUDIO} target="_blank" rel="noreferrer">
          <div className="brand-mark">L</div>
          <div><strong>{t('brand.lyruma')}</strong><span>{t('brand.worship')}</span></div>
        </a>
        <div>
          <p className="eyebrow">{t('auth.title')}</p>
          <h1>{tagline[0]}<br/>{tagline[1]}</h1>
          <p>{t('auth.subtitle')}</p>
        </div>
      </section>

      <section className="auth-card">
        {gate === 'choice' && (
          <div className="auth-choice">
            <div className="auth-card-head">
              <Music2 size={27}/>
              <div>
                <h2>{t('auth.title')}</h2>
                <p>{t('auth.subtitle')}</p>
              </div>
            </div>

            <div className="auth-choice-block">
              <p className="auth-choice-label">{t('auth.haveAccount')}</p>
              <button type="button" className="auth-submit" onClick={() => { setGate('login'); setError('') }}>
                {t('auth.signIn')}
              </button>
            </div>

            <div className="auth-choice-divider" aria-hidden="true"/>

            <div className="auth-choice-block">
              <p className="auth-choice-label">{t('auth.newHere')}</p>
              <button type="button" className="auth-submit auth-submit-secondary" onClick={() => { setGate('register'); setError('') }}>
                {t('auth.createAccount')}
              </button>
            </div>
          </div>
        )}

        {gate !== 'choice' && (
          <>
            <div className="auth-card-head">
              <Music2 size={27}/>
              <div>
                <h2>{gate === 'login' ? t('auth.signIn') : t('auth.createAccount')}</h2>
                <p>{gate === 'login' ? t('auth.welcomeBack') : t('auth.createHint')}</p>
              </div>
            </div>
            <form onSubmit={submit}>
              {gate === 'register' && (
                <>
                  <label>{t('auth.name')}<input required autoComplete="name" {...field('name')}/></label>
                  <label>{t('auth.username')}<input required minLength="3" autoComplete="username" {...field('username')}/></label>
                  <label>{t('auth.email')}<input required type="email" autoComplete="email" {...field('email')}/></label>
                </>
              )}
              {gate === 'login' && (
                <label>{t('auth.identifier')}<input required autoComplete="username" autoFocus {...field('identifier')}/></label>
              )}
              <label>{t('auth.password')}<input required minLength="8" type="password" autoComplete={gate === 'login' ? 'current-password' : 'new-password'} {...field('password')}/></label>
              {error && <p className="auth-error">{error}</p>}
              <button className="auth-submit" disabled={saving}>
                {saving ? t('auth.wait') : (gate === 'login' ? t('auth.signIn') : t('auth.registerFree'))}
              </button>
            </form>
            <button className="auth-switch" onClick={() => { setGate('choice'); setError('') }}>
              {t('auth.backToChoice')}
            </button>
            <small>{t('auth.separateHint')}</small>
          </>
        )}
      </section>
    </main>
  )
}

export function PasswordRequired({ user, onChanged, onLogout }) {
  const { t } = useI18n()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (newPassword !== repeat) return setError(t('auth.passwordMismatch'))
    setSaving(true)
    setError('')
    try {
      const result = await changePassword({ currentPassword, newPassword })
      onChanged(result.user)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="auth-page password-page">
      <section className="auth-card">
        <div className="auth-card-head">
          <LockKeyhole size={28}/>
          <div>
            <p className="eyebrow">{t('auth.security')}</p>
            <h2>{t('auth.setOwnPassword')}</h2>
            <p>{t('auth.helloUser', { name: user.name })}</p>
          </div>
        </div>
        <form onSubmit={submit}>
          <label>{t('auth.currentPassword')}<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)}/></label>
          <label>{t('auth.newPassword')}<input required minLength="8" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNext(e.target.value)}/></label>
          <label>{t('auth.repeatPassword')}<input required minLength="8" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)}/></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" disabled={saving}>{saving ? t('auth.saving') : t('auth.changePasswordOpen')}</button>
        </form>
        <button className="auth-switch" onClick={onLogout || (async () => { await logout() })}>{t('auth.logout')}</button>
      </section>
    </main>
  )
}
