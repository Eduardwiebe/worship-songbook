import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'songbook-theme'
const ThemeContext = createContext(null)

function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveEffective(theme) {
  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return systemPrefersDark() ? 'dark' : 'light'
}

function applyTheme(theme) {
  const effective = resolveEffective(theme)
  document.documentElement.dataset.themePref = theme
  document.documentElement.dataset.theme = effective
  document.documentElement.dataset.colorScheme = effective
  document.documentElement.style.colorScheme = effective
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
    } catch { /* ignore */ }
    return 'auto'
  })

  const setTheme = useCallback((next) => {
    const value = next === 'light' || next === 'dark' || next === 'auto' ? next : 'auto'
    setThemeState(value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'auto' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('auto')
    mq.addEventListener?.('change', onChange)
    mq.addListener?.(onChange)
    return () => {
      mq.removeEventListener?.('change', onChange)
      mq.removeListener?.(onChange)
    }
  }, [theme])

  const value = useMemo(() => ({
    theme,
    setTheme,
    effective: resolveEffective(theme),
  }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme requires ThemeProvider')
  return ctx
}
