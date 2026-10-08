import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

const inside = (root, path) => {
  const part = relative(root, path)
  return part !== '' && part !== '..' && !part.startsWith('../') && !part.startsWith('..\\') && !isAbsolute(part)
}

export function isolatedTestTarget(env) {
  if (!env.SONGBOOK_API || !env.SONGBOOK_DB) throw new Error('Set SONGBOOK_API and SONGBOOK_DB explicitly for an isolated API and temporary database. Production defaults are disabled.')
  const url = new URL(env.SONGBOOK_API)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port || url.port === '8791' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SONGBOOK_API must be a local test HTTP API on an explicit port other than production port 8791.')
  }
  const tempRoot = realpathSync(tmpdir())
  const dbPath = resolve(env.SONGBOOK_DB)
  if (!inside(resolve(tmpdir()), dbPath) || !inside(tempRoot, realpathSync(dbPath))) throw new Error('SONGBOOK_DB must be an existing isolated copy inside the system temporary directory (no production symlinks).')
  return { base: url.origin, dbPath }
}
