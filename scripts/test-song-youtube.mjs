#!/usr/bin/env node
import { buildYoutubeSearchQuery, resolveSongYoutubeAsset } from '../lib/songYoutube.mjs'

const q = buildYoutubeSearchQuery({ title: 'Wie schön dieser Name ist-chords-D', artist: 'PDF-Import' })
if (!/What A Beautiful Name/i.test(q)) {
  console.error('expected original English title in query, got:', q)
  process.exit(1)
}
if (!/Hillsong|official/i.test(q)) {
  console.error('expected worship hint in query, got:', q)
  process.exit(1)
}

const asset = await resolveSongYoutubeAsset({ title: 'Wie schön dieser Name ist', artist: 'PDF-Import' })
if (!asset.youtubeUrl || !asset.youtubeUrl.includes('youtube.com')) {
  console.error('missing youtube url', asset)
  process.exit(1)
}
if (!asset.searchQuery.includes('What A Beautiful Name')) {
  console.error('search query should prefer English original', asset.searchQuery)
  process.exit(1)
}
console.log('ok', { source: asset.youtubeSource, query: asset.searchQuery, url: asset.youtubeUrl.slice(0, 80) })
