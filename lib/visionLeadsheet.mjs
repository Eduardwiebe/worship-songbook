/**
 * Vision leadsheet document: schema, editor rendering, OMR/OCR validation.
 * Vision output is never passed through OCR glue-split / hyphen heuristics.
 */

import { cleanOcrText, isChordLine, scoreLeadsheetQuality } from './leadsheetAnalysis.mjs'
import { normalizeChordGlyphs } from './ocrTextRefine.mjs'
import { isValidChordToken, mergeChordCandidates, tokenCenterX, tokenCenterY } from './leadsheetReconstruct.mjs'
import {
  placeChordsByIndex as packChordsByIndex,
  collapseGluedSlashBassAnchors,
  resolveChordAnchorIndex,
  softFormatChordChart,
} from './chartLayout.mjs'

export const VISION_SECTION_TYPES = new Set(['verse', 'chorus', 'bridge', 'intro', 'outro', 'prechorus', 'unknown'])

/** Split only when a token is two valid chords glued together (GC, CC, AmG). Never invent. */
export function splitFusedChordToken(raw) {
  const text = normalizeChordGlyphs(raw)
  if (!text) return []
  if (isValidChordToken(text)) return [text]
  const spaced = text.split(/\s+/).filter(Boolean)
  if (spaced.length === 2 && spaced.every((part) => isValidChordToken(part))) return spaced
  const candidates = []
  for (let i = 1; i < text.length; i += 1) {
    const left = text.slice(0, i)
    const right = text.slice(i)
    if (isValidChordToken(left) && isValidChordToken(right)) candidates.push([left, right])
  }
  if (candidates.length === 1) return candidates[0]
  return []
}

/**
 * Hymnal pages often print verse 1 + verse 2, then one Refrain.
 * Musical form is verse 1 → refrain → verse 2 → refrain.
 * Do not copy refrain lyrics a second time; add a header-only repeat marker when two verses share one chorus.
 */
export function applySharedChorusOrder(sections) {
  if (!Array.isArray(sections) || sections.length < 3) {
    return { sections: sections || [], needsReview: false }
  }
  const chorusAt = sections.findIndex((section) => section.type === 'chorus')
  const chorusCount = sections.filter((section) => section.type === 'chorus').length
  if (chorusAt < 0 || chorusCount !== 1) return { sections, needsReview: false }
  const before = sections.slice(0, chorusAt)
  const after = sections.slice(chorusAt + 1)
  if (after.length || before.length < 2 || !before.every((section) => section.type === 'verse')) {
    return { sections, needsReview: false }
  }
  const chorus = sections[chorusAt]
  const ordered = [before[0], chorus, ...before.slice(1)]
  if (before.length === 2 && chorus.lines?.length) {
    ordered.push({ type: 'chorus', number: null, lines: [], repeat: true })
    return { sections: ordered, needsReview: false }
  }
  return { sections: ordered, needsReview: true }
}

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
      const used = new Set()
      for (const item of Array.isArray(line?.chords) ? line.chords : []) {
        const raw = item?.chord || item?.text || ''
        const parts = splitFusedChordToken(raw)
        if (!parts.length) {
          if (String(raw).trim()) uncertain = true
          continue
        }
        // Missing/invalid index must not become 0 (line start). Prefer a lyric
        // token / bbox mapping; omit the chord until the syllable is known.
        const resolved = resolveChordAnchorIndex(item, lyrics, { used })
        if (resolved == null) {
          uncertain = true
          continue
        }
        const base = Math.max(0, Math.min(lyrics.length, resolved))
        parts.forEach((chord, offset) => {
          const index = Math.min(lyrics.length, base + offset)
          chords.push({ chord, index })
          used.add(index)
        })
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
    if (!lines.length) {
      if (type === 'chorus' && (section?.repeat || section?.repeatAfterEachVerse)) {
        sections.push({ type: 'chorus', number: null, lines: [], repeat: true })
      }
      continue
    }
    sections.push({
      type: VISION_SECTION_TYPES.has(type) ? type : 'unknown',
      number: Number(section?.number) || null,
      lines,
    })
  }
  const ordered = applySharedChorusOrder(sections)
  if (ordered.needsReview) uncertain = true
  const confidence = clamp01(source.confidence)
  return {
    title: String(source.title || '').replace(/[ \t]+/g, ' ').trim(),
    key: String(source.key || '').trim(),
    sections: ordered.sections,
    confidence,
    needsReview: uncertain || confidence > 0 && confidence < 0.75 || !ordered.sections.length,
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
  return packChordsByIndex(lyrics, collapseGluedSlashBassAnchors(chords || []))
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
  return softFormatChordChart(cleanOcrText(text))
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
      const topRoot = normalizeChordGlyphs(top.text).split('/')[0]
      const bottomBass = normalizeChordGlyphs(bottom.text).split('/').pop()
      const slash = `${topRoot}/${bottomBass}`
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
    const parts = slash.split('/')
    if (parts.length !== 2) continue
    const [root, bass] = parts
    let applied = false
    for (const section of doc.sections) {
      if (applied) break
      for (const line of section.lines) {
        if (line.chords.some((item) => item.chord === slash)) {
          // Already a slash token — drop a leftover plain bass glued beside it.
          line.chords = collapseGluedSlashBassAnchors(line.chords)
          continue
        }
        const rootHits = line.chords
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.chord === root)
        const bassHits = line.chords
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.chord === bass)
        if (!rootHits.length || !bassHits.length) continue

        let best = null
        for (const rootHit of rootHits) {
          for (const bassHit of bassHits) {
            if (bassHit.index === rootHit.index) continue
            const dist = Math.abs((bassHit.item.index ?? 0) - (rootHit.item.index ?? 0))
            if (dist > 4) continue
            if (!best || dist < best.dist) best = { rootHit, bassHit, dist }
          }
        }
        if (!best) continue
        best.rootHit.item.chord = slash
        line.chords = line.chords.filter((_, index) => index !== best.bassHit.index)
        line.chords = collapseGluedSlashBassAnchors(line.chords)
        applied = true
        break
      }
    }
  }

  for (const section of doc.sections) {
    for (const line of section.lines) {
      line.chords = collapseGluedSlashBassAnchors(line.chords)
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
