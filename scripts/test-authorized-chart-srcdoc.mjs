#!/usr/bin/env node
/**
 * Regression: Set-play HTML charts must not go through iOS PDF <embed>.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const media = readFileSync(join(root, 'app/src/AuthorizedMedia.jsx'), 'utf8')
const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(media.includes('srcDoc={htmlDoc}'), 'AuthorizedFrame must render charts via srcDoc')
assert(media.includes('if (ios && !fitContent)'), 'PDF embed must be gated behind !fitContent')
assert(/fitContent[\s\S]*srcDoc=\{htmlDoc\}/.test(media), 'fitContent path must reach srcDoc')
assert(!/if \(ios\) \{\s*return \(\s*<embed[\s\S]*type="application\/pdf"/.test(media), 'unconditional iOS PDF embed must be gone')
assert(app.includes('preferPageImages'), 'RunSet originals should prefer page images on iOS')
assert(app.includes('fitContent className="stage-fit-content"'), 'RunSet edited charts still use fitContent')

console.log('ok: chart srcDoc path + PDF embed gate')
