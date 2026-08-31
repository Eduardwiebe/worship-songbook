import assert from 'node:assert/strict'
import { checkForUpdates, compareVersions } from '../app/src/updateCheck.js'

assert.equal(compareVersions('0.1.2', '0.1.1'), 1)
assert.equal(compareVersions('0.1.1', '0.1.1'), 0)
assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
assert.equal(compareVersions('v1.0.0', '0.9.9'), 1)

const upToDate = await checkForUpdates({
  currentVersion: '0.1.1',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.1.1', html_url: 'https://example.test/r' }),
  }),
})
assert.equal(upToDate.status, 'upToDate')

const available = await checkForUpdates({
  currentVersion: '0.1.1',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v0.1.2', name: '0.1.2', html_url: 'https://example.test/new' }),
  }),
})
assert.equal(available.status, 'updateAvailable')
assert.equal(available.latestVersion, '0.1.2')

const none = await checkForUpdates({
  currentVersion: '0.1.1',
  fetchImpl: async () => ({ ok: false, status: 404 }),
})
assert.equal(none.status, 'upToDate')

console.log('updateCheck tests: ok')
