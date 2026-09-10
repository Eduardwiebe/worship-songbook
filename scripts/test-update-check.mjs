import assert from 'node:assert/strict'
import { checkForUpdates, compareVersions } from '../app/src/updateCheck.js'

assert.equal(compareVersions('0.1.2', '0.1.1'), 1)
assert.equal(compareVersions('0.1.1', '0.1.1'), 0)
assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
assert.equal(compareVersions('v1.0.0', '0.9.9'), 1)
assert.equal(compareVersions('1.0.1.3', '1.0.1.2'), 1)
assert.equal(compareVersions('1.0.1.3', '0.1.2'), 1)
assert.equal(compareVersions('1.0.1.3', '1.0.1.3'), 0)

const upToDate = await checkForUpdates({
  currentVersion: '1.0.1.3',
  fetchImpl: async (url) => {
    if (String(url).includes('version.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: '1.0.1.3', releaseUrl: 'https://songbook.lyruma.app', channel: 'web', canReload: true }),
      }
    }
    throw new Error(`unexpected url ${url}`)
  },
})
assert.equal(upToDate.status, 'upToDate')
assert.equal(upToDate.source, 'version.json')

const available = await checkForUpdates({
  currentVersion: '0.1.2',
  fetchImpl: async (url) => {
    if (String(url).includes('version.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: '1.0.1.3', name: 'Lyruma Songbook', releaseUrl: 'https://songbook.lyruma.app', channel: 'web', canReload: true }),
      }
    }
    throw new Error(`unexpected url ${url}`)
  },
})
assert.equal(available.status, 'updateAvailable')
assert.equal(available.latestVersion, '1.0.1.3')
assert.equal(available.canReload, true)

const githubFallback = await checkForUpdates({
  currentVersion: '0.1.1',
  fetchImpl: async (url) => {
    if (String(url).includes('version.json')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.1.2', name: '0.1.2', html_url: 'https://example.test/new' }),
    }
  },
})
assert.equal(githubFallback.status, 'updateAvailable')
assert.equal(githubFallback.latestVersion, '0.1.2')
assert.equal(githubFallback.source, 'github')

const none = await checkForUpdates({
  currentVersion: '0.1.1',
  fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
})
assert.equal(none.status, 'upToDate')
assert.equal(none.note, 'no_releases')

const ios = await checkForUpdates({
  currentVersion: '1.0.1.3',
  platform: 'ios',
  fetchImpl: async () => {
    throw new Error('should not fetch on ios')
  },
})
assert.equal(ios.status, 'storeManaged')
assert.equal(ios.currentVersion, '1.0.1.3')

console.log('updateCheck tests: ok')
