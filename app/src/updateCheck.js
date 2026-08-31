import { GITHUB_API_LATEST_RELEASE, APP_VERSION, URL_GITHUB_RELEASES } from './appMeta.js'

function parseVersion(raw) {
  const cleaned = String(raw || '').trim().replace(/^v/i, '')
  const parts = cleaned.split(/[.+-]/).map((p) => parseInt(p, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

export function compareVersions(a, b) {
  const aa = parseVersion(a)
  const bb = parseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (aa[i] > bb[i]) return 1
    if (aa[i] < bb[i]) return -1
  }
  return 0
}

/**
 * Phase-1 update check: read GitHub Releases metadata only.
 * Does not download or install. Safe without updater signatures.
 */
export async function checkForUpdates({ currentVersion = APP_VERSION, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(GITHUB_API_LATEST_RELEASE, {
    headers: { Accept: 'application/vnd.github+json' },
  })

  if (response.status === 404) {
    return {
      status: 'upToDate',
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: URL_GITHUB_RELEASES,
      note: 'no_releases',
    }
  }

  if (!response.ok) {
    const err = new Error(`Update check failed (${response.status})`)
    err.status = response.status
    throw err
  }

  const data = await response.json()
  const latestVersion = String(data.tag_name || data.name || '').replace(/^v/i, '')
  if (!latestVersion) {
    return {
      status: 'upToDate',
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: URL_GITHUB_RELEASES,
    }
  }

  const cmp = compareVersions(latestVersion, currentVersion)
  if (cmp > 0) {
    return {
      status: 'updateAvailable',
      currentVersion,
      latestVersion,
      releaseName: data.name || latestVersion,
      releaseUrl: data.html_url || URL_GITHUB_RELEASES,
      publishedAt: data.published_at || null,
    }
  }

  return {
    status: 'upToDate',
    currentVersion,
    latestVersion,
    releaseUrl: data.html_url || URL_GITHUB_RELEASES,
  }
}
