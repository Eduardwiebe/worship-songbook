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

export function LegalLinks({ className = 'legal-links-list' }) {
  const { t } = useI18n()
  return <nav className={className} aria-label={t('footer.ariaLegal')}>
    <a href="/impressum.html" target="_blank" rel="noreferrer">{t('footer.imprint')}</a>
    <a href="/datenschutz.html" target="_blank" rel="noreferrer">{t('footer.privacy')}</a>
    <a href="/nutzungsbedingungen.html" target="_blank" rel="noreferrer">{t('footer.terms')}</a>
  </nav>
}
