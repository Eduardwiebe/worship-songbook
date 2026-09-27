import { useEffect, useState } from 'react'
import { useI18n } from './i18n'
import { isNativeRuntime } from './apiConfig'
import {
  readStandaloneTipDismissedAt,
  standaloneTipDecision,
  writeStandaloneTipDismissedAt,
} from './standaloneDisplay'

function currentDecision() {
  const nav = window.navigator || {}
  let displayMode = 'browser'
  try {
    if (window.matchMedia('(display-mode: fullscreen)').matches) displayMode = 'fullscreen'
    else if (window.matchMedia('(display-mode: standalone)').matches) displayMode = 'standalone'
  } catch {
    /* ignore */
  }
  return standaloneTipDecision({
    userAgent: nav.userAgent || '',
    platform: nav.platform || '',
    maxTouchPoints: nav.maxTouchPoints || 0,
    displayMode,
    navigatorStandalone: nav.standalone === true,
    native: isNativeRuntime(),
    dismissedAt: readStandaloneTipDismissedAt(window.localStorage),
  })
}

export function StandaloneTip({ inFlow = false }) {
  const { t } = useI18n()
  const [decision, setDecision] = useState({ show: false, variant: null })

  useEffect(() => {
    const sync = () => setDecision(currentDecision())
    sync()
    const queries = ['(display-mode: standalone)', '(display-mode: fullscreen)']
    const media = queries.map((query) => window.matchMedia(query))
    media.forEach((mq) => mq.addEventListener?.('change', sync))
    return () => media.forEach((mq) => mq.removeEventListener?.('change', sync))
  }, [])

  if (!decision.show) return null

  const dismiss = () => {
    writeStandaloneTipDismissedAt(window.localStorage)
    setDecision({ show: false, variant: null })
  }

  const safari = decision.variant === 'safari'

  return (
    <aside
      className={`standalone-tip${inFlow ? ' in-flow' : ''}`}
      role="region"
      aria-label={t('standaloneTip.title')}
      data-standalone-tip={decision.variant}
    >
      <div className="standalone-tip-copy">
        <strong>{t('standaloneTip.title')}</strong>
        <p>{safari ? t('standaloneTip.body') : t('standaloneTip.otherBrowser')}</p>
        {safari && <p className="standalone-tip-steps">{t('standaloneTip.steps')}</p>}
        <a href="/install/">{t('standaloneTip.guide')}</a>
      </div>
      <button type="button" className="standalone-tip-dismiss" onClick={dismiss}>
        {t('standaloneTip.later')}
      </button>
    </aside>
  )
}
