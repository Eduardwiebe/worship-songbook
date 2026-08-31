import { isNativeRuntime } from './apiConfig'
import { isLikelyMobileNative } from './nativePlatform'
import { openExternal } from './openExternal'
import {
  APP_NAME,
  APP_VERSION,
  APP_COPYRIGHT,
  SUPPORT_EMAIL,
  URL_EDUARD_WIEBE,
  URL_LYRUMA_STUDIO,
  URL_GITHUB_REPO,
} from './appMeta'
import { checkForUpdates } from './updateCheck'

/**
 * Builds a localized Tauri desktop menu.
 * Replaces the default WKWebView/OS menu where possible — including Help items
 * such as “Send … Feedback to Apple”, which appear when no custom Help menu is set.
 *
 * System-owned items that macOS injects outside our Menu API (if any) are not
 * controllable; those are documented in docs/MACOS.md.
 */
export async function installNativeDesktopChrome({ t, locale, onAbout, onSettings, onUpdateResult }) {
  if (!isNativeRuntime()) return () => {}
  // iPhone / iPad / Android: no desktop menu bar — do not force macOS menu logic.
  if (isLikelyMobileNative()) return () => {}

  const {
    Menu,
    MenuItem,
    PredefinedMenuItem,
    Submenu,
  } = await import('@tauri-apps/api/menu')

  let { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()

  const about = await MenuItem.new({
    id: 'about',
    text: t('menu.about'),
    action: () => onAbout?.(),
  })
  const checkUpdates = await MenuItem.new({
    id: 'check-updates',
    text: t('menu.checkUpdates'),
    action: async () => {
      try {
        const result = await checkForUpdates()
        onUpdateResult?.(result)
      } catch (error) {
        onUpdateResult?.({ status: 'error', message: error?.message || String(error) })
      }
    },
  })
  const settings = await MenuItem.new({
    id: 'settings',
    text: t('menu.settings'),
    action: () => onSettings?.(),
  })
  const quit = await PredefinedMenuItem.new({ item: 'Quit', text: t('menu.quit') })
  const sep1 = await PredefinedMenuItem.new({ item: 'Separator' })
  const sep2 = await PredefinedMenuItem.new({ item: 'Separator' })

  const appSub = await Submenu.new({
    text: APP_NAME,
    items: [about, checkUpdates, sep1, settings, sep2, quit],
  })

  const editSub = await Submenu.new({
    text: t('menu.edit'),
    items: [
      await PredefinedMenuItem.new({ item: 'Undo', text: t('menu.undo') }),
      await PredefinedMenuItem.new({ item: 'Redo', text: t('menu.redo') }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Cut', text: t('menu.cut') }),
      await PredefinedMenuItem.new({ item: 'Copy', text: t('menu.copy') }),
      await PredefinedMenuItem.new({ item: 'Paste', text: t('menu.paste') }),
      await PredefinedMenuItem.new({ item: 'SelectAll', text: t('menu.selectAll') }),
    ],
  })

  const viewSub = await Submenu.new({
    text: t('menu.view'),
    items: [
      await PredefinedMenuItem.new({ item: 'Fullscreen', text: t('menu.fullscreen') }),
    ],
  })

  const windowSub = await Submenu.new({
    text: t('menu.window'),
    items: [
      await PredefinedMenuItem.new({ item: 'Minimize', text: t('menu.minimize') }),
      await PredefinedMenuItem.new({ item: 'Maximize', text: t('menu.zoom') }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'CloseWindow', text: t('menu.closeWindow') }),
    ],
  })

  const helpDocs = await MenuItem.new({
    id: 'help-docs',
    text: t('menu.helpItem'),
    action: () => openExternal(`${URL_GITHUB_REPO}#readme`),
  })
  const contact = await MenuItem.new({
    id: 'contact-support',
    text: t('menu.contactSupport'),
    action: () => openExternal(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} ${APP_VERSION}`)}`),
  })
  const lyruma = await MenuItem.new({
    id: 'lyruma-studio',
    text: t('menu.lyrumaStudio'),
    action: () => openExternal(URL_LYRUMA_STUDIO),
  })
  const eduard = await MenuItem.new({
    id: 'eduard-wiebe',
    text: t('menu.eduardWiebe'),
    action: () => openExternal(URL_EDUARD_WIEBE),
  })

  const helpSub = await Submenu.new({
    text: t('menu.help'),
    items: [helpDocs, contact, await PredefinedMenuItem.new({ item: 'Separator' }), lyruma, eduard],
  })

  const menu = await Menu.new({
    items: [appSub, editSub, viewSub, windowSub, helpSub],
  })
  await menu.setAsAppMenu()

  // Ensure window title stays product name
  try {
    await appWindow.setTitle(APP_NAME)
  } catch { /* ignore */ }

  void locale
  void APP_COPYRIGHT

  return async () => {
    /* Menu replaced on next install; no explicit dispose required */
  }
}
