#!/usr/bin/env node
/**
 * Realscan key diagnosis. Logs keys and chord tokens only — not lyrics.
 * Usage: node scripts/debug-scan-key.mjs /path/to/song.pdf
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { recognizeMusicPages } from '../lib/visionProviders/index.mjs'
import { leadsheetFromVision, visionResultToApi } from '../lib/visionLeadsheet.mjs'
import {
  applyEditorKeyChange,
  displayEditorText,
  editorSemitoneDelta,
  extractEditorChordRoots,
  inferKeyFromChords,
  inferKeyFromLeadsheet,
  resolveScanSourceKey,
} from '../lib/editorKey.mjs'

const execFileAsync = promisify(execFile)
const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('usage: debug-scan-key.mjs <song.pdf>')
  process.exit(2)
}

const dir = await mkdtemp(join(tmpdir(), 'songbook-scan-key-'))
try {
  await execFileAsync('/usr/bin/pdftoppm', ['-png', '-r', '150', pdfPath, join(dir, 'page')], { timeout: 60000 })
  const { readdirSync } = await import('node:fs')
  const pages = readdirSync(dir).filter((name) => name.endsWith('.png')).sort().map((name) => join(dir, name))
  const visionDoc = await recognizeMusicPages(pages)
  const api = visionResultToApi(visionDoc)
  const resolved = resolveScanSourceKey({ visionKey: api.key || visionDoc.key, text: api.text })
  const roots = extractEditorChordRoots(api.text)
  const unique = [...new Set(roots)]
  const excerpt = {
    visionKey: visionDoc.key || '',
    apiKey: api.key || '',
    tonartKey: inferKeyFromLeadsheet(api.text),
    chordKey: inferKeyFromChords(api.text).key,
    resolved: resolved.key,
    source: resolved.source,
    needsReview: resolved.needsReview,
    dbSourceKey: resolved.key || '',
    dbSongKey: resolved.key || '–',
    frontendSourceKey: resolved.key,
    frontendSelectedKey: resolved.key,
    delta: editorSemitoneDelta(resolved.key, resolved.key),
    chordRoots: unique.slice(0, 24),
    pages: pages.length,
    usage: visionDoc.usage || null,
  }
  const out = process.env.SONGBOOK_SCAN_KEY_OUT || '/tmp/songbook-scan-key-debug.json'
  await writeFile(out, JSON.stringify({ excerpt, documentKey: visionDoc.key }, null, 2))
  console.log(JSON.stringify(excerpt, null, 2))
  if (resolved.key === 'C') {
    const original = 'C\nF\nG\nAm\nEm'
    const stay = displayEditorText(original, 'C', 'C')
    const toD = applyEditorKeyChange(original, 'C', 'D')
    const back = applyEditorKeyChange(original, 'C', 'C')
    console.log(JSON.stringify({
      cc: stay === original,
      cd: toD.text,
      dc: back.text === original,
      cdDelta: editorSemitoneDelta('C', 'D'),
    }))
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}
