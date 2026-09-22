#!/usr/bin/env node
/**
 * Chord-view vs LeadSheet reconstruction quality.
 * Chord view rehydrates syllables; LeadSheet is MusicXML, never faked from chord text.
 */
import {
  reconstructLeadsheet,
  reconstructHybridSong,
  reconstructFromPdfBBox,
} from '../lib/leadsheetReconstruct.mjs'
import { rehydrateLyricTokens, lyricTokensLookSyllabic } from '../lib/syllableRehydrate.mjs'
import { preferSongTitle, isMetadataText, extractSongMetadata, filterMetadataLines, keyFromLeadSheetFilename } from '../lib/songMetadata.mjs'
import { softFormatChordChart, parseChartBlocks, chordLyricToWordStacks } from '../lib/chartLayout.mjs'
import { renderChartHtmlDocument } from '../lib/chartHtml.mjs'
import { parseTempoBpm } from '../lib/leadsheetAnalysis.mjs'
import { lyricsToHomrNoteVerified, lyrics_to_homr_note_verified, assertRealNoteLinkage } from '../lib/lyricsToHomrNotes.mjs'
import { buildLeadSheetMusicXml, transposeMusicXml, classifyChordPlacement, musicXmlHasMelody } from '../lib/musicxmlLeadSheet.mjs'
import { transposeEditorText } from '../lib/editorKey.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// --- Title ---
assert(preferSongTitle({ filename: 'Bahnt einen Weg unserm Gott-lead-G.pdf' }) === 'Bahnt einen Weg unserm Gott', 'strip -lead-G')
assert(preferSongTitle({ filename: 'Heilig für immer-lead-Bb.pdf' }) === 'Heilig für immer', 'strip -lead-Bb')
assert(preferSongTitle({ filename: 'Herr ich komme zu dir-lead-A.pdf' }) === 'Herr ich komme zu dir', 'strip -lead-A')
assert(preferSongTitle({ filename: 'majestaet-lead-G.pdf' }) === 'majestaet', 'strip majestaet-lead-G')
assert(preferSongTitle({ filename: 'Wo ich auch stehe-lead-C.pdf' }) === 'Wo ich auch stehe', 'strip -lead-C')
assert(preferSongTitle({ nativeTitle: 'Bahnt einen Weg unserm Gott', filename: 'Bahnt einen Weg unserm Gott-lead-G.pdf' }) === 'Bahnt einen Weg unserm Gott', 'prefer native title')
assert(preferSongTitle({ nativeTitle: 'Bahnt einen Weg unserm Gott-lead-G' }) === 'Bahnt einen Weg unserm Gott', 'strip suffix without filename')
assert(keyFromLeadSheetFilename('Bahnt einen Weg unserm Gott-lead-G.pdf') === 'G', 'key from -lead-G')
assert(keyFromLeadSheetFilename('Heilig für immer-lead-Bb.pdf') === 'Bb', 'key from -lead-Bb')
console.log('OK titles')

// --- Metadata never lyrics ---
assert(isMetadataText('CCLI Song # 1234567'), 'ccli')
assert(isMetadataText('www.songselect.com'), 'songselect site')
assert(isMetadataText('© 2001 Author / Verlag'), 'copyright')
assert(isMetadataText('Text und Melodie: Example Author'), 'author line')
assert(!isMetadataText('Bahnt einen Weg unserm Gott'), 'title not meta')
assert(!isMetadataText('einen Weg unserm Gott'), 'lyric not meta')
const filtered = filterMetadataLines('einen Weg\nCCLI Song # 99\nwww.songselect.com\nEhre sei Gott')
assert(/einen Weg/.test(filtered) && /Ehre/.test(filtered), 'keep lyrics')
assert(!/CCLI/.test(filtered) && !/songselect/i.test(filtered), 'drop footer')
const meta = extractSongMetadata([
  { text: 'Bahnt einen Weg unserm Gott' },
  { text: 'Text: Jane Author' },
  { text: 'Musik: John Composer' },
  { text: 'Übersetzung: A Translator' },
  { text: 'CCLI Song # 5556677' },
  { text: 'CCLI License # 12345' },
  { text: '© 1999 Example Verlag' },
], { filename: 'Bahnt einen Weg unserm Gott-lead-G.pdf' })
assert(meta.ccliSongNumber === '5556677', `ccli song ${meta.ccliSongNumber}`)
assert(meta.ccliLicense === '12345', 'ccli license')
assert(/Jane/.test(meta.author), `author ${meta.author}`)
assert(/John/.test(meta.composer), `composer ${meta.composer}`)
assert(/Translator/.test(meta.translator), `translator ${meta.translator}`)
assert(meta.copyright.includes('1999'), 'copyright field')
console.log('OK metadata filter')

// --- Syllable rehydrate (chord view) ---
const syllables = [
  { text: 'Bahnt', bbox: [40, 200, 90, 230] },
  { text: 'ei', bbox: [110, 200, 130, 230] },
  { text: 'nen', bbox: [170, 200, 210, 230] },
  { text: 'Weg', bbox: [240, 200, 280, 230] },
  { text: 'un', bbox: [300, 200, 325, 230] },
  { text: 'serm', bbox: [370, 200, 420, 230] },
  { text: 'Gott', bbox: [450, 200, 500, 230] },
]
const native = [
  { text: 'Bahnt', bbox: [40, 40, 90, 70] },
  { text: 'einen', bbox: [100, 40, 160, 70] },
  { text: 'Weg', bbox: [170, 40, 210, 70] },
  { text: 'unserm', bbox: [220, 40, 290, 70] },
  { text: 'Gott', bbox: [300, 40, 350, 70] },
]
const line = rehydrateLyricTokens(syllables, { nativeTokens: native })
assert(!/ei nen/.test(line), `no split einen: ${line}`)
assert(!/un serm/.test(line), `no split unserm: ${line}`)
assert(/einen/.test(line) && /unserm/.test(line), `rehydrated: ${line}`)
const ehre = rehydrateLyricTokens([
  { text: 'Eh', bbox: [10, 10, 30, 30] },
  { text: 're', bbox: [50, 10, 70, 30] },
], { nativeTokens: [{ text: 'Ehre', bbox: [10, 80, 80, 100] }] })
assert(ehre === 'Ehre', `Ehre got ${ehre}`)
assert(lyricTokensLookSyllabic(syllables), 'syllabic detector')
console.log('OK syllable rehydrate')

// SongSelect lead sheet: syllables are space-separated on the chord-view path.
// LeadSheet/MusicXML must keep syllabic underlay (asserted later on the hybrid page).
const songSelectFlat = `
Bahnt einen Weg unserm Gott-lead-G
=160
**=160**

1. Bahnt ei nen Weg un serm Gott,
2. Bahnt ei nen Weg un serm Gott,
     C          D  Em    G          C
löst aus der Not. Er ist der Kö nig:
wählt als sein Volk, mit ihm zu halten
     Em        Am         G          C
Er hat am Kreuz ge siegt durch seinen
Öff net die Her zen und macht euch
     Hm      C           Dsus       G
Reich kom me, o Herr, er he be dich
     D        G          Hm         C
Dir sei Eh re und Ruhm und Ma jes tät!
     Am
ne Herr lich keit
     C G
hier.

For use solely with the SongSelect
CCLI License # 2243716
Lothar Text und Kosse Musik:

[Refrain]
G
Dein
Dsus
Macht.
D/F
keit ist
uns er
ni ge.
wig keit.
`.trim()

assert(parseTempoBpm(songSelectFlat) === 160, `=160 parsed, got ${parseTempoBpm(songSelectFlat)}`)
assert(parseTempoBpm('**=160**') === 160, 'bold =160')
const playable = softFormatChordChart(songSelectFlat)
assert(!/(^|\n)\s*=\s*160\b/.test(playable), `tempo leaked:\n${playable}`)
assert(!/lead-G/i.test(playable), `filename junk:\n${playable}`)
assert(!/CCLI|SongSelect|Kosse Musik/i.test(playable), `footer leaked:\n${playable}`)
assert(/\[Refrain\]/.test(playable), 'section kept')
assert(/\[Strophe\]|1\. Bahnt einen Weg unserm Gott/.test(playable), `verse line:\n${playable}`)
for (const word of ['einen', 'unserm', 'König', 'gesiegt', 'Öffnet', 'Herzen', 'komme', 'erhebe', 'Ehre', 'Majestät', 'Herrlichkeit', 'unser']) {
  assert(playable.includes(word), `missing ${word} in:\n${playable}`)
}
assert(!/ei nen|un serm|Kö nig|Her zen|Eh re|kom me|ge siegt|Öff net|Ma jes|Herr lich/.test(playable), `syllables still split:\n${playable}`)
assert(!/^Dein$/m.test(playable) && !/^Macht\.$/m.test(playable), `vertical token lines:\n${playable}`)
const refrainAt = playable.indexOf('[Refrain]')
const refrain = playable.slice(refrainAt)
assert(/Dein/.test(refrain) && /Macht/.test(refrain), `refrain words:\n${refrain}`)
const refrainLines = refrain.split('\n').filter((line) => /Dein/.test(line) && /Macht/.test(line))
assert(refrainLines.length === 1, `Dein and Macht must share a lyric line:\n${refrain}`)
const refrainChord = refrain.split('\n')[refrain.split('\n').indexOf(refrainLines[0]) - 1] || ''
assert(/\bG\b/.test(refrainChord) && /Dsus/.test(refrainChord) && /D\/F/.test(refrainChord), `refrain chords ${refrainChord}`)
const stacks = chordLyricToWordStacks(refrainChord, refrainLines[0])
const byWord = Object.fromEntries(stacks.filter((stack) => stack.chord).map((stack) => [stack.word.replace(/[.,:;!?]+$/g, ''), stack.chord]))
assert(byWord.Dein === 'G', `G above Dein, got ${JSON.stringify(stacks)}`)
assert(byWord.Macht === 'Dsus', `Dsus above Macht, got ${JSON.stringify(stacks)}`)
assert(/wählt als sein Volk/.test(playable), 'verse 2 lyric kept')
const verse2Idx = playable.split('\n').findIndex((line) => /wählt als sein Volk/.test(line))
const verse2Chord = playable.split('\n')[verse2Idx - 1] || ''
assert(isChordLineSafe(verse2Chord), `verse 2 needs chords above, got ${JSON.stringify(verse2Chord)}\n${playable}`)
const blocks = parseChartBlocks(playable, { maxCols: 28 })
const longPairs = blocks.filter((block) => block.kind === 'pair')
assert(longPairs.length >= 2, 'pairs for chord+lyric')
assert(longPairs.every((block) => (block.lyricLine || '').length <= 36), `wrap overflow:\n${longPairs.map((b) => b.lyricLine).join(' | ')}`)
const html = renderChartHtmlDocument({
  title: 'Bahnt einen Weg unserm Gott-lead-G',
  targetKey: 'G',
  content: songSelectFlat,
  fontSize: 16,
  bpm: 160,
})
assert(html.includes('Bahnt einen Weg unserm Gott') && !html.includes('-lead-G'), 'html title cleaned')
assert(html.includes('einen') && html.includes('unserm') && html.includes('König'), 'html merged words')
assert(!html.includes('ei nen') && !html.includes('=160') && !/CCLI/.test(html), 'html noise gone')
assert(/min-width:0/.test(html) && /flex-wrap:wrap/.test(html) && /white-space:pre-wrap/.test(html), 'html wraps instead of clipping')
assert(/width:100%/.test(html), 'chart width constrained')
console.log('OK SongSelect flat syllable chart')

function isChordLineSafe(line) {
  return /[A-G]/.test(line) && !/[a-zäöü]{3,}/u.test(line)
}

const bahntPage = {
  engine: 'hybrid-test',
  pages: [{
    page_index: 0,
    width: 900,
    height: 1200,
    systems: [{ index: 0, y0: 140, y1: 190, spacing: 12, score: 1 }],
    tokens: [
      { text: 'Bahnt einen Weg unserm Gott', bbox: [80, 30, 520, 70], confidence: 0.99, role: 'Title', source: 'pdftotext-bbox' },
      { text: 'G', bbox: [80, 100, 100, 130], confidence: 0.99, source: 'pdftotext-bbox' },
      { text: 'C', bbox: [200, 100, 220, 130], confidence: 0.99, source: 'pdftotext-bbox' },
      { text: 'G', bbox: [320, 100, 340, 130], confidence: 0.99, source: 'audiveris-chord' },
      { text: 'ei', bbox: [80, 220, 105, 250], confidence: 0.99 },
      { text: 'nen', bbox: [150, 220, 200, 250], confidence: 0.99 },
      { text: 'Weg', bbox: [230, 220, 280, 250], confidence: 0.99 },
      { text: 'un', bbox: [300, 220, 330, 250], confidence: 0.99 },
      { text: 'serm', bbox: [380, 220, 440, 250], confidence: 0.99 },
      { text: 'Gott', bbox: [470, 220, 530, 250], confidence: 0.99 },
      { text: 'Eh', bbox: [80, 270, 105, 300], confidence: 0.99 },
      { text: 're', bbox: [140, 270, 170, 300], confidence: 0.99 },
      { text: 'CCLI Song # 7070707', bbox: [80, 1100, 360, 1130], confidence: 0.99 },
      { text: 'www.songselect.com', bbox: [80, 1140, 300, 1170], confidence: 0.99 },
    ],
    notes: [
      { id: 'n1', measure: 1, onset: 0, staff: 1, step: 'G', octave: 4, duration: 1, x: 90, y: 160 },
      { id: 'n2', measure: 1, onset: 1, staff: 1, step: 'A', octave: 4, duration: 1, x: 160, y: 155 },
      { id: 'n3', measure: 1, onset: 2, staff: 1, step: 'B', octave: 4, duration: 1, x: 250, y: 150 },
      { id: 'n4', measure: 1, onset: 3, staff: 1, step: 'D', octave: 5, duration: 1, x: 310, y: 145 },
    ],
    musicxml: '',
  }],
}

const hybrid = reconstructHybridSong(bahntPage, {
  filename: 'Bahnt einen Weg unserm Gott-lead-G.pdf',
  nativeTokens: native,
})
const chordText = hybrid.chordView.text
assert(hybrid.chordView.title === 'Bahnt einen Weg unserm Gott', `title ${hybrid.chordView.title}`)
assert(/einen/.test(chordText), `chord view einen: ${chordText}`)
assert(/unserm/.test(chordText), `chord view unserm: ${chordText}`)
assert(/Ehre/.test(chordText), `chord view Ehre: ${chordText}`)
assert(!/ei nen/.test(chordText), 'chord view must not keep ei nen')
assert(!/CCLI/.test(chordText) && !/songselect/i.test(chordText), `footer leaked:\n${chordText}`)
assert(/G/.test(chordText) && /C/.test(chordText), 'native chords kept')
assert(hybrid.leadSheet.hasMelody, 'leadsheet has melody')
assert(musicXmlHasMelody(hybrid.leadSheet.musicxml), 'musicxml melody')
assert(/<harmony/.test(hybrid.leadSheet.musicxml), 'chords above staff as harmony')
assert(/<lyric/.test(hybrid.leadSheet.musicxml), 'lyrics under notes')
assert(/<text>ei<\/text>/.test(hybrid.leadSheet.musicxml), 'leadsheet keeps syllabic underlay')
assert(!/<text>einen<\/text>/.test(hybrid.leadSheet.musicxml), 'leadsheet must not reuse chord-view words')
assert(hybrid.chordView.text !== hybrid.leadSheet.musicxml, 'two different reconstructions')
console.log('OK hybrid Bahnt chord vs leadsheet')

// --- lyrics_to_homr_note_verified ---
const linked = lyrics_to_homr_note_verified(
  [
    { text: 'ei', bbox: [80, 220, 105, 250] },
    { text: 'nen', bbox: [150, 220, 200, 250] },
    { text: 'orphan', bbox: [800, 220, 860, 250] },
  ],
  bahntPage.pages[0].notes,
)
assert(linked.verified.length >= 1, 'some verified')
assert(linked.unmatched.includes(2), 'orphan unmatched')
assertRealNoteLinkage(linked.verified)
assert(linked.verified.every((item) => item.noteId && item.measure != null && item.onset != null && item.staff != null), 'linkage fields')
assert(linked.verified.length !== 3, 'must not mark first N as verified')
const fake = [{ text: 'ei', verified: true }, { text: 'nen', verified: true }]
let threw = false
try { assertRealNoteLinkage(fake) } catch { threw = true }
assert(threw, 'fake first-N verification rejected')
console.log('OK lyrics_to_homr_note_verified')

// --- Chords: exact symbols, onset vs measure ---
const onset = classifyChordPlacement(
  { text: 'Gmaj7/D', bbox: [80, 100, 140, 130] },
  [{ id: 'n1', x: 90, measure: 1, onset: 0, staff: 1 }],
)
assert(onset.placement === 'onset' && onset.review === false && onset.text === 'Gmaj7/D', `onset ${JSON.stringify(onset)}`)
const measureOnly = classifyChordPlacement(
  { text: 'Em', measure: 2, bbox: [700, 100, 730, 130] },
  [{ id: 'n1', x: 90, measure: 1, onset: 0, staff: 1 }],
)
assert(measureOnly.placement === 'measure' && measureOnly.review === true, `measure-only ${JSON.stringify(measureOnly)}`)
console.log('OK chord placement certainty')

// --- Transposition: notes+chords, lyrics unchanged, Bb/Eb/Ab ---
const xml = buildLeadSheetMusicXml({
  title: 'Test',
  key: 'G',
  notes: bahntPage.pages[0].notes,
  chords: [{ text: 'G', x: 90, measure: 1, bbox: [80, 100, 100, 130] }],
  lyricTokens: [{ text: 'ei', bbox: [80, 220, 105, 250] }],
})
const toC = transposeMusicXml(xml, 'G', 'C')
assert(/<fifths>0<\/fifths>/.test(toC), 'G→C fifths')
assert(/<text>ei<\/text>/.test(toC), 'lyrics unchanged in xml')
const toBb = transposeMusicXml(xml, 'G', 'Bb')
assert(/<fifths>-2<\/fifths>/.test(toBb), 'Bb key signature')
const chart = 'G     C\nei nen Weg'
const transposedChart = transposeEditorText('G     C\neinen Weg', 'G', 'A')
assert(transposedChart.split('\n')[1] === 'einen Weg', 'chord-view lyrics unchanged')
assert(transposedChart.split('\n')[0].includes('A'), 'G→A root')
console.log('OK transposition')

// --- Golden set titles/lyrics/metadata/chords ---
const goldens = [
  { file: 'Bahnt einen Weg unserm Gott-lead-G.pdf', title: 'Bahnt einen Weg unserm Gott', key: 'G' },
  { file: 'Heilig für immer-lead-Bb.pdf', title: 'Heilig für immer', key: 'Bb' },
  { file: 'Herr ich komme zu dir-lead-A.pdf', title: 'Herr ich komme zu dir', key: 'A' },
  { file: 'majestaet-lead-G.pdf', title: 'majestaet', key: 'G' },
  { file: 'Wo ich auch stehe-lead-C.pdf', title: 'Wo ich auch stehe', key: 'C' },
]
for (const song of goldens) {
  assert(preferSongTitle({ filename: song.file }) === song.title, song.file)
  const structured = {
    engine: 'golden',
    pages: [{
      page_index: 0,
      width: 800,
      height: 1000,
      tokens: [
        { text: song.title, bbox: [40, 20, 400, 50], role: 'Title', source: 'pdftotext-bbox' },
        { text: song.key, bbox: [40, 80, 70, 110], source: 'pdftotext-bbox' },
        { text: 'ei', bbox: [40, 200, 60, 230] },
        { text: 'nen', bbox: [90, 200, 130, 230] },
        { text: 'SongSelect Terms of Use', bbox: [40, 940, 400, 970] },
      ],
      notes: [
        { id: 'g1', measure: 1, onset: 0, staff: 1, step: 'C', octave: 4, duration: 1, x: 50, y: 140 },
      ],
    }],
  }
  const out = reconstructHybridSong(structured, { filename: song.file, nativeTokens: [{ text: 'einen', bbox: [40, 20, 90, 50] }] })
  assert(out.chordView.title === song.title, `${song.file} title`)
  assert(/einen/.test(out.chordView.text), `${song.file} lyrics`)
  assert(!/SongSelect/.test(out.chordView.text), `${song.file} metadata`)
  assert(out.leadSheet.hasMelody, `${song.file} musicxml`)
}
console.log('OK golden set')

// BPM: unknown stays null, 120 is not invented
assert(hybrid.metadata.bpm == null, 'no default 120')
console.log('OK bpm null without source')

console.log('test-chord-leadsheet-quality: all passed')
