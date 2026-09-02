#!/usr/bin/env node
/**
 * One-shot vision recognition. Does not print copyrighted lyrics to git.
 * Usage: node scripts/vision-recognize-page.mjs /path/to/page.png
 */
import { writeFile } from 'node:fs/promises'
import { recognizeMusicPage } from '../lib/visionProviders/index.mjs'
import { leadsheetFromVision } from '../lib/visionLeadsheet.mjs'

const imagePath = process.argv[2]
if (!imagePath) {
  console.error('usage: vision-recognize-page.mjs <page.png>')
  process.exit(2)
}

const document = await recognizeMusicPage(imagePath)
const text = leadsheetFromVision(document)
const out = process.env.SONGBOOK_VISION_OUT || '/tmp/songbook-vision-last.json'
await writeFile(out, JSON.stringify({ document, text }, null, 2))
console.log(JSON.stringify({
  title: document.title,
  key: document.key,
  sections: document.sections.map((section) => ({
    type: section.type,
    number: section.number,
    lines: section.lines.length,
    chords: section.lines.reduce((sum, line) => sum + line.chords.length, 0),
  })),
  confidence: document.confidence,
  needsReview: document.needsReview,
  usage: document.usage,
  textChars: text.length,
  out,
}, null, 2))
console.log('\n--- leadsheet ---\n' + text)
