export function normalizeSetBriefings(value, songIds) {
  return Object.fromEntries(songIds.flatMap((id) => {
    const item = value?.[id]
    if (!item || typeof item !== 'object') return []
    return [[id, {
      cue: String(item.cue || '').slice(0, 800),
      rehearsedRevision: String(item.rehearsedRevision || '').slice(0, 400),
    }]]
  }))
}
