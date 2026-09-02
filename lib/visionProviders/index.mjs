/**
 * Single-provider vision recognition. Swap recognizeMusicPage later without
 * changing the editor or analyze-chords route.
 */
import { recognizeMusicPage as recognizeOpenAiPage, openaiConfig } from './openai.mjs'

export function visionAvailable() {
  return Boolean(openaiConfig().apiKey)
}

export async function recognizeMusicPage(imagePath) {
  return recognizeOpenAiPage(imagePath)
}

export async function recognizeMusicPages(imagePaths) {
  const pages = []
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, elapsedMs: 0 }
  for (const imagePath of imagePaths) {
    const page = await recognizeMusicPage(imagePath)
    pages.push(page)
    const part = page.usage || {}
    usage.promptTokens += part.promptTokens || 0
    usage.completionTokens += part.completionTokens || 0
    usage.totalTokens += part.totalTokens || 0
    usage.costUsd += part.costUsd || 0
    usage.elapsedMs += part.elapsedMs || 0
  }
  if (pages.length === 1) return { ...pages[0], usage }
  return {
    title: pages.find((page) => page.title)?.title || '',
    key: pages.find((page) => page.key)?.key || '',
    sections: pages.flatMap((page) => page.sections),
    confidence: pages.reduce((sum, page) => sum + (page.confidence || 0), 0) / pages.length,
    needsReview: pages.some((page) => page.needsReview),
    model: pages[0]?.model,
    provider: pages[0]?.provider,
    usage,
  }
}
