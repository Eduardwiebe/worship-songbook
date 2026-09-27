#!/usr/bin/env node
/**
 * Home Screen tip: Safari tabs on iOS/iPadOS only, never standalone/fullscreen.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STANDALONE_TIP_DISMISS_MS,
  isIosLikeDevice,
  isStandaloneDisplay,
  standaloneTipDecision,
} from '../app/src/standaloneDisplay.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = Date.parse('2026-09-27T12:00:00Z')
const ipadSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'
const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'
const ipadChrome = 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1'
const desktopSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'

const ipad = standaloneTipDecision({
  userAgent: ipadSafari,
  platform: 'MacIntel',
  maxTouchPoints: 5,
  now,
})
assert.equal(ipad.show, true)
assert.equal(ipad.variant, 'safari')

assert.equal(isIosLikeDevice({
  userAgent: ipadSafari,
  platform: 'MacIntel',
  maxTouchPoints: 5,
}), true)

assert.deepEqual(standaloneTipDecision({
  userAgent: iphoneSafari,
  platform: 'iPhone',
  maxTouchPoints: 5,
  now,
}), { show: true, variant: 'safari' })

assert.deepEqual(standaloneTipDecision({
  userAgent: ipadChrome,
  platform: 'iPad',
  maxTouchPoints: 5,
  now,
}), { show: true, variant: 'other' })

assert.deepEqual(standaloneTipDecision({
  userAgent: iphoneSafari,
  platform: 'iPhone',
  maxTouchPoints: 5,
  navigatorStandalone: true,
  now,
}), { show: false, variant: null })

assert.deepEqual(standaloneTipDecision({
  userAgent: ipadSafari,
  platform: 'MacIntel',
  maxTouchPoints: 5,
  displayMode: 'standalone',
  now,
}), { show: false, variant: null })

assert.deepEqual(standaloneTipDecision({
  userAgent: ipadSafari,
  platform: 'MacIntel',
  maxTouchPoints: 5,
  displayMode: 'fullscreen',
  now,
}), { show: false, variant: null })

assert.deepEqual(standaloneTipDecision({
  userAgent: ipadSafari,
  platform: 'MacIntel',
  maxTouchPoints: 5,
  native: true,
  now,
}), { show: false, variant: null })

assert.deepEqual(standaloneTipDecision({
  userAgent: desktopSafari,
  platform: 'MacIntel',
  maxTouchPoints: 0,
  now,
}), { show: false, variant: null })

assert.deepEqual(standaloneTipDecision({
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
  now,
}), { show: false, variant: null })

const recent = standaloneTipDecision({
  userAgent: iphoneSafari,
  platform: 'iPhone',
  maxTouchPoints: 5,
  dismissedAt: String(now - 60 * 60 * 1000),
  now,
})
assert.equal(recent.show, false)

const expired = standaloneTipDecision({
  userAgent: iphoneSafari,
  platform: 'iPhone',
  maxTouchPoints: 5,
  dismissedAt: String(now - STANDALONE_TIP_DISMISS_MS - 1000),
  now,
})
assert.equal(expired.show, true)
assert.equal(expired.variant, 'safari')

assert.equal(standaloneTipDecision({
  userAgent: iphoneSafari,
  platform: 'iPhone',
  maxTouchPoints: 5,
  dismissedAt: 'not-a-date',
  now,
}).show, true)

const standaloneWin = {
  navigator: { standalone: true },
  matchMedia: () => ({ matches: false }),
}
assert.equal(isStandaloneDisplay(standaloneWin), true)
assert.equal(isStandaloneDisplay({
  navigator: {},
  matchMedia: (query) => ({ matches: query.includes('fullscreen') }),
}), true)
assert.equal(isStandaloneDisplay({
  navigator: { standalone: false },
  matchMedia: () => ({ matches: false }),
}), false)

const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
const tip = readFileSync(join(root, 'app/src/StandaloneTip.jsx'), 'utf8')
const html = readFileSync(join(root, 'app/index.html'), 'utf8')
const install = readFileSync(join(root, 'app/public/install/index.html'), 'utf8')
const vite = readFileSync(join(root, 'app/vite.config.js'), 'utf8')
assert.match(app, /<StandaloneTip/)
assert.match(tip, /href="\/install\/"/)
assert.match(tip, /writeStandaloneTipDismissedAt/)
assert.match(html, /mobile-web-app-capable/)
assert.match(html, /apple-mobile-web-app-capable/)
assert.match(install, /Icon öffnen/)
assert.match(install, /iPad sitzt es oben/)
assert.doesNotMatch(install, /Tippe unten in Safari/)
assert.ok(vite.includes('navigateFallbackDenylist: [/^\\/api\\//, /^\\/install(?:\\/|$)/, /^\\/join(?:\\/|$)/]'))

console.log('test-standalone-tip: all passed')
