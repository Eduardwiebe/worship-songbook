/**
 * Server-side HTML for edited lead sheets (Set play / chart iframe).
 * Mirrors ChartSheet column layout so saved sheetColumns=2 is visible in run mode.
 * Clean stage lead sheet: [Section] headers, chord pills, optional lyrics-only.
 */
import {
  formatSectionLabel,
  isRedundantKeyMeta,
  parseChartBlocks,
  softFormatChordChart,
} from './chartLayout.mjs'

export function normalizeSheetColumns(value) {
  const n = Number(value)
  return n === 2 ? 2 : 1
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char])
}

function truthyFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function renderBlock(block, { lyricsOnly = false } = {}) {
  if (!block) return ''
  if (block.kind === 'blank') return '<div class="chart-blank">&nbsp;</div>'
  if (block.kind === 'section') {
    const label = formatSectionLabel(block.text)
    return `<div class="chart-section">${escapeHtml(label)}</div>`
  }
  if (block.kind === 'meta') {
    return `<div class="chart-meta">${escapeHtml(block.text)}</div>`
  }
  if (block.kind === 'pair') {
    const stacks = (block.stacks || []).map((stack) => {
      const chordRaw = String(stack.chord || '').trim()
      const chord = chordRaw ? escapeHtml(chordRaw) : '&nbsp;'
      const word = stack.word ? escapeHtml(stack.word) : '&nbsp;'
      const chordClass = chordRaw ? 'chart-stack-chord chart-chord-pill' : 'chart-stack-chord'
      const chordHtml = lyricsOnly
        ? '<span class="chart-stack-chord" aria-hidden="true"></span>'
        : `<span class="${chordClass}">${chord}</span>`
      return `<span class="chart-stack">${chordHtml}<span class="chart-stack-word">${word}</span></span>`
    }).join('')
    return `<div class="chart-pair">${stacks}</div>`
  }
  if (block.kind === 'chords') {
    if (lyricsOnly) return ''
    return `<div class="chart-chords">${escapeHtml(block.text)}</div>`
  }
  return `<div class="chart-lyrics">${escapeHtml(block.text)}</div>`
}

/**
 * Build a self-contained chart HTML document.
 * @param {{ title: string, targetKey: string, content: string, columns?: number, fontSize?: number, lyricsOnly?: boolean, bpm?: string|number, tuning?: string }} opts
 */
export function renderChartHtmlDocument({
  title,
  targetKey,
  content,
  columns = 1,
  fontSize = 16,
  lyricsOnly = false,
  bpm = '',
  tuning = '',
} = {}) {
  const cols = normalizeSheetColumns(columns)
  const size = Math.min(28, Math.max(11, Number(fontSize) || 16))
  const maxCols = cols === 2 ? 28 : 44
  const onlyLyrics = Boolean(lyricsOnly)
  const display = softFormatChordChart(content || '')
  const blocks = parseChartBlocks(display, { maxCols })
  const filtered = []
  for (const block of blocks) {
    if (block?.kind === 'meta' && isRedundantKeyMeta(block.text)) continue
    if (block?.kind === 'blank' && filtered.length === 0) continue
    if (block?.kind === 'blank' && filtered.length && filtered[filtered.length - 1]?.kind === 'blank') continue
    if (onlyLyrics && block?.kind === 'chords') continue
    filtered.push(block)
  }
  const body = filtered.map((block) => renderBlock(block, { lyricsOnly: onlyLyrics })).join('')
  const mainMax = cols === 2 ? '1180px' : '900px'
  const metaParts = []
  if (targetKey) metaParts.push(`Tonart ${escapeHtml(targetKey)}`)
  if (tuning) metaParts.push(escapeHtml(tuning))
  const bpmNum = Number(bpm)
  if (Number.isFinite(bpmNum) && bpmNum > 0) metaParts.push(`${Math.round(bpmNum)} BPM`)
  const metaHtml = metaParts.length
    ? `<div class="chart-header-meta">${metaParts.join(' · ')}</div>`
    : ''
  const sheetClass = `chart-sheet columns-${cols}${onlyLyrics ? ' lyrics-only' : ''}`

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} – ${escapeHtml(targetKey)}</title><style>
html,body{margin:0;min-height:100%;background:#f7f5f1;color:#171717}
main{max-width:${mainMax};margin:0 auto;background:#fff;min-height:100%;padding:28px 36px 56px;box-sizing:border-box;box-shadow:0 0 0 1px rgba(24,32,40,.04)}
h1{font:700 28px/1.15 "Segoe UI",system-ui,-apple-system,sans-serif;margin:0 0 8px;letter-spacing:-.01em}
.chart-header-meta{color:#785d1f;font:700 14px/1.35 "Segoe UI",system-ui,sans-serif;margin:0 0 26px;letter-spacing:.02em}
.chart-sheet{color:#1a222b;font:${size}px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-ligatures:none;white-space:normal;overflow-x:hidden;max-width:100%;box-sizing:border-box}
.chart-sheet.columns-2{column-count:2;column-gap:32px;column-rule:1px solid #edf0f2;column-fill:balance}
.chart-chords{color:#b71c1c;font-weight:700;min-height:1.15em;white-space:pre;margin:0 0 .45em}
.chart-lyrics{color:#15202b;font-weight:550;margin:0 0 1em;min-height:1.2em;white-space:pre-wrap;overflow-wrap:anywhere;font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
.chart-section{margin:1.85em 0 .7em;padding:.28em 0;color:#6b5318;font:800 .95em/1.2 "Segoe UI",system-ui,sans-serif;letter-spacing:.06em;text-transform:none;border-bottom:1px solid #ead9a8;break-inside:avoid}
.chart-section:first-child{margin-top:.35em}
.chart-meta{color:#6b7785;font-weight:700;margin:0 0 .9em;break-inside:avoid}
.chart-blank{min-height:.7em}
.chart-pair{display:flex;flex-wrap:wrap;align-items:flex-end;gap:.28em .65em;margin:0 0 1.05em;max-width:100%;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
.chart-stack{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%;gap:.12em}
.chart-stack-chord{color:#b71c1c;font-weight:700;min-height:1.2em;line-height:1.2;white-space:pre}
.chart-chord-pill{display:inline-block;padding:.08em .48em;border-radius:999px;background:#fce8e6;color:#9b1b1b;font-size:.86em;font-weight:750;letter-spacing:.01em;box-shadow:inset 0 0 0 1px rgba(183,28,28,.12);min-height:auto}
.chart-stack-word{color:#15202b;font-weight:550;min-height:1.2em;line-height:1.25;white-space:pre;font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
.lyrics-only .chart-stack{gap:0}
.lyrics-only .chart-stack-chord{display:none!important;min-height:0}
.lyrics-only .chart-pair{margin:0 0 .85em}
@media (max-width:800px){main{padding:20px 14px 40px}.chart-sheet.columns-2{column-gap:18px}}
@media (max-width:560px){.chart-sheet.columns-2{column-count:1}}
@media print{body{background:#fff}main{padding:0;max-width:none;box-shadow:none}}
</style></head><body><main><h1>${escapeHtml(title)}</h1>${metaHtml}<div class="${sheetClass}">${body}</div></main></body></html>`
}
