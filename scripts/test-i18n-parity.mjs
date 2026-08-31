#!/usr/bin/env node
import assert from 'node:assert/strict'
import { STRINGS } from '../app/src/i18n/strings.mjs'
import de from '../app/src/i18n/de.js'
import en from '../app/src/i18n/en.js'

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') flatten(v, path, out)
    else out[path] = v
  }
  return out
}

const deFlat = flatten(de)
const enFlat = flatten(en)
const sourceKeys = Object.keys(STRINGS).sort()
const deKeys = Object.keys(deFlat).sort()
const enKeys = Object.keys(enFlat).sort()

assert.deepEqual(deKeys, sourceKeys, 'de keys must match strings.mjs')
assert.deepEqual(enKeys, sourceKeys, 'en keys must match strings.mjs')

const missingEn = []
const missingDe = []
const empty = []
for (const key of sourceKeys) {
  if (!STRINGS[key].de?.trim()) empty.push(`de:${key}`)
  if (!STRINGS[key].en?.trim()) empty.push(`en:${key}`)
  if (!(key in deFlat)) missingDe.push(key)
  if (!(key in enFlat)) missingEn.push(key)
}

assert.equal(missingDe.length, 0, `missing de: ${missingDe}`)
assert.equal(missingEn.length, 0, `missing en: ${missingEn}`)
assert.equal(empty.length, 0, `empty values: ${empty}`)

console.log(`i18n parity ok: ${sourceKeys.length} keys`)
