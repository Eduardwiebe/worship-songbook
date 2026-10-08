import { cacheGetMedia, pagesCacheKey, songRevision } from './offlineCache.js'

export function sheetCacheStatus(song, record) {
  if (!record?.pages?.length || record.pages.some((page) => !page?.buffer?.byteLength)) return 'missing'
  const revision = songRevision(song)
  if (revision && record.meta?.revision !== revision) return 'outdated'
  return 'available'
}

export function songIsRehearsed(song, briefing) {
  const revision = songRevision(song)
  return Boolean(revision && briefing?.rehearsedRevision === revision)
}

/** Keep missing library references visible instead of silently skipping them. */
export function evaluateSetReadiness(set, songs, team, offlineStatus = {}) {
  const songMap = new Map(songs.map((song) => [song.id, song]))
  const memberIds = new Set(team.map((member) => member.id))
  const entries = (set.songIds || []).map((id, index) => {
    const song = songMap.get(id)
    const issues = []
    if (!song) issues.push('missingSong')
    else if (!song.hasPdf) issues.push('missingSheet')
    else if (offlineStatus[id] !== 'available') issues.push(offlineStatus[id] === 'outdated' ? 'outdated' : 'notStored')
    const leaderId = set.leaders?.[id]
    if (!leaderId || (leaderId !== 'group' && !memberIds.has(leaderId))) issues.push('missingLead')
    return { id, index, song, issues }
  })
  const offlineCount = entries.filter((entry) => entry.song?.hasPdf && offlineStatus[entry.id] === 'available').length
  return { entries, offlineCount, sheetsReady: entries.length > 0 && offlineCount === entries.length }
}

export async function readSetOfflineStatus(set, songs) {
  const status = {}
  const wanted = new Set(set.songIds || [])
  // Sequential reads avoid holding all full-resolution sheets in memory.
  for (const song of songs) {
    if (wanted.has(song.id)) status[song.id] = sheetCacheStatus(song, await cacheGetMedia(pagesCacheKey(song.id)))
  }
  return status
}
