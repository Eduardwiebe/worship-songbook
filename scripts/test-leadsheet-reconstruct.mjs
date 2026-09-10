#!/usr/bin/env node
/**
 * Unit tests for geometric leadsheet reconstruction + chord validation.
 */
import {
  isValidChordToken,
  mergeChordCandidates,
  normalizeEngravedLyrics,
  placeChordsAboveLyric,
  reconstructLeadsheet,
} from '../lib/leadsheetReconstruct.mjs'
import {
  softFormatChordChart,
  packChordsAboveLyrics,
  collapseGluedSlashBassAnchors,
  chordLyricToWordStacks,
  wrapChordLyricPair,
  deinterleaveTwoColumnLayout,
  parseChartBlocks,
} from '../lib/chartLayout.mjs'
import { cleanOcrText } from '../lib/leadsheetAnalysis.mjs'
import { transposeEditorText } from '../lib/editorKey.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Chord validation
assert(isValidChordToken('C'), 'C valid')
assert(isValidChordToken('F#m'), 'F#m valid')
assert(isValidChordToken('D/F#'), 'D/F# valid')
assert(isValidChordToken('Asus2'), 'Asus2 valid')
assert(isValidChordToken('F/C'), 'F/C valid')
assert(isValidChordToken('G/B'), 'G/B valid')
assert(isValidChordToken('A/C#'), 'A/C# valid')
assert(isValidChordToken('Bb/D'), 'Bb/D valid')
assert(isValidChordToken('(F/C)'), 'paren F/C valid')
assert(isValidChordToken('D/F♯'), 'unicode F# bass')
assert(isValidChordToken('Cmaj7'), 'Cmaj7 valid')
assert(!isValidChordToken('SSS'), 'SSS invalid')
assert(!isValidChordToken('ce'), 'ce invalid')
assert(!isValidChordToken('ow'), 'ow invalid')
assert(!isValidChordToken('66'), '66 invalid')
assert(!isValidChordToken('<3'), '<3 invalid')
console.log('OK chord validation')

// Geometric placement
const lyricLine = {
  tokens: [
    { text: 'Jesus,', bbox: [80, 190, 180, 220], confidence: 0.99, line_index: 1 },
    { text: 'Herr,', bbox: [190, 190, 270, 220], confidence: 0.99, line_index: 1 },
    { text: 'ich', bbox: [280, 190, 320, 220], confidence: 0.99, line_index: 1 },
    { text: 'denke', bbox: [330, 190, 420, 220], confidence: 0.99, line_index: 1 },
  ],
}
const chords = [
  { text: 'E', bbox: [80, 140, 100, 170], confidence: 0.99, line_index: 0 },
  { text: 'A', bbox: [190, 140, 210, 170], confidence: 0.99, line_index: 0 },
  { text: 'E', bbox: [330, 140, 350, 170], confidence: 0.99, line_index: 0 },
]
const placed = placeChordsAboveLyric(chords, lyricLine, 'Jesus, Herr, ich denke')
assert(placed.chordLine.includes('E'), 'placed has E')
assert(placed.chordLine.includes('A'), 'placed has A')
assert(placed.lyricLine.includes('Jesus'), 'lyric preserved')
console.log('OK geometric placement')

// Full reconstruct from RapidOCR-like tokens
const structured = {
  engine: 'rapidocr',
  elapsed_ms: 900,
  pages: [{
    page_index: 0,
    width: 1200,
    height: 1600,
    tokens: [
      { text: 'Amazing Grace', bbox: [80, 60, 420, 100], confidence: 0.97, line_index: 0 },
      { text: 'E', bbox: [80, 140, 100, 170], confidence: 0.99, line_index: 1 },
      { text: 'A', bbox: [190, 140, 210, 170], confidence: 0.99, line_index: 1 },
      { text: 'E', bbox: [300, 140, 320, 170], confidence: 0.99, line_index: 1 },
      { text: 'Jesus,', bbox: [80, 190, 160, 220], confidence: 0.99, line_index: 2 },
      { text: 'Herr,', bbox: [170, 190, 250, 220], confidence: 0.99, line_index: 2 },
      { text: 'ich', bbox: [260, 190, 300, 220], confidence: 0.99, line_index: 2 },
      { text: 'denke', bbox: [310, 190, 400, 220], confidence: 0.99, line_index: 2 },
      { text: 'an', bbox: [410, 190, 450, 220], confidence: 0.99, line_index: 2 },
      { text: 'dein', bbox: [460, 190, 520, 220], confidence: 0.99, line_index: 2 },
      { text: 'Opfer', bbox: [530, 190, 620, 220], confidence: 0.99, line_index: 2 },
      { text: '♪', bbox: [80, 400, 100, 420], confidence: 0.4, line_index: 3 },
      { text: 'SSS', bbox: [120, 400, 180, 420], confidence: 0.3, line_index: 3 },
    ],
  }],
}

const result = reconstructLeadsheet(structured, { titleHint: 'Amazing Grace' })
assert(result.text.includes('Jesus'), 'reconstruct has lyrics')
assert(result.text.includes('E'), 'reconstruct has chords')
assert(!result.text.includes('SSS'), 'music junk filtered')
assert(!result.text.includes('♪'), 'notation filtered')
assert(result.engine === 'rapidocr', 'engine recorded')
console.log('OK reconstruct leadsheet')

// Syllable joining
const syllabic = {
  engine: 'rapidocr',
  pages: [{
    page_index: 0,
    width: 800,
    height: 600,
    tokens: [
      { text: 'Je-', bbox: [80, 100, 120, 130], confidence: 0.9, line_index: 0 },
      { text: 'sus', bbox: [125, 100, 180, 130], confidence: 0.9, line_index: 0 },
      { text: 'den-', bbox: [200, 100, 250, 130], confidence: 0.9, line_index: 0 },
      { text: 'ke', bbox: [255, 100, 290, 130], confidence: 0.9, line_index: 0 },
    ],
  }],
}
const joined = reconstructLeadsheet(syllabic)
assert(/Jesus/i.test(joined.text), `syllables joined, got: ${joined.text}`)
assert(/denke/i.test(joined.text), `denke joined, got: ${joined.text}`)
console.log('OK syllable joining')

assert(normalizeEngravedLyrics('ste - he') === 'stehe', 'ste - he')
assert(normalizeEngravedLyrics('ste-he') === 'stehe', 'ste-he')
assert(normalizeEngravedLyrics('barm - her - zig') === 'barmherzig', 'barmherzig spaced')
assert(normalizeEngravedLyrics('Ge-duld') === 'Geduld', 'Geduld')
assert(normalizeEngravedLyrics('E-Mail') === 'E-Mail', 'keep E-Mail')
assert(normalizeEngravedLyrics('Ist-Zustand') === 'Ist-Zustand', 'keep Ist-Zustand')
assert(normalizeEngravedLyrics('dir,dass') === 'dir, dass', 'comma space')
console.log('OK engraved lyric normalization')

const hymnal = {
  engine: 'rapidocr',
  pages: [{
    page_index: 0,
    width: 2200,
    height: 2800,
    systems: [
      { index: 0, y0: 460, y1: 540, spacing: 20, score: 0.4 },
      { index: 1, y0: 820, y1: 900, spacing: 20, score: 0.4 },
      { index: 2, y0: 1180, y1: 1260, spacing: 20, score: 0.4 },
    ],
    tokens: [
      { text: '32', bbox: [220, 80, 300, 150], confidence: 0.99 },
      { text: 'Morgenlicht', bbox: [820, 90, 1400, 160], confidence: 0.98 },
      { text: '156', bbox: [260, 380, 340, 420], confidence: 0.99 },
      { text: 'C', bbox: [400, 390, 450, 430], confidence: 0.99 },
      { text: 'G', bbox: [980, 390, 1030, 430], confidence: 0.99 },
      { text: 'F', bbox: [1500, 390, 1550, 430], confidence: 0.99 },
      { text: '1. Alpha beta gam - ma, delta epsi - lon.', bbox: [380, 560, 1700, 630], confidence: 0.97 },
      { text: '2. Zeta eta the - ta, iota kap - pa.', bbox: [380, 640, 1580, 710], confidence: 0.97 },
      { text: 'mir.', bbox: [1585, 655, 1720, 705], confidence: 0.96 },
      { text: 'LOB&DANK', bbox: [160, 720, 230, 1100], confidence: 0.98 },
      { text: 'Em', bbox: [400, 750, 480, 800], confidence: 0.99 },
      { text: 'Am', bbox: [980, 750, 1060, 800], confidence: 0.99 },
      { text: 'G', bbox: [1500, 750, 1550, 800], confidence: 0.99 },
      { text: 'Wenn Licht den Weg be - schreibt.', bbox: [380, 920, 1700, 990], confidence: 0.96 },
      { text: 'Die Nacht wird barm - her - zig hell.', bbox: [380, 1000, 1720, 1070], confidence: 0.96 },
      { text: 'RefrainAm', bbox: [380, 1100, 620, 1160], confidence: 0.99 },
      { text: 'F', bbox: [980, 1100, 1030, 1150], confidence: 0.99 },
      { text: 'C', bbox: [1500, 1100, 1550, 1150], confidence: 0.99 },
      { text: 'Wir sin - gen heut von Frie - den und Ge - duld.', bbox: [380, 1280, 1900, 1350], confidence: 0.97 },
      { text: 'Text und Melodie: Example Author', bbox: [240, 2400, 1100, 2450], confidence: 0.9 },
      { text: '1999 Example Verlag, Example City', bbox: [240, 2460, 1200, 2510], confidence: 0.9 },
      { text: '62', bbox: [1040, 2680, 1120, 2740], confidence: 0.99 },
    ],
  }],
}

const hymnalResult = reconstructLeadsheet(hymnal)
const hymnalText = hymnalResult.text
assert(/\[Strophe 1\]/.test(hymnalText), `strophe 1 missing:\n${hymnalText}`)
assert(/\[Strophe 2\]/.test(hymnalText), `strophe 2 missing:\n${hymnalText}`)
assert(/\[Refrain\]/.test(hymnalText), `refrain missing:\n${hymnalText}`)
assert((hymnalText.match(/\[Refrain\]/g) || []).length === 1, 'refrain once')
assert(hymnalText.indexOf('[Strophe 1]') < hymnalText.indexOf('[Strophe 2]'), 'verse order')
assert(hymnalText.indexOf('[Strophe 2]') < hymnalText.indexOf('[Refrain]'), 'refrain after verses')
assert(/gamma/.test(hymnalText), `syllable gamma: ${hymnalText}`)
assert(/epsilon/.test(hymnalText), 'syllable epsilon')
assert(/theta/.test(hymnalText), 'syllable theta')
assert(/barmherzig/.test(hymnalText), 'syllable barmherzig')
assert(/Geduld/.test(hymnalText), 'syllable Geduld')
assert(/Sehnsucht|kappa/.test(hymnalText) && /kap pa|kap - pa/.test(hymnalText) === false, 'kappa joined')
assert(/iota kappa/.test(hymnalText), `verse 2 continuation: ${hymnalText}`)
assert(!/LOB/.test(hymnalText), 'rubric filtered')
assert(!/(^|\n)32(\n|$)/.test(hymnalText), 'song number filtered')
assert(!/(^|\n)62(\n|$)/.test(hymnalText), 'page number filtered')
assert(!/1999 Example/.test(hymnalText), 'copyright filtered')
assert(!/(^|\n)156(\n|$)/.test(hymnalText), 'tempo filtered')
const strophe1 = hymnalText.slice(hymnalText.indexOf('[Strophe 1]'), hymnalText.indexOf('[Strophe 2]'))
const strophe2 = hymnalText.slice(hymnalText.indexOf('[Strophe 2]'), hymnalText.indexOf('[Refrain]'))
assert(/Alpha beta/.test(strophe1), 'verse 1 keeps first track')
assert(!/Zeta eta/.test(strophe1), 'verse 1 does not contain verse 2')
assert(/Zeta eta/.test(strophe2), 'verse 2 keeps second track')
assert(!/Alpha beta/.test(strophe2), 'verse 2 does not contain verse 1')
assert(/Am/.test(hymnalText.slice(hymnalText.indexOf('[Refrain]'))), 'refrain keeps Am from RefrainAm')
assert(hymnalResult.layout.usedStaves, 'staff systems used')
assert(hymnalResult.layout.parallelVerseTracks === 2, 'two lyric tracks')
console.log('OK hymnal spatial reconstruction')

const sequential = reconstructLeadsheet({
  engine: 'rapidocr',
  pages: [{
    page_index: 0,
    width: 800,
    height: 700,
    tokens: [
      { text: 'Mein Lied', bbox: [80, 40, 300, 80], confidence: 0.99 },
      { text: 'C', bbox: [80, 120, 110, 150], confidence: 0.99 },
      { text: 'G', bbox: [200, 120, 230, 150], confidence: 0.99 },
      { text: '1. Du bist die Liebe', bbox: [80, 170, 420, 210], confidence: 0.99 },
      { text: 'C', bbox: [80, 260, 110, 290], confidence: 0.99 },
      { text: 'F', bbox: [200, 260, 230, 290], confidence: 0.99 },
      { text: '2. Du gibst mir Hoffnung', bbox: [80, 310, 460, 350], confidence: 0.99 },
    ],
  }],
})
assert(/\[Strophe 1\]/.test(sequential.text) && /\[Strophe 2\]/.test(sequential.text), `sequential verses:\n${sequential.text}`)
assert(sequential.text.indexOf('[Strophe 1]') < sequential.text.indexOf('[Strophe 2]'), 'sequential order')
assert(/Liebe/.test(sequential.text.slice(sequential.text.indexOf('[Strophe 1]'), sequential.text.indexOf('[Strophe 2]'))), 'verse 1 content')
assert(/Hoffnung/.test(sequential.text.slice(sequential.text.indexOf('[Strophe 2]'))), 'verse 2 content')
console.log('OK sequential numbered verses')

console.log('test-leadsheet-reconstruct: all passed')
// Slash stack F over G → F/G single token
const slashMerge = mergeChordCandidates([
  { text: 'F', bbox: [100, 40, 120, 60], confidence: 0.95, source: 'ocr' },
  { text: 'G', bbox: [102, 70, 122, 90], confidence: 0.95, source: 'ocr' },
])
assert(slashMerge.chords.length === 1 && slashMerge.chords[0].text === 'F/G', `stacked slash got ${JSON.stringify(slashMerge.chords)}`)
console.log('OK stacked F/G slash merge')

// Jesus meine alignment fixture
const jesusLyric = 'Jesus meine'
const jesusChords = [
  { text: 'G', bbox: [10, 10, 30, 30], confidence: 0.99 },
  { text: 'D', bbox: [70, 10, 90, 30], confidence: 0.99 },
]
const jesusLine = {
  tokens: [
    { text: 'Jesus', bbox: [10, 50, 60, 70], confidence: 0.99, line_index: 1 },
    { text: 'meine', bbox: [70, 50, 120, 70], confidence: 0.99, line_index: 1 },
  ],
}
const jesusPlaced = placeChordsAboveLyric(jesusChords, jesusLine, jesusLyric)
assert(jesusPlaced.chordLine[0] === 'G', `G must sit on J, got ${JSON.stringify(jesusPlaced.chordLine)}`)
assert(jesusPlaced.chordLine.indexOf('D') === jesusLyric.indexOf('meine'), `D must sit on m, got ${JSON.stringify(jesusPlaced.chordLine)}`)
const jesusPacked = packChordsAboveLyrics(jesusLyric, [{ chord: 'G', index: 0 }, { chord: 'D', index: 6 }])
assert(jesusPacked.chordLine === 'G     D', `pack expected 'G     D', got ${JSON.stringify(jesusPacked.chordLine)}`)
const jesusChart = `${jesusPacked.chordLine}\n${jesusLyric}`
const jesusRound = softFormatChordChart(jesusChart)
assert(jesusRound.includes('G     D') || jesusRound.split('\n')[0].indexOf('G') === 0, `round-trip chords:\n${jesusRound}`)
assert(jesusRound.includes('Jesus meine'), 'round-trip lyrics')
const transposed = transposeEditorText(jesusChart, 'G', 'A')
assert(transposed.split('\n')[0].indexOf('A') === 0, 'G→A keeps column 0')
assert(transposed.split('\n')[0].indexOf('E') === 6, `G→A keeps D→E column, got ${JSON.stringify(transposed.split('\n')[0])}`)
assert(transposed.split('\n')[1] === 'Jesus meine', 'lyrics unchanged')
console.log('OK Jesus meine alignment round-trip + transpose')

// cleanOcrText must preserve leading chord spaces
const spaced = cleanOcrText('  G     D\nJesus meine')
assert(spaced.startsWith('  G'), `leading spaces preserved, got ${JSON.stringify(spaced)}`)
console.log('OK cleanOcrText preserves chord columns')

const glued = collapseGluedSlashBassAnchors([
  { chord: 'F/G', index: 0 },
  { chord: 'G', index: 3 },
])
assert(glued.length === 1 && glued[0].chord === 'F/G', `glued bass collapse: ${JSON.stringify(glued)}`)
assert(softFormatChordChart('F/GG\nJesus').startsWith('F/G'), `soft format glued F/GG → ${softFormatChordChart('F/GG\nJesus')}`)
console.log('OK glued slash bass collapse')

// --- Jesus zu dir … exact syllable packing (SongSelect acceptance) ---
const jesusFull = 'Jesus zu dir kann ich so kommen wie ich bin'
const jesusAnchors = [
  { chord: 'D', index: jesusFull.indexOf('Jesus') },
  { chord: 'G', index: jesusFull.indexOf('dir') },
  { chord: 'Asus', index: jesusFull.indexOf('kommen') },
  { chord: 'A', index: jesusFull.indexOf('wie') },
  { chord: 'D', index: jesusFull.indexOf('bin') },
]
assert(jesusAnchors[0].index === 0, 'D index 0')
assert(jesusAnchors[1].index === jesusFull.indexOf('d'), 'G over d of dir')
assert(jesusAnchors[2].index === jesusFull.indexOf('kommen'), 'Asus over kommen')
assert(jesusAnchors[3].index === jesusFull.indexOf('wie'), 'A over wie')
assert(jesusAnchors[4].index === jesusFull.indexOf('bin'), 'D over bin')

const jesusPackedFull = packChordsAboveLyrics(jesusFull, jesusAnchors)
assert(jesusPackedFull.chordLine[0] === 'D', `D on J got ${JSON.stringify(jesusPackedFull.chordLine)}`)
assert(jesusPackedFull.chordLine.indexOf('G') === jesusFull.indexOf('dir'), `G column ${jesusPackedFull.chordLine.indexOf('G')}`)
assert(jesusPackedFull.chordLine.indexOf('Asus') === jesusFull.indexOf('kommen'), `Asus column`)
assert(jesusPackedFull.chordLine[jesusFull.indexOf('wie')] === 'A', `A column at wie, got ${JSON.stringify(jesusPackedFull.chordLine)}`)
// Last D may sit at bin; allow pack push only if overlap — Asus ends before wie
assert(jesusPackedFull.chordLine.lastIndexOf('D') === jesusFull.indexOf('bin'), `final D on bin, got ${JSON.stringify(jesusPackedFull.chordLine)}`)

const jesusSoft = softFormatChordChart(`${jesusPackedFull.chordLine}\n${jesusFull}`)
const softChord = jesusSoft.split('\n')[0]
const softLyric = jesusSoft.split('\n')[1]
assert(softLyric === jesusFull, `soft-format must not destroy lyrics: ${softLyric}`)
assert(softChord.indexOf('G') === jesusFull.indexOf('dir'), `soft-format must not drift G: ${softChord}`)
assert(softChord.indexOf('Asus') === jesusFull.indexOf('kommen'), `soft-format must not drift Asus`)
assert(softChord[jesusFull.indexOf('wie')] === 'A', `soft-format must not drift A: ${softChord}`)
assert(softChord.lastIndexOf('D') === jesusFull.indexOf('bin'), `soft-format must not drift final D`)
console.log('OK Jesus zu dir packing + soft-format preserves spacing')

const stacks = chordLyricToWordStacks(jesusPackedFull.chordLine, jesusFull)
const byWord = Object.fromEntries(stacks.filter((s) => s.chord).map((s) => [s.word, s.chord]))
assert(byWord.Jesus === 'D', `stack Jesus→D got ${JSON.stringify(stacks)}`)
assert(byWord.dir === 'G', 'stack dir→G')
assert(byWord.kommen === 'Asus', 'stack kommen→Asus')
assert(byWord.wie === 'A', 'stack wie→A')
assert(byWord.bin === 'D', 'stack bin→D')
console.log('OK Jesus word stacks lock chords to syllables')

const wrapped = wrapChordLyricPair(jesusPackedFull.chordLine, jesusFull, 28)
assert(wrapped.length >= 2, `expected wrap at 28 cols, got ${wrapped.length}`)
assert(wrapped.every((row) => row.lyricLine.length <= 32), 'wrapped lyric segments short enough')
const wrappedJoined = wrapped.map((row) => row.lyricLine).join(' ')
assert(wrappedJoined === jesusFull, `wrap must preserve words: ${wrappedJoined}`)
const wrapStacks = wrapped.flatMap((row) => chordLyricToWordStacks(row.chordLine, row.lyricLine))
assert(wrapStacks.find((s) => s.word === 'bin')?.chord === 'D', 'wrapped bin keeps D')
console.log('OK Jesus phrase wrap keeps chord+lyric pairs')

const twoCol = [
  'VERSE 1                          CHORUS 2',
  'D     G        Asus A       D    G        D',
  'Jesus zu dir kann ich so         Du bist gut und',
  'kommen wie ich bin               treu',
].join('\n')
const split = deinterleaveTwoColumnLayout(twoCol)
assert(/VERSE 1/i.test(split) && /Jesus zu dir/i.test(split) && /CHORUS 2/i.test(split), `2-col left-then-right got:\n${split}`)
assert(split.indexOf('Jesus') < split.indexOf('Du bist'), `lyrics left before right:\n${split}`)
assert(split.indexOf('VERSE 1') < split.indexOf('CHORUS 2'), 'left column before right')
console.log('OK 2-column deinterleave reading order')

const blocks = parseChartBlocks(`${jesusPackedFull.chordLine}\n${jesusFull}`, { maxCols: 44 })
assert(blocks.some((b) => b.kind === 'pair'), 'parseChartBlocks emits pair')
assert(blocks.find((b) => b.kind === 'pair').stacks.find((s) => s.word === 'dir')?.chord === 'G', 'pair stacks G on dir')
console.log('OK parseChartBlocks pair for Jesus line')
