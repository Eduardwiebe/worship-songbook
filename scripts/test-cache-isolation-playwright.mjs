import assert from 'node:assert/strict'
import { createServer } from '../app/node_modules/vite/dist/node/index.js'
import { chromium } from '../app/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'

const server = await createServer({ root: fileURLToPath(new URL('../app', import.meta.url)), server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  // Load just the real modules, without starting React or background requests.
  await page.route('**/__cache_test__', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Cache isolation</title>' }))
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  await page.goto(origin + '/__cache_test__')
  await page.evaluate(async () => {
    const runtime = (await import('/@react-refresh')).default
    runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => (type) => type
    window.__vite_plugin_react_preamble_installed__ = true
  })
  let userId = 'user-a'
  let bandId = 'band-a'
  let status = 200
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data = []
    if (/auth\/(me|login)/.test(path)) data = { user: { id: userId } }
    else if (path === '/api/bands') data = [{ id: bandId, active: true }]
    else if (path.endsWith('/select')) data = { ok: true }
    else if (path === '/api/auth/logout') data = { ok: true }
    else data = [{ id: `${userId}:${bandId}`, title: 'Private' }]
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  })
  await page.evaluate(async () => {
    window.cache = await import('/src/offlineCache.js')
    window.auth = await import('/src/authStore.js')
    window.bands = await import('/src/bandStore.js')
    window.sets = await import('/src/setStore.js')
    window.songs = await import('/src/songStore.js')
    window.team = await import('/src/teamStore.js')
    window.schedule = await import('/src/scheduleStore.js')
    window.api = await import('/src/apiConfig.js')
    await auth.getCurrentUser()
    await bands.getBands()
    await Promise.all([sets.getSets(), songs.getImportedSongs(), team.getTeam(), schedule.getAppointments()])
    await cache.cachePagesPayload('shared-id', [{ dataUrl: 'data:image/png;base64,AQ==' }])
  })
  const cached = () => page.evaluate(async () => ({ list: await cache.cacheGetList(cache.listCacheKey('sets')), media: Boolean(await cache.cacheGetMedia(cache.pagesCacheKey('shared-id'))) }))
  assert.equal((await cached()).list[0].id, 'user-a:band-a')
  assert.equal((await cached()).media, true)
  status = 403
  const forbidden = await page.evaluate(async () => {
    const reads = [sets.getSets, songs.getImportedSongs, team.getTeam, schedule.getAppointments, bands.getBands]
    return Promise.all(reads.map(async (read) => { try { await read(); return 'cached' } catch { return 'rejected' } }))
  })
  assert.deepEqual(forbidden, Array(5).fill('rejected'), '403 must never be hidden by cached data')
  status = 500
  assert.equal(await page.evaluate(async () => { try { await sets.getSets(); return false } catch { return true } }), true)
  status = 200
  bandId = 'band-b'
  await page.evaluate(async () => { await bands.selectBand('band-b') })
  assert.equal((await cached()).list, undefined)
  assert.equal((await cached()).media, false)
  await page.evaluate(async () => { await sets.getSets(); await cache.cachePagesPayload('shared-id', [{ dataUrl: 'data:image/png;base64,Ag==' }]) })
  userId = 'user-b'
  await page.evaluate(async () => { await auth.login({}); await bands.getBands() })
  assert.equal((await cached()).list, undefined)
  assert.equal((await cached()).media, false)
  await page.evaluate(async () => { await sets.getSets() })
  await page.route('**/api/sets', (route) => route.abort('internetdisconnected'))
  assert.equal(await page.evaluate(async () => (await sets.getSets())[0].id), 'user-b:band-b')
  await page.unroute('**/api/sets')
  // A request started under A must not expose its response after a switch to B.
  let release
  const delayed = new Promise((resolve) => { release = resolve })
  let started
  const start = new Promise((resolve) => { started = resolve })
  await page.route('**/api/sets', async (route) => { started(); await delayed; await route.fulfill({ contentType: 'application/json', body: '[{"id":"old-response"}]' }) })
  const stale = page.evaluate(async () => { try { await sets.getSets(); return 'accepted' } catch { return 'rejected' } })
  await start
  await page.evaluate(() => cache.setCacheBand('band-c'))
  release()
  assert.equal(await stale, 'rejected')
  await page.unroute('**/api/sets')
  // Queue starts under one account, but logout happens while the body downloads.
  const prefetch = await page.evaluate(async () => {
    let release
    const wait = new Promise((resolve) => { release = resolve })
    const job = cache.prefetchSongOriginals([{ id: 'late', hasPdf: true }], { apiFetch: async () => ({ ok: true, json: async () => { await wait; return { pages: [{ dataUrl: 'data:image/png;base64,AQ==' }] } } }) })
    await new Promise((resolve) => setTimeout(resolve, 30))
    cache.setCacheIdentity('user-c')
    release()
    const result = await job
    return { cancelled: result.cancelled, leaked: Boolean(await cache.cacheGetMedia(cache.pagesCacheKey('late'))) }
  })
  assert.deepEqual(prefetch, { cancelled: true, leaked: false })
  const otherTab = await page.context().newPage()
  await otherTab.route('**/__cache_test__', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Other tab</title>' }))
  await otherTab.goto(origin + '/__cache_test__')
  await otherTab.evaluate(async () => {
    window.cache = await import('/src/offlineCache.js')
    cache.setCacheIdentity('user-c')
    window.sessionReset = false
    window.addEventListener('songbook-session-changed', () => { window.sessionReset = true })
    window.pendingDownload = cache.prefetchSongOriginals([{ id: 'other-tab-late', hasPdf: true }], { apiFetch: async () => ({ ok: true, json: async () => {
      await new Promise((resolve) => { window.releaseDownload = resolve })
      return { pages: [{ dataUrl: 'data:image/png;base64,AQ==' }] }
    } }) })
  })
  await otherTab.waitForFunction(() => Boolean(window.releaseDownload))
  await page.evaluate(async () => { await auth.logout() })
  await otherTab.waitForFunction(() => window.sessionReset)
  assert.equal(await otherTab.evaluate(() => cache.getCacheUser()), '')
  const otherResult = await otherTab.evaluate(async () => { releaseDownload(); const result = await pendingDownload; return { cancelled: result.cancelled, leaked: Boolean(await cache.cacheGetMedia(cache.pagesCacheKey('other-tab-late'))) } })
  assert.deepEqual(otherResult, { cancelled: true, leaked: false })
  await otherTab.close()
  assert.equal(await page.evaluate(async () => Boolean(await cache.cacheGetMeta('user'))), false)
  await page.route('**/api/auth/me', (route) => route.abort('internetdisconnected'))
  assert.equal(await page.evaluate(async () => { try { await auth.getCurrentUser(); return 'authenticated' } catch { return 'signed-out' } }), 'signed-out')
  console.log('ok: real browser IndexedDB, user/band/media isolation, 403/500, network fallback, stale responses, delayed prefetch, cross-tab invalidation and web logout')
} finally {
  await browser.close()
  await server.close()
}
