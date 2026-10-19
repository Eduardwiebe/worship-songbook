import { useI18n } from './i18n'
import { URL_EDUARD_WIEBE, URL_FACILITY_DESK, URL_LYRUMA_STUDIO, URL_SOUNDCLOUD } from './appMeta'

/** Eduard Wiebe's other websites — one list for login screen and app footer. */
export function SiteLinks({ className = 'site-links-list' }) {
  const { t } = useI18n()
  const sites = [
    [URL_LYRUMA_STUDIO, t('footer.siteLyruma')],
    [URL_FACILITY_DESK, t('footer.siteFacilityDesk')],
    [URL_EDUARD_WIEBE, t('footer.siteArtist')],
    [URL_SOUNDCLOUD, t('footer.siteSoundcloud')],
  ]
  return <nav className={className} aria-label={t('footer.moreSites')}>
    {sites.map(([href, label]) => <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
  </nav>
}

const LYRUMA_PROMO_URL = 'https://lyruma.de/?utm_source=songbook&utm_medium=banner&utm_campaign=eigenwerbung'

/** Dezentes Lyruma-Eigenwerbebanner (kein Tracking, nur UTM-Link). */
export function LyrumaPromo({ compact = false }) {
  const { t } = useI18n()
  return <aside className={`lyruma-promo${compact ? ' lyruma-promo--compact' : ''}`} aria-label={t('promo.aria')}>
    <span className="lyruma-promo-mark" aria-hidden="true">L</span>
    <p>{t('promo.text')}</p>
    <a href={LYRUMA_PROMO_URL} target="_blank" rel="noopener">{t('promo.cta')}</a>
  </aside>
}

export function LegalLinks({ className = 'legal-links-list' }) {
  const { t } = useI18n()
  return <nav className={className} aria-label={t('footer.ariaLegal')}>
    <a href="/impressum.html" target="_blank" rel="noreferrer">{t('footer.imprint')}</a>
    <a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('footer.privacy')}</a>
    <a href="/nutzungsbedingungen.html" target="_blank" rel="noreferrer">{t('footer.terms')}</a>
  </nav>
}
