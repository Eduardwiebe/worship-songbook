import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isolatedTestTarget } from './lib/isolated-test-target.mjs'

const dir = mkdtempSync(join(tmpdir(), 'songbook-test-guard-'))
try {
  const dbPath = join(dir, 'copy.sqlite')
  writeFileSync(dbPath, 'untouched test fixture')
  const valid = { SONGBOOK_API: 'http://127.0.0.1:18795', SONGBOOK_DB: dbPath }
  assert.equal(isolatedTestTarget(valid).base, valid.SONGBOOK_API)
  assert.throws(() => isolatedTestTarget({}), /explicitly/)
  assert.throws(() => isolatedTestTarget({ SONGBOOK_API: valid.SONGBOOK_API }), /explicitly/)
  assert.throws(() => isolatedTestTarget({ ...valid, SONGBOOK_API: 'http://127.0.0.1:8791' }), /production port/)
  assert.throws(() => isolatedTestTarget({ ...valid, SONGBOOK_API: 'https://songbook.lyruma.de' }), /local test/)
  assert.throws(() => isolatedTestTarget({ ...valid, SONGBOOK_DB: '/var/www/songbook/data/songbook.sqlite' }), /isolated copy/)
  const link = join(dir, 'outside.sqlite')
  symlinkSync('/etc/hosts', link)
  assert.throws(() => isolatedTestTarget({ ...valid, SONGBOOK_DB: link }), /production symlinks/)
  const refused = spawnSync(process.execPath, ['scripts/test-native-auth.mjs'], {
    env: { ...process.env, SONGBOOK_API: '', SONGBOOK_DB: '' }, encoding: 'utf8',
  })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /Native auth test refused/)
  assert.equal(readFileSync(dbPath, 'utf8'), 'untouched test fixture')
  console.log('ok: native test target guard rejects defaults, production paths/port, external hosts and escaping symlinks')
} finally { rmSync(dir, { recursive: true, force: true }) }
