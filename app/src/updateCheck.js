import {
  GITHUB_API_LATEST_RELEASE,
  APP_VERSION,
  URL_GITHUB_RELEASES,
  URL_APP,
  VERSION_MANIFEST_PATH,
} from './appMeta.js'

function parseVersion(raw) {
  const cleaned = String(raw || '').trim().replace(/^v/i, '')
  const parts = cleaned.split(/[.+-]/).filter(Boolean).map((p) => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  return parts.length ? parts : [0]
}

export function compareVersions(a, b) {
  const aa = parseVersion(a)
  const bb = parseVersion(b)
  const len = Math.max(aa.length, bb.length)
  for (let i = 0; i < len; i += 1) {
    const x = aa[i] || 0
    const y = bb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

function resolveManifestUrl(explicitUrl) {
  if (explicitUrl) return explicitUrl
  if (typeof window !== 'undefined' && window.location?.origin) {
    // Same-origin for web; native WebViews may load remote content from URL_APP
    try {
      const origin = window.location.origin
      if (origin && !origin.startsWith('tauri://') && origin !== 'null' && !origin.startsWith('asset://')) {
        return `${origin}${VERSION_MANIFEST_PATH}`
      }
    } catch { /* ignore */ }
  }
  return `${URL_APP}${VERSION_MANIFEST_PATH}`
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function resultFromManifest(data, currentVersion) {
  const latestVersion = String(data?.version || data?.latestVersion || '').replace(/^v/i, '')
  if (!latestVersion) return null
  const releaseUrl = data.releaseUrl || data.html_url || URL_APP || URL_GITHUB_RELEASES
  const canReload = Boolean(data.canReload ?? (data.channel === 'web'))
  const cmp = compareVersions(latestVersion, currentVersion)
  if (cmp > 0) {
    return {
      status: 'updateAvailable',
      currentVersion,
      latestVersion,
      releaseName: data.name || latestVersion,
      releaseUrl,
      publishedAt: data.releasedAt || data.publishedAt || null,
      channel: data.channel || 'server',
      canReload,
      notes: data.notes || null,
      source: 'version.json',
    }
  }
  return {
    status: 'upToDate',
    currentVersion,
    latestVersion,
    releaseUrl,
    channel: data.channel || 'server',
    source: 'version.json',
  }
}

async function checkServerManifest({ currentVersion, fetchImpl, manifestUrl }) {
  const url = resolveManifestUrl(manifestUrl)
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    const err = new Error(`Version manifest failed (${response.status})`)
    err.status = response.status
    throw err
  }
  const data = await readJson(response)
  const result = resultFromManifest(data, currentVersion)
  if (!result) {
    const err = new Error('Version manifest missing version field')
    err.status = 502
    throw err
  }
  return result
}

async function checkGitHubReleases({ currentVersion, fetchImpl }) {
  const response = await fetchImpl(GITHUB_API_LATEST_RELEASE, {
    headers: { Accept: 'application/vnd.github+json' },
  })

  // No published releases must NOT be treated as "up to date" — that hid
  // newer web/version.json when the primary manifest fetch failed on native.
  if (response.status === 404) {
    const err = new Error('No GitHub releases published')
    err.status = 404
    err.note = 'no_releases'
    throw err
  }

  if (!response.ok) {
    const err = new Error(`Update check failed (${response.status})`)
    err.status = response.status
    throw err
  }

  const data = await response.json()
  const latestVersion = String(data.tag_name || data.name || '').replace(/^v/i, '')
  if (!latestVersion) {
    const err = new Error('GitHub latest release missing version tag')
    err.status = 502
    throw err
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
      canReload: false,
      source: 'github',
    }
  }

  return {
    status: 'upToDate',
    currentVersion,
    latestVersion,
    releaseUrl: data.html_url || URL_GITHUB_RELEASES,
    source: 'github',
  }
}

/**
 * Update check (phase 1): read published version metadata only.
 * Prefers the server static manifest at /version.json (works for web + native).
 * Falls back to GitHub Releases when the manifest is unavailable.
 * Does not download or install binaries.
 *
 * On iOS / Android: returns status `storeManaged` — store / TestFlight owns updates.
 *
 * Uses transportFetch by default so Tauri/desktop can reach version.json via
 * plugin-http (WebView fetch alone often fails CORS / scheme limits).
 */
async function resolveFetchImpl(fetchImpl) {
  if (fetchImpl) return fetchImpl
  try {
    const { transportFetch } = await import('./apiConfig.js')
    return transportFetch
  } catch {
    return fetch
  }
}

export async function checkForUpdates({
  currentVersion = APP_VERSION,
  fetchImpl,
  platform = 'desktop',
  manifestUrl,
} = {}) {
  if (platform === 'ios' || platform === 'android' || platform === 'mobile') {
    return {
      status: 'storeManaged',
      currentVersion,
      latestVersion: currentVersion,
      releaseUrl: URL_GITHUB_RELEASES,
      note: 'store_managed',
    }
  }

  const doFetch = await resolveFetchImpl(fetchImpl)

  try {
    return await checkServerManifest({ currentVersion, fetchImpl: doFetch, manifestUrl })
  } catch (manifestError) {
    try {
      return await checkGitHubReleases({ currentVersion, fetchImpl: doFetch })
    } catch (githubError) {
      const err = new Error(manifestError?.message || githubError?.message || 'Update check failed')
      err.status = manifestError?.status || githubError?.status
      err.cause = { manifestError, githubError }
      throw err
    }
  }
}
