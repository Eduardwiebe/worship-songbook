#!/usr/bin/env node
/**
 * Static checks for responsive layout root-cause fixes.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mobileCss = readFileSync(join(root, 'app/src/mobile-layout.css'), 'utf8')
const appCss = readFileSync(join(root, 'app/src/App.css'), 'utf8')
const extraCss = readFileSync(join(root, 'app/src/extra.css'), 'utf8')
const html = readFileSync(join(root, 'app/index.html'), 'utf8')

const checks = [
  ['viewport initial-scale=1', /initial-scale=1(?:\.0)?/.test(html) && !/initial-scale=0/.test(html)],
  ['no interactive-widget override', !/interactive-widget/.test(html)],
  ['app-shell min-width 0', /\.app-shell\s*\{[^}]*min-width:\s*0/.test(appCss)],
  ['content min-width 0', /\.content\s*\{[^}]*min-width:\s*0/.test(appCss)],
  ['carousel width containment', /song-tile-row[^}]*max-width:\s*100%/.test(mobileCss)],
  ['no 420px song tile min', !/song-tile-row[^}]*420px/.test(extraCss)],
  ['no hero scale hack', !/hero-background[^}]*scale\(/.test(extraCss)],
  ['no overflow-x clip mask', !/overflow-x:\s*clip/.test(mobileCss)],
  ['mobile modal width 100%', /@media \(max-width: 767px\)[\s\S]*\.modal[^}]*width:\s*100%/.test(mobileCss)],
  ['text-size-adjust 100%', /text-size-adjust:\s*100%/.test(mobileCss)],
  ['form control 16px at tablet', /\.field input,[\s\S]*font-size:\s*16px/.test(mobileCss)],
  ['modalLock module present', existsSync(join(root, 'app/src/modalLock.js'))],
  ['sheet-toolbar wraps', /\.sheet-toolbar\s*\{[^}]*flex-wrap:\s*wrap/.test(extraCss)],
  ['sheet-toolbar no overflow-x auto', !/\.sheet-toolbar\{[^}]*overflow-x:\s*auto/.test(extraCss.replace(/\s+/g,''))],
  ['chart-sheet overflow-x hidden', /\.chart-sheet\s*\{[^}]*overflow-x:\s*hidden/.test(extraCss)],
  ['chart-pair break-inside avoid', /chart-pair[^}]*break-inside:\s*avoid/.test(extraCss)],
  ['tablet keeps columns-2', /@media \(max-width: 1024px\)[\s\S]*?\.chart-sheet\.columns-2\s*\{[^}]*column-count:\s*2/.test(mobileCss)],
  ['phone may collapse columns-2', /@media \(max-width: 560px\)[\s\S]*\.chart-sheet\.columns-2\s*\{[^}]*column-count:\s*1/.test(mobileCss + extraCss)],
  ['compact sheet-toolbar padding', /\.sheet-toolbar\s*\{[^}]*padding:\s*8px 10px/.test(extraCss) || /\.sheet-toolbar\s*\{[^}]*padding:\s*6px/.test(extraCss)],
  ['columns-font-cluster', /columns-font-cluster/.test(extraCss)],
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
console.log('test-mobile-layout: all passed')
