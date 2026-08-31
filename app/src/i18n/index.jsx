import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import de from './de.js'
import en from './en.js'

const STORAGE_KEY = 'songbook-locale'
const LocaleContext = createContext(null)
const catalogs = { de, en }

function detectInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'de' || stored === 'en') return stored
  } catch { /* ignore */ }
  const lang = String(typeof navigator !== 'undefined' ? (navigator.language || navigator.userLanguage || 'de') : 'de').toLowerCase()
  return lang.startsWith('de') ? 'de' : 'en'
}

function lookup(catalog, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), catalog)
}

function format(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : `{${key}}`))
}

export function translate(path, vars = {}, locale = 'de') {
  const primary = lookup(catalogs[locale] || catalogs.de, path)
  const fallback = lookup(catalogs.de, path)
  const raw = primary != null ? primary : (fallback != null ? fallback : path)
  return typeof raw === 'string' ? format(raw, vars) : String(raw)
}

/** For stores / non-React code. Uses localStorage locale when available. */
export function tStatic(path, vars = {}) {
  let locale = 'de'
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'de' || stored === 'en') locale = stored
    }
  } catch { /* ignore */ }
  return translate(path, vars, locale)
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(detectInitialLocale)

  const setLocale = useCallback((next) => {
    const value = next === 'en' ? 'en' : 'de'
    setLocaleState(value)
    try { localStorage.setItem(STORAGE_KEY, value) } catch { /* ignore */ }
    document.documentElement.lang = value === 'de' ? 'de' : 'en'
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'de' ? 'de' : 'en'
  }, [locale])

  const t = useCallback((path, vars) => translate(path, vars, locale), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useI18n requires LocaleProvider')
  return ctx
}
