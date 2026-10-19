import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import './mobile-layout.css'
import { installViewportDebug } from './modalLock'
import App from './App.jsx'
import { LocaleProvider } from './i18n'
import { ThemeProvider } from './theme.jsx'
import { isNativeRuntime } from './apiConfig'

// The app uses hash routes. Old/shared path links like /sets/<id> would
// otherwise silently show the home page — rewrite them to /#/sets/<id>.
if (typeof window !== 'undefined' && !window.location.hash) {
  const deep = window.location.pathname.match(/^\/(songs|sets|bands|team|termine|einstellungen)(\/[^?#]*)?\/?$/)
  if (deep) window.history.replaceState(null, '', `/#${window.location.pathname.replace(/\/$/, '')}${window.location.search}`)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
)

installViewportDebug()

async function registerWebPwa() {
  if (isNativeRuntime()) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        // Prefer fresh SW checks; IndexedDB offline data stays untouched.
        registration.update().catch(() => {})
      },
    })
  } catch (error) {
    console.warn('[pwa] service worker registration skipped', error)
  }
}

registerWebPwa()
