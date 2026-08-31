#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STRINGS } from '../app/src/i18n/strings.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function nest(locale) {
  const out = {}
  const keys = Object.keys(STRINGS).sort((a, b) => a.length - b.length || a.localeCompare(b))
  for (const path of keys) {
    const pair = STRINGS[path]
    const parts = path.split('.')
    let cur = out
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i]
      if (typeof cur[part] === 'string') {
        throw new Error(`Conflict: '${parts.slice(0, i + 1).join('.')}' is a leaf but needed as object for '${path}'`)
      }
      cur[part] = cur[part] || {}
      cur = cur[part]
    }
    const leaf = parts.at(-1)
    if (cur[leaf] && typeof cur[leaf] === 'object') {
      throw new Error(`Conflict: '${path}' would overwrite object branch`)
    }
    cur[leaf] = pair[locale]
  }
  return out
}

function serialize(obj, indent = 0) {
  const pad = '  '.repeat(indent)
  if (typeof obj === 'string') return JSON.stringify(obj)
  const entries = Object.entries(obj)
  if (!entries.length) return '{}'
  const body = entries.map(([k, v]) => `${pad}  ${/^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${serialize(v, indent + 1)}`).join(',\n')
  return `{\n${body},\n${pad}}`
}

for (const locale of ['de', 'en']) {
  const code = `/* Generated from strings.mjs — do not edit by hand */\nexport default ${serialize(nest(locale))}\n`
  writeFileSync(join(root, `app/src/i18n/${locale}.js`), code)
  console.log('wrote', locale, Object.keys(STRINGS).length, 'keys')
}
