/**
 * Vision leadsheet document: schema, editor rendering, OMR/OCR validation.
 * Vision output is never passed through OCR glue-split / hyphen heuristics.
 */

import { cleanOcrText, isChordLine, scoreLeadsheetQuality } from './leadsheetAnalysis.mjs'
import { normalizeChordGlyphs } from './ocrTextRefine.mjs'
import { isValidChordToken, mergeChordCandidates, tokenCenterX, tokenCenterY } from './leadsheetReconstruct.mjs'

export const VISION_SECTION_TYPES = new Set(['verse', 'chorus', 'bridge', 'intro', 'outro', 'prechorus', 'unknown'])

export function normalizeVisionDocument(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const sections = []
  let uncertain = Boolean(source.needsReview)
  for (const section of Array.isArray(source.sections) ? source.sections : []) {
    const type = String(section?.type || 'unknown').toLowerCase()
    const lines = []
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      const lyrics = String(line?.lyrics || '').replace(/[ \t]+/g, ' ').trim()
      if (!lyrics) continue
      const chords = []
      for (const item of Array.isArray(line?.chords) ? line.chords : []) {
        const chord = normalizeChordGlyphs(item?.chord || item?.text || '')
        if (!isValidChordToken(chord)) {
          if (String(item?.chord || '').trim()) uncertain = true
          continue
        }
        const index = Math.max(0, Math.min(lyrics.length, Number(item?.index) || 0))
        chords.push({ chord, index })
      }
      chords.sort((a, b) => a.index - b.index)
      const lineReview = Boolean(line?.needsReview) || (Number(line?.confidence) > 0 && Number(line.confidence) < 0.75)
      if (lineReview) uncertain = true
      lines.push({
        lyrics,
        chords,
        confidence: Number(line?.confidence) || null,
        needsReview: lineReview,
      })
    }
    if (!lines.length) continue
    sections.push({
      type: VISION_SECTION_TYPES.has(type) ? type : 'unknown',
      number: Number(section?.number) || null,
      lines,
    })
  }
  const confidence = clamp01(source.confidence)
  return {
    title: String(source.title || '').replace(/[ \t]+/g, ' ').trim(),
    key: String(source.key || '').trim(),
    sections,
    confidence,
    needsReview: uncertain || confidence > 0 && confidence < 0.75 || !sections.length,
    usage: source.usage || null,
    model: source.model || null,
    provider: source.provider || null,
  }
}

export function sectionLabel(section) {
  if (section.type === 'verse') return `Strophe ${section.number || 1}`
  if (section.type === 'chorus') return 'Refrain'
  if (section.type === 'bridge') return 'Bridge'
  if (section.type === 'intro') return 'Intro'
  if (section.type === 'outro') return 'Outro'
  if (section.type === 'prechorus') return 'Pre-Chorus'
  return 'Teil'
}

export function placeChordsByIndex(lyrics, chords) {
  if (!chords?.length || !lyrics) return ''
  const slots = Array.from({ length: Math.max(lyrics.length, 8) }, () => ' ')
  for (const item of [...chords].sort((a, b) => a.index - b.index)) {
    let pos = Math.max(0, Math.min(slots.length - 1, Number(item.index) || 0))
    const label = item.chord
    while (pos > 0 && slots.slice(pos, pos + label.length).some((char) => char !== ' ')) {
      pos += 1
      if (pos + label.length > slots.length) slots.push(...Array.from({ length: label.length + 2 }, () => ' '))
    }
    while (pos + label.length > slots.length) slots.push(' ')
    for (let i = 0; i < label.length; i += 1) slots[pos + i] = label[i]
  }
  return slots.join('').replace(/\s+$/g, '')
}

export function leadsheetFromVision(document) {
  const doc = normalizeVisionDocument(document)
  const body = []
  for (const section of doc.sections) {
    if (body.length) body.push('')
    body.push(`[${sectionLabel(section)}]`)
    for (const line of section.lines) {
      const chordLine = placeChordsByIndex(line.lyrics, line.chords)
      if (chordLine.trim()) body.push(chordLine)
      body.push(line.lyrics)
    }
  }
  let text = body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (doc.title && !text.toLowerCase().startsWith(doc.title.toLowerCase())) {
    text = `${doc.title}\n\n${text}`.trim()
  }
  return cleanOcrText(text)
}

function normalizeLetters(value) {
  return String(value || '').toLowerCase().replace(/[^a-zäöüß]/g, '')
}

function stackedSlashNames(tokens) {
  const names = new Set()
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const left = tokens[i]
      const right = tokens[j]
      if (Math.abs(tokenCenterX(left) - tokenCenterX(right)) >= 28) continue
      const dy = Math.abs(tokenCenterY(left) - tokenCenterY(right))
      if (dy < 12 || dy > 90) continue
      const top = tokenCenterY(left) < tokenCenterY(right) ? left : right
      const bottom = top === left ? right : left
      const slash = `${normalizeChordGlyphs(top.text)}/${normalizeChordGlyphs(bottom.text)}`
      if (isValidChordToken(slash)) names.add(slash)
    }
  }
  return [...names]
}

function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(1, number))
}

export function validateVisionWithOmr(document, structured) {
  const doc = normalizeVisionDocument(document)
  const pages = structured?.pages || (structured?.tokens ? [structured] : [])
  const tokens = pages.flatMap((page) => page.tokens || [])
  const chordTokens = tokens.filter((token) => token.source === 'audiveris-chord' || isValidChordToken(token.text))
  const omrChords = [
    ...mergeChordCandidates(chordTokens).chords.map((token) => token.text),
    ...stackedSlashNames(chordTokens),
  ].filter(Boolean)
  const ocrFragments = tokens
    .map((token) => normalizeLetters(token.text))
    .filter((text) => text.length >= 4)

  const visionChords = doc.sections.flatMap((section) => section.lines.flatMap((line) => line.chords.map((item) => item.chord)))
  let matchedChords = 0
  for (const chord of visionChords) {
    if (omrChords.includes(chord)) matchedChords += 1
  }
  let matchedLines = 0
  let lineCount = 0
  for (const section of doc.sections) {
    for (const line of section.lines) {
      lineCount += 1
      const letters = normalizeLetters(line.lyrics)
      if (!letters) continue
      const hit = ocrFragments.some((fragment) => letters.includes(fragment) || fragment.includes(letters.slice(0, 12)))
      if (hit) matchedLines += 1
      else if ((Number(line.confidence) || doc.confidence) < 0.8) {
        line.needsReview = true
        doc.needsReview = true
      }
    }
  }

  const omrSlashes = [...new Set(omrChords.filter((chord) => chord.includes('/')))]
  for (const slash of omrSlashes) {
    const [root, bass] = slash.split('/')
    let applied = false
    for (const section of doc.sections) {
      if (applied) break
      for (const line of section.lines) {
        const found = line.chords.find((item) => item.chord === root)
        const hasBass = line.chords.some((item) => item.chord === bass)
        if (found && hasBass && !line.chords.some((item) => item.chord === slash)) {
          found.chord = slash
          applied = true
          break
        }
      }
    }
  }

  const chordAgree = visionChords.length ? matchedChords / visionChords.length : 0
  const lyricAgree = lineCount ? matchedLines / lineCount : 0
  if (chordAgree >= 0.5 || lyricAgree >= 0.5) {
    doc.confidence = clamp01(Math.max(doc.confidence, 0.55) + Math.min(0.2, chordAgree * 0.12 + lyricAgree * 0.12))
  }
  if (visionChords.length && omrChords.length && chordAgree < 0.25) {
    doc.needsReview = true
  }
  doc.validation = {
    omrChordCount: omrChords.length,
    visionChordCount: visionChords.length,
    matchedChords,
    matchedLines,
    lineCount,
    chordAgree: Number(chordAgree.toFixed(3)),
    lyricAgree: Number(lyricAgree.toFixed(3)),
  }
  return doc
}

export function visionResultToApi(document, { structured = null, elapsedMs = null } = {}) {
  const validated = structured ? validateVisionWithOmr(document, structured) : normalizeVisionDocument(document)
  const text = leadsheetFromVision(validated)
  const quality = scoreLeadsheetQuality(text)
  const chordLines = text.split('\n').filter(isChordLine)
  return {
    text,
    title: validated.title,
    key: validated.key || '',
    method: `Vision/${validated.provider || 'openai'}`,
    engine: validated.provider || 'vision',
    chordCount: validated.sections.reduce((sum, section) => (
      sum + section.lines.reduce((inner, line) => inner + line.chords.length, 0)
    ), 0),
    chordLines: chordLines.length,
    quality: { ...quality, needsReview: quality.needsReview || validated.needsReview },
    needsReview: quality.needsReview || validated.needsReview,
    avgConfidence: validated.confidence,
    elapsedMs,
    vision: {
      model: validated.model,
      provider: validated.provider,
      confidence: validated.confidence,
      usage: validated.usage,
      validation: validated.validation || null,
    },
    document: validated,
  }
}
