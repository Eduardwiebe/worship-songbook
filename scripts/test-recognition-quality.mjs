#!/usr/bin/env node
/**
 * Recognition-quality tests: glue splits, German orthography, slash chords,
 * OMR/OCR chord merge, and structure regressions. No copyrighted lyrics.
 */
import {
  isValidChordToken,
  joinLyricTokens,
  mergeChordCandidates,
  normalizeEngravedLyrics,
  reconstructLeadsheet,
} from '../lib/leadsheetReconstruct.mjs'
import {
  refineGermanOrthography,
  refineLyricText,
  splitGluedGermanWords,
  normalizeChordGlyphs,
} from '../lib/ocrTextRefine.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// --- glued words ---
assert(splitGluedGermanWords('ichdanke') === 'ich danke', 'ichdanke')
assert(splitGluedGermanWords('Alswahrer') === 'Als wahrer', 'Alswahrer')
assert(splitGluedGermanWords('duwirstverstehn') === 'du wirst verstehn', 'duwirstverstehn')
assert(splitGluedGermanWords('michkennst') === 'mich kennst', 'michkennst')
assert(splitGluedGermanWords('hebstmich') === 'hebst mich', 'hebstmich')
assert(splitGluedGermanWords('zudirhinauf') === 'zu dir hinauf', 'zudirhinauf')
assert(splitGluedGermanWords('dumichkennst') === 'du mich kennst', 'dumichkennst')
assert(splitGluedGermanWords('Gottund') === 'Gott und', 'Gottund')
assert(splitGluedGermanWords('ichdankedir') === 'ich danke dir', 'ichdankedir')
assert(splitGluedGermanWords('dassdumichkennstund') === 'dass du mich kennst und', 'dassdumichkennstund')
assert(refineLyricText('duweiBtes').text === 'du weißt es', 'duweiBtes')
assert(refineLyricText('duweißtes').text === 'du weißt es', 'duweißtes')
assert(splitGluedGermanWords('trotzdem') === 'trotzdem', 'keep trotzdem')
assert(splitGluedGermanWords('allein') === 'allein', 'keep allein')
assert(splitGluedGermanWords('durch') === 'durch', 'keep durch')
assert(splitGluedGermanWords('diese') === 'diese', 'keep diese')
assert(splitGluedGermanWords('zuerst') === 'zuerst', 'keep zuerst')
assert(splitGluedGermanWords('barmherzig') === 'barmherzig', 'keep barmherzig')
assert(splitGluedGermanWords('Sehnsucht') === 'Sehnsucht', 'keep Sehnsucht')
assert(splitGluedGermanWords('hinauf') === 'hinauf', 'keep hinauf')
assert(splitGluedGermanWords('Geduld') === 'Geduld', 'keep Geduld')
assert(splitGluedGermanWords('verstehst') === 'verstehst', 'keep verstehst')
assert(splitGluedGermanWords('wieder') === 'wieder', 'keep wieder')
assert(splitGluedGermanWords('Gottes') === 'Gottes', 'keep Gottes')
assert(splitGluedGermanWords('Morgenlicht') === 'Morgenlicht', 'keep Morgenlicht')
assert(splitGluedGermanWords('trotzdemliebst') === 'trotzdem liebst', 'trotzdemliebst')
assert(normalizeEngravedLyrics('Wenn - ich - auch - flie - he') === 'Wenn ich auch fliehe', 'do not hyphen-join function words')
assert(normalizeEngravedLyrics('du - warst') === 'du warst', 'do not hyphen-join du warst')
assert(normalizeEngravedLyrics('ste - he') === 'stehe', 'still join ste-he')
assert(normalizeEngravedLyrics('wie - der') === 'wieder', 'keep wieder')
assert(normalizeEngravedLyrics('trotz - dem') === 'trotzdem', 'keep trotzdem')
assert(normalizeEngravedLyrics('Sehn-sucht') === 'Sehnsucht', 'keep Sehnsucht')
assert(
  joinLyricTokens([
    { text: 'ich', bbox: [80, 190, 110, 220] },
    { text: 'danke', bbox: [130, 190, 210, 220] },
    { text: 'dir', bbox: [230, 190, 270, 220] },
  ]) === 'ich danke dir',
  'separate boxes stay spaced',
)
assert(
  joinLyricTokens([
    { text: 'du-', bbox: [80, 190, 120, 220] },
    { text: 'hebst-', bbox: [160, 190, 240, 220] },
    { text: 'mich', bbox: [260, 190, 320, 220] },
    { text: 'zu-', bbox: [340, 190, 370, 220] },
    { text: 'dir-', bbox: [400, 190, 440, 220] },
    { text: 'hinauf', bbox: [460, 190, 560, 220] },
  ]) === 'du hebst mich zu dir hinauf',
  'gapped hyphen tokens stay spaced',
)
assert(
  joinLyricTokens([
    { text: 'ste-', bbox: [80, 190, 130, 220] },
    { text: 'he', bbox: [132, 190, 160, 220] },
  ]) === 'stehe',
  'adjacent syllable boxes still join',
)
console.log('OK glued German word split')

// --- umlauts / ß ---
assert(refineGermanOrthography('weiSt').text === 'weißt', 'weiSt')
assert(refineGermanOrthography('weisst').text === 'weißt', 'weisst')
assert(refineGermanOrthography('du weist es').text === 'du weißt es', 'du weist')
assert(refineGermanOrthography('weist').uncertain === true, 'isolated weist needs review')
assert(refineGermanOrthography('weist').text === 'weist', 'isolated weist not forced')
assert(refineGermanOrthography('fuhle').text === 'fühle', 'fühle')
assert(refineGermanOrthography('uber').text === 'über', 'über')
assert(refineGermanOrthography('grosser').text === 'größer', 'größer')
assert(refineGermanOrthography('Strasse').text === 'Straße', 'Straße')
assert(refineLyricText('du weiSt es schon').text.includes('weißt'), 'lyric weißt')
console.log('OK German orthography')

// --- slash chords ---
assert(isValidChordToken('F/C'), 'F/C')
assert(isValidChordToken('G/B'), 'G/B')
assert(isValidChordToken('D/F#'), 'D/F#')
assert(isValidChordToken('A/C#'), 'A/C#')
assert(isValidChordToken('Bb/D'), 'Bb/D')
assert(isValidChordToken('Eb/G'), 'Eb/G')
assert(isValidChordToken('F / C'), 'spaced F/C')
assert(isValidChordToken('(F/C)'), 'paren F/C')
assert(isValidChordToken('D/F♯'), 'unicode sharp')
assert(isValidChordToken('Bb/D'), 'Bb/D again')
assert(normalizeChordGlyphs('D / F♯') === 'D/F#', 'normalize sharp slash')
assert(!isValidChordToken('ich'), 'lyric ich is not a chord')
assert(!isValidChordToken('da'), 'lyric da is not a chord')
assert(!isValidChordToken('und'), 'lyric und is not a chord')
console.log('OK slash chord syntax')

// --- OMR / OCR chord merge ---
const omrOnly = mergeChordCandidates([
  { text: 'F', bbox: [100, 40, 130, 70], confidence: 0.7, source: 'audiveris-chord' },
])
assert(omrOnly.chords.length === 1 && omrOnly.chords[0].text === 'F', 'OMR-only F')
assert(!omrOnly.chords[0].chordUncertain, 'OMR-only not uncertain')

const ocrOnly = mergeChordCandidates([
  { text: 'Am', bbox: [200, 40, 250, 70], confidence: 0.96, source: 'rapidocr-fill' },
])
assert(ocrOnly.chords[0].text === 'Am', 'OCR-only Am')

const bothSame = mergeChordCandidates([
  { text: 'C', bbox: [100, 40, 130, 70], confidence: 0.66, source: 'audiveris-chord' },
  { text: 'C', bbox: [102, 42, 128, 68], confidence: 0.9, source: 'rapidocr-fill' },
])
assert(bothSame.chords.length === 1 && bothSame.chords[0].text === 'C', 'both same C')
assert(bothSame.chords[0].confidence > 0.9, 'agreement boosts confidence')
assert(!bothSame.chords[0].chordUncertain, 'agreement not uncertain')

const conflict = mergeChordCandidates([
  { text: 'F', bbox: [100, 40, 130, 70], confidence: 0.66, source: 'audiveris-chord' },
  { text: 'E', bbox: [102, 42, 128, 68], confidence: 0.9, source: 'rapidocr-fill' },
])
assert(conflict.chords.length === 1 && conflict.chords[0].text === 'F', 'conflict prefers OMR')
assert(!conflict.chords[0].chordUncertain, 'OMR decision is determined')

const uncertain = mergeChordCandidates([
  { text: 'C', bbox: [100, 40, 130, 70], confidence: 0.7, source: 'rapidocr-fill' },
  { text: 'G', bbox: [104, 42, 128, 68], confidence: 0.72, source: 'rapidocr-fill' },
])
assert(uncertain.chords[0].chordUncertain, 'OCR-only conflict is uncertain')

const stacked = mergeChordCandidates([
  { text: 'F', bbox: [100, 40, 130, 70], confidence: 0.66, source: 'audiveris-chord' },
  { text: 'C', bbox: [102, 80, 132, 110], confidence: 0.71, source: 'audiveris-chord' },
  { text: 'E', bbox: [101, 38, 128, 68], confidence: 0.9, source: 'rapidocr-fill' },
])
assert(stacked.chords.length === 1 && stacked.chords[0].text === 'F/C', `stacked F/C, got ${stacked.chords[0]?.text}`)
console.log('OK OMR/OCR chord merge')

// --- reconstruct: glue + slash + parallel structure ---
const page = {
  engine: 'audiveris',
  pages: [{
    page_index: 0,
    width: 2200,
    height: 2800,
    systems: [
      { index: 0, y0: 460, y1: 540, spacing: 20, score: 1 },
      { index: 1, y0: 820, y1: 900, spacing: 20, score: 1 },
      { index: 2, y0: 1180, y1: 1260, spacing: 20, score: 1 },
    ],
    tokens: [
      { text: '32', bbox: [220, 80, 300, 150], confidence: 0.99 },
      { text: 'Morgenlicht', bbox: [820, 90, 1400, 160], confidence: 0.98 },
      { text: '156', bbox: [260, 380, 340, 420], confidence: 0.99 },
      { text: 'F', bbox: [980, 355, 1020, 390], confidence: 0.7, source: 'audiveris-chord' },
      { text: 'C', bbox: [982, 400, 1022, 435], confidence: 0.71, source: 'audiveris-chord' },
      { text: 'G/B', bbox: [1500, 390, 1580, 430], confidence: 0.9, source: 'rapidocr-fill' },
      { text: '1. Alpha beta gamma, ichdanke dir.', bbox: [380, 560, 1700, 630], confidence: 0.97 },
      { text: '2. Zeta eta theta, Alswahrer Gott.', bbox: [380, 640, 1580, 710], confidence: 0.97 },
      { text: 'LOB&DANK', bbox: [160, 720, 230, 1100], confidence: 0.98 },
      { text: 'Em', bbox: [400, 750, 480, 800], confidence: 0.99, source: 'rapidocr-fill' },
      { text: 'D/F#', bbox: [980, 750, 1080, 800], confidence: 0.99, source: 'rapidocr-fill' },
      { text: 'A/C#', bbox: [1500, 750, 1600, 800], confidence: 0.99, source: 'rapidocr-fill' },
      { text: 'Wenn Licht den Weg beschreibt.', bbox: [380, 920, 1700, 990], confidence: 0.96 },
      { text: 'Die Nacht wird barmherzig hell.', bbox: [380, 1000, 1720, 1070], confidence: 0.96 },
      { text: 'Refrain', bbox: [380, 1100, 560, 1160], confidence: 0.99 },
      { text: 'Bb/D', bbox: [980, 1100, 1060, 1150], confidence: 0.99, source: 'audiveris-chord' },
      { text: 'du weiSt es und fuhle uber die Strasse.', bbox: [380, 1280, 1900, 1350], confidence: 0.97 },
      { text: 'Text und Melodie: Example Author', bbox: [240, 2400, 1100, 2450], confidence: 0.9 },
      { text: '1999 Example Verlag, Example City', bbox: [240, 2460, 1200, 2510], confidence: 0.9 },
      { text: '62', bbox: [1040, 2680, 1120, 2740], confidence: 0.99 },
    ],
  }],
}

const result = reconstructLeadsheet(page)
const text = result.text
assert(/\[Strophe 1\]/.test(text) && /\[Strophe 2\]/.test(text) && /\[Refrain\]/.test(text), `sections:\n${text}`)
assert((text.match(/\[Refrain\]/g) || []).length === 1, 'refrain once')
assert(/ich danke/.test(text) && !/ichdanke/.test(text), `glue ich danke:\n${text}`)
assert(/Als wahrer/.test(text) && !/Alswahrer/.test(text), 'glue Als wahrer')
assert(/weißt/.test(text) && !/weiSt/.test(text), 'weißt')
assert(/fühle/.test(text), 'fühle')
assert(/über/.test(text), 'über')
assert(/Straße/.test(text), 'Straße')
assert(/F\/C/.test(text), `slash F/C:\n${text}`)
assert(/G\/B/.test(text), 'slash G/B')
assert(/D\/F#/.test(text), 'slash D/F#')
assert(/A\/C#/.test(text), 'slash A/C#')
assert(/Bb\/D/.test(text), 'slash Bb/D')
assert(!/LOB/.test(text), 'rubric filtered')
assert(!/(^|\n)62(\n|$)/.test(text), 'page number filtered')
assert(!/(^|\n)32(\n|$)/.test(text), 'song number filtered')
assert(!/(^|\n)156(\n|$)/.test(text), 'tempo filtered')
assert(!/1999 Example/.test(text), 'copyright filtered')
const strophe1 = text.slice(text.indexOf('[Strophe 1]'), text.indexOf('[Strophe 2]'))
const strophe2 = text.slice(text.indexOf('[Strophe 2]'), text.indexOf('[Refrain]'))
assert(/Alpha beta/.test(strophe1) && !/Zeta eta/.test(strophe1), 'parallel verse 1')
assert(/Zeta eta/.test(strophe2) && !/Alpha beta/.test(strophe2), 'parallel verse 2')
console.log('OK reconstruct quality + regression')

console.log('test-recognition-quality: all passed')
