#!/usr/bin/env node
/**
 * Smoke test for horizontal overflow CSS guards.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'app/src/mobile-layout.css'), 'utf8')
const html = readFileSync(join(root, 'app/index.html'), 'utf8')

const checks = [
  ['mobile-layout has text-size-adjust', /text-size-adjust:\s*100%/.test(css)],
  ['mobile-layout clips overflow-x', /overflow-x:\s*clip/.test(css)],
  ['mobile-layout has safe-area modal padding', /env\(safe-area-inset-top/.test(css)],
  ['mobile-layout hides nav when modal open', /body:has\(\.modal-backdrop\)\s*\.mobile-nav/.test(css)],
  ['index.html viewport-fit=cover', /viewport-fit=cover/.test(html)],
  ['index.html interactive-widget', /interactive-widget=resizes-content/.test(html)],
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
