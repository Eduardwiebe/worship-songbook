/**
 * OpenAI vision provider. One image request per page. No other vendors here.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { normalizeVisionDocument } from '../visionLeadsheet.mjs'

const execFileAsync = promisify(execFile)

const SYSTEM = `You read a photographed hymnal / leadsheet page (notation + lyrics + chord symbols).
Return ONLY JSON that matches this shape:
{"title":string,"key":string,"confidence":number,"needsReview":boolean,"sections":[{"type":"verse"|"chorus"|"bridge"|"intro"|"outro","number":number|null,"lines":[{"lyrics":string,"confidence":number,"needsReview":boolean,"chords":[{"chord":string,"index":number}]}]}]}

Rules:
- Interpret the page as music, not reading-order OCR.
- Keep parallel verses as separate verse sections. If a shared Refrain is printed once after numbered verses, emit musical order: verse 1, chorus, verse 2. Print chorus lyrics only once.
- If that same refrain clearly applies again after verse 2 (shared Refrain heading, repeat mark, or D.S.), add a following chorus with empty lines and "repeat": true. Do not copy chorus lyrics a second time.
- If section order is not clear from the page, keep page order and set needsReview true.
- Reconstruct engraved syllable hyphens: ste-he → stehe, barm-her-zig → barmherzig.
- Restore normal German word spaces. Never emit glued chains.
- Keep ä ö ü ß when visible.
- Ignore page numbers, song numbers, rubrics (LOB & DANK), copyright, publisher, tempo marks.
- Chords only if a real symbol is visible: C, Cm, C7, Cmaj7, Dm7, F/C, G/B, D/F#, A/C#, Bb, Eb/G, etc.
- Never glue two chord symbols into one token (not GC, not CC). One visible symbol → one chord object.
- chord.index is the 0-based character offset of the syllable the chord sounds on (ChordPro-style, as in [G]lobe). Use the word start, never the start of the line unless that is truly where the chord belongs.
- If the syllable offset is unknown, omit that chord and set needsReview true. Never invent index 0.
- Do not invent lyrics or chords. If unsure, omit the chord and set needsReview true.
- Missing chord is better than a guessed chord.`

export function openaiConfig() {
  const apiKey = process.env.SONGBOOK_VISION_API_KEY || process.env.OPENAI_API_KEY || ''
  return {
    apiKey,
    model: process.env.SONGBOOK_VISION_MODEL || 'gpt-4.1',
    baseUrl: (process.env.SONGBOOK_VISION_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  }
}

async function imageAsJpegDataUrl(imagePath) {
  const { stdout } = await execFileAsync('/usr/bin/python3', ['-c', `
from PIL import Image
import io, sys
img = Image.open(sys.argv[1]).convert("RGB")
img.thumbnail((1600, 2200), Image.Resampling.LANCZOS)
buf = io.BytesIO()
img.save(buf, "JPEG", quality=82, optimize=True)
sys.stdout.buffer.write(buf.getvalue())
`, imagePath], { maxBuffer: 8 * 1024 * 1024, timeout: 30000, encoding: 'buffer' })
  return `data:image/jpeg;base64,${Buffer.from(stdout).toString('base64')}`
}

function parseModelJson(content) {
  const raw = String(content || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonText = fenced ? fenced[1] : raw
  return JSON.parse(jsonText)
}

export async function recognizeMusicPage(imagePath) {
  const config = openaiConfig()
  if (!config.apiKey) {
    const error = new Error('SONGBOOK_VISION_API_KEY / OPENAI_API_KEY missing')
    error.code = 'VISION_UNAVAILABLE'
    throw error
  }
  const started = Date.now()
  const dataUrl = await imageAsJpegDataUrl(imagePath)
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 3500,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this leadsheet page into the JSON schema. One page only.' },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  const parsed = parseModelJson(payload?.choices?.[0]?.message?.content)
  const usage = payload?.usage || {}
  const prompt = Number(usage.prompt_tokens) || 0
  const completion = Number(usage.completion_tokens) || 0
  const costUsd = Number(((prompt * 2.5 + completion * 10) / 1_000_000).toFixed(5))
  const document = normalizeVisionDocument({
    ...parsed,
    model: config.model,
    provider: 'openai',
    usage: {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: Number(usage.total_tokens) || prompt + completion,
      costUsd,
      elapsedMs: Date.now() - started,
    },
  })
  return document
}
