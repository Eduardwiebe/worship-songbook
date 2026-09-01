#!/usr/bin/env node
import {
  cleanOcrText,
  isChordLine,
  pickBestTextCandidate,
  scoreLeadsheetQuality,
  shouldRunOcr,
} from '../lib/leadsheetAnalysis.mjs'

const goodSample = `C        G        Am       F
Jesus, Herr, ich denke an dein Opfer
Am       F        C        G
Once again I thank you`

const badSample = `BR• R
Opfer
22 Jesus, Herr, ich denke an
dein Op a
Bh A c a
= 66 <3 E E SS SS
- SSS
~__ oH : é fer:`

const good = scoreLeadsheetQuality(goodSample)
const bad = scoreLeadsheetQuality(badSample)

if (!good.needsReview) console.log('OK good sample flagged as usable')
else throw new Error('good sample should not need review')

if (bad.needsReview) console.log('OK bad sample flagged for review')
else throw new Error('bad sample should need review')

const picked = pickBestTextCandidate([
  { text: badSample, method: 'bad' },
  { text: goodSample, method: 'good' },
])
if (picked.method !== 'good') throw new Error('pickBestTextCandidate failed')

if (shouldRunOcr('')) console.log('OK empty pdf text triggers OCR')
else throw new Error('empty should trigger OCR')

if (shouldRunOcr(goodSample)) throw new Error('good pdf text should not force OCR')

console.log('test-leadsheet-quality: all passed')
