#!/usr/bin/env node
/**
 * Static checks for central modal lock + iOS viewport restore (modalLock.js).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modalLock = readFileSync(join(root, 'app/src/modalLock.js'), 'utf8')
const modalBackdrop = readFileSync(join(root, 'app/src/ModalBackdrop.jsx'), 'utf8')
const appJsx = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
const aboutDialogs = readFileSync(join(root, 'app/src/AboutDialogs.jsx'), 'utf8')
const html = readFileSync(join(root, 'app/index.html'), 'utf8')
const mobileCss = readFileSync(join(root, 'app/src/mobile-layout.css'), 'utf8')

const checks = [
  ['modalLock.js exists', existsSync(join(root, 'app/src/modalLock.js'))],
  ['ModalBackdrop.jsx exists', existsSync(join(root, 'app/src/ModalBackdrop.jsx'))],
  ['no body position fixed hack', !/body\.style\.position\s*=\s*['"]fixed['"]/.test(modalLock)],
  ['lock uses overflow hidden only', /document\.body\.style\.overflow\s*=\s*'hidden'/.test(modalLock)],
  ['clearInlineScrollLockStyles removes body props', /clearInlineScrollLockStyles/.test(modalLock)],
  ['scheduleViewportRestore at 0/100/300/600ms', /\[100,\s*300,\s*600\]/.test(modalLock)],
  ['dismissModal blurs active element', /export function dismissModal[\s\S]*blurActiveElement/.test(modalLock)],
  ['visualViewport metrics logged', /visualViewportScale/.test(modalLock)],
  ['ModalBackdrop uses lockBodyScroll', /lockBodyScroll\(\)/.test(modalBackdrop)],
  ['ModalBackdrop dismiss via dismissModal', /dismissModal\(onClose\)/.test(modalBackdrop)],
  ['TeamDialog uses ModalBackdrop', /function TeamDialog[\s\S]*ModalBackdrop/.test(appJsx)],
  ['CreateSetDialog uses ModalBackdrop', /function CreateSetDialog[\s\S]*ModalBackdrop/.test(appJsx)],
  ['AboutDialog uses ModalBackdrop', /ModalBackdrop/.test(aboutDialogs)],
  ['no user-scalable=no', !/user-scalable\s*=\s*no/i.test(html)],
  ['no maximum-scale=1 lock', !/maximum-scale\s*=\s*1/i.test(html)],
  ['mobile form controls 16px', /\.field input,[\s\S]*font-size:\s*16px/.test(mobileCss)],
  ['modal max-height uses vh not dvh', /max-height:[\s\S]*90vh/.test(mobileCss) && !/100dvh/.test(mobileCss)],
  ['main installs viewport debug', /installViewportDebug/.test(readFileSync(join(root, 'app/src/main.jsx'), 'utf8'))],
]

let failed = 0
for (const [label, ok] of checks) {
  if (ok) console.log(`OK ${label}`)
  else {
    console.error(`FAIL ${label}`)
    failed += 1
  }
}

if (failed) process.exit(1)
console.log('test-modal-lock: all passed')
