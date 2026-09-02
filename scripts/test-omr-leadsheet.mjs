#!/usr/bin/env node
/**
 * OMR leadsheet test against a local Audiveris .omr book.
 * Does not commit private scans or copyrighted lyrics.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { reconstructLeadsheet } from '../lib/leadsheetReconstruct.mjs'

const execFileAsync = promisify(execFile)
const python = process.env.SONGBOOK_OCR_PYTHON || '/var/www/songbook/.venv-ocr/bin/python'
const omrPath = process.env.SONGBOOK_OMR_BOOK || '/tmp/audiveris-poc/out2/page-1.omr'
const imagePath = process.env.SONGBOOK_REAL_SCAN || '/tmp/songbook-phase2-layout/run-790da40b/page-1.png'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const { stdout } = await execFileAsync(python, [
  '/var/www/songbook/omr_structured.py',
  '--parse-omr',
  omrPath,
  '2200',
  '3143',
], { env: { ...process.env, PYTHONPATH: '/var/www/songbook' }, timeout: 30000 })

const page = JSON.parse(stdout)
assert((page.systems || []).length >= 6, `systems ${page.systems?.length}`)
assert((page.tokens || []).some((token) => token.source === 'audiveris-chord'), 'chord-name tokens')
assert((page.tokens || []).some((token) => /Refrain/i.test(token.text)), 'refrain token')

const structured = { engine: 'audiveris', pages: [{ ...page, page_index: 0 }] }
const result = reconstructLeadsheet(structured)
const text = result.text
console.log(text)
assert(/\[Strophe 1\]/.test(text) || /\[Strophe 2\]/.test(text) || /Refrain/.test(text), 'sections present')
assert(!/(^|\n)62(\n|$)/.test(text), 'page number filtered')
assert(!/LOB/.test(text), 'rubric not leaked from omr words')
assert(result.layout.usedStaves, 'staff systems from omr')
console.log('OK omr parse + reconstruct', {
  systems: page.systems.length,
  tokens: page.tokens.length,
  chords: page.omr_chord_count,
  words: page.omr_word_count,
})

if (process.argv.includes('--full')) {
  const full = await execFileAsync(python, ['/var/www/songbook/omr_structured.py', imagePath], {
    env: { ...process.env, PYTHONPATH: '/var/www/songbook' },
    timeout: 240000,
    maxBuffer: 40 * 1024 * 1024,
  })
  const live = JSON.parse(full.stdout)
  const rebuilt = reconstructLeadsheet(live)
  console.log('\n--- full engine', live.engine, '---\n' + rebuilt.text)
  assert(live.engine === 'audiveris', `engine ${live.engine} ${live.omr_error || ''}`)
  assert(/\[Strophe 1\]/.test(rebuilt.text), 'full strophe 1')
  assert(/\[Strophe 2\]/.test(rebuilt.text), 'full strophe 2')
  assert(/\[Refrain\]/.test(rebuilt.text), 'full refrain')
  assert((rebuilt.text.match(/\[Refrain\]/g) || []).length === 1, 'full refrain once')
  assert(!/LOB/.test(rebuilt.text), 'full rubric')
  assert(!/(^|\n)62(\n|$)/.test(rebuilt.text), 'full page number')
  assert(!/ichdanke/.test(rebuilt.text), 'full unglued ichdanke')
  assert(!/Alswahrer/.test(rebuilt.text), 'full unglued Alswahrer')
  assert(!/duwirstverstehn/.test(rebuilt.text), 'full unglued duwirst')
  assert(/ich danke/.test(rebuilt.text), 'full ich danke')
  assert(/Als wahrer/.test(rebuilt.text), 'full Als wahrer')
  assert(/du wirst/.test(rebuilt.text), 'full du wirst')
  assert(/weißt/.test(rebuilt.text), 'full weißt')
  assert(/fühle/.test(rebuilt.text), 'full fühle')
  assert(/F\/C/.test(rebuilt.text), 'full slash F/C')
  const s1 = rebuilt.text.slice(rebuilt.text.indexOf('[Strophe 1]'), rebuilt.text.indexOf('[Strophe 2]'))
  const s2 = rebuilt.text.slice(rebuilt.text.indexOf('[Strophe 2]'), rebuilt.text.indexOf('[Refrain]'))
  assert(/stehe/.test(s1) && !/Alswahrer|Als wahrer/.test(s1), 'full verse 1 not mixed')
  assert(/Herz/.test(s2) && !/fliehe/.test(s2), 'full verse 2 not mixed')
  console.log('OK full Audiveris + fill pipeline')
}

console.log('test-omr-leadsheet: passed')
