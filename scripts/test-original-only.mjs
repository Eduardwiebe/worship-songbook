#!/usr/bin/env node
/**
 * Original-only songbook: printed key/BPM extract; no invented chords/LeadSheet.
 */
import assert from 'node:assert/strict'
import {
  ORIGINAL_ONLY_SONGBOOK,
  extractPrintedMetadataFromText,
  originalOnlyDisabledMessage,
} from '../lib/originalOnly.mjs'

assert.equal(ORIGINAL_ONLY_SONGBOOK, true)

{
  const meta = extractPrintedMetadataFromText(`Key - G | Time - 4/4
♩ = 120
Some lyric line`)
  assert.equal(meta.key, 'G')
  assert.equal(meta.bpm, 120)
  assert.equal(meta.hasPrintedKey, true)
  assert.equal(meta.hasPrintedBpm, true)
}

{
  const meta = extractPrintedMetadataFromText(`TONART: D
TEMPO: 90`)
  assert.equal(meta.key, 'D')
  assert.equal(meta.bpm, 90)
}

{
  // Chord soup must NOT invent a key or BPM.
  const meta = extractPrintedMetadataFromText(`G     C     D
Jesus, meine Hoffnung lebt
Em    Am    D
Du bist immer bei mir`)
  assert.equal(meta.key, '')
  assert.equal(meta.bpm, null)
  assert.equal(meta.hasPrintedKey, false)
  assert.equal(meta.hasPrintedBpm, false)
}

{
  const meta = extractPrintedMetadataFromText('')
  assert.equal(meta.key, '')
  assert.equal(meta.bpm, null)
}

assert.match(originalOnlyDisabledMessage('Akkorde'), /nicht mehr verfügbar/)
assert.match(originalOnlyDisabledMessage('LeadSheet'), /Original-Notenblatt/)

console.log('ok: original-only metadata extract')
