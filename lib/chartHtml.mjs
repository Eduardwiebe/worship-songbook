/**
 * Server-side HTML for edited lead sheets (Set play / chart iframe).
 * Mirrors ChartSheet column layout so saved sheetColumns=2 is visible in run mode.
 */
import { parseChartBlocks, softFormatChordChart } from './chartLayout.mjs'

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

/** Drop TONART/KEY meta lines — the chart already shows Tonart above the sheet. */
function isRedundantKeyMeta(text) {
  return /^(?:TONART|Tonart|KEY|Key)\s*[:·\-–—]/i.test(String(text || '').trim())
}

function renderBlock(block) {
  if (!block) return ''
  if (block.kind === 'blank') return '<div class="chart-blank">&nbsp;</div>'
  if (block.kind === 'section') {
    const label = String(block.text || '').trim().replace(/^\[|\]$/g, '')
    return `<div class="chart-section">${escapeHtml(label)}</div>`
  }
  if (block.kind === 'meta') {
    return `<div class="chart-meta">${escapeHtml(block.text)}</div>`
  }
  if (block.kind === 'pair') {
    const stacks = (block.stacks || []).map((stack) => {
      const chord = stack.chord ? escapeHtml(stack.chord) : '&nbsp;'
      const word = stack.word ? escapeHtml(stack.word) : '&nbsp;'
      return `<span class="chart-stack"><span class="chart-stack-chord">${chord}</span><span class="chart-stack-word">${word}</span></span>`
    }).join('')
    return `<div class="chart-pair">${stacks}</div>`
  }
  if (block.kind === 'chords') {
    return `<div class="chart-chords">${escapeHtml(block.text)}</div>`
  }
  return `<div class="chart-lyrics">${escapeHtml(block.text)}</div>`
}

/**
 * Build a self-contained chart HTML document.
 * @param {{ title: string, targetKey: string, content: string, columns?: number, fontSize?: number }} opts
 */
export function renderChartHtmlDocument({ title, targetKey, content, columns = 1, fontSize = 16 } = {}) {
  const cols = normalizeSheetColumns(columns)
  const size = Math.min(28, Math.max(11, Number(fontSize) || 16))
  const maxCols = cols === 2 ? 28 : 44
  const display = softFormatChordChart(content || '')
  const blocks = parseChartBlocks(display, { maxCols })
  const filtered = []
  for (const block of blocks) {
    if (block?.kind === 'meta' && isRedundantKeyMeta(block.text)) continue
    // Collapse blank lines left behind after dropping a key meta at the top
    if (block?.kind === 'blank' && filtered.length === 0) continue
    if (block?.kind === 'blank' && filtered.length && filtered[filtered.length - 1]?.kind === 'blank') continue
    filtered.push(block)
  }
  const body = filtered.map(renderBlock).join('')
  const mainMax = cols === 2 ? '1180px' : '900px'
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} – ${escapeHtml(targetKey)}</title><style>
html,body{margin:0;min-height:100%;background:#fff;color:#171717}
main{max-width:${mainMax};margin:0 auto;background:#fff;min-height:100%;padding:28px 36px 48px;box-sizing:border-box}
h1{font:700 26px system-ui,sans-serif;margin:0 0 6px}
.key{color:#785d1f;font:700 14px system-ui,sans-serif;margin-bottom:22px}
.chart-sheet{color:#1a222b;font:${size}px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-ligatures:none;white-space:normal;overflow-x:hidden;max-width:100%;box-sizing:border-box}
.chart-sheet.columns-2{column-count:2;column-gap:28px;column-rule:1px solid #edf0f2;column-fill:balance}
.chart-chords{color:#c62828;font-weight:700;min-height:1.15em;white-space:pre;margin:0 0 .35em}
.chart-lyrics{color:#15202b;font-weight:500;margin:0 0 .85em;min-height:1.15em;white-space:pre-wrap;overflow-wrap:anywhere}
.chart-section{margin:1.15em 0 .45em;color:#8a6a1f;font-weight:850;letter-spacing:.04em;text-transform:uppercase;font-size:.92em;break-inside:avoid}
.chart-meta{color:#6b7785;font-weight:700;margin:0 0 .8em;break-inside:avoid}
.chart-blank{min-height:.55em}
.chart-pair{display:flex;flex-wrap:wrap;align-items:flex-end;gap:0 .55em;margin:0 0 .85em;max-width:100%;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
.chart-stack{display:inline-flex;flex-direction:column;align-items:flex-start;max-width:100%}
.chart-stack-chord{color:#c62828;font-weight:700;min-height:1.15em;line-height:1.15;white-space:pre}
.chart-stack-word{color:#15202b;font-weight:500;min-height:1.15em;line-height:1.15;white-space:pre}
@media (max-width:800px){main{padding:20px 14px 40px}.chart-sheet.columns-2{column-gap:18px}}
@media (max-width:560px){.chart-sheet.columns-2{column-count:1}}
@media print{body{background:#fff}main{padding:0;max-width:none}}
</style></head><body><main><h1>${escapeHtml(title)}</h1><div class="key">Tonart: ${escapeHtml(targetKey)}</div><div class="chart-sheet columns-${cols}">${body}</div></main></body></html>`
}
