#!/usr/bin/env node
/**
 * Assert song player UI is Original-only (no Akkorde / LeadSheet / Tonart ändern).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(join(root, 'app/src/App.jsx'), 'utf8')
const de = readFileSync(join(root, 'app/src/i18n/de.js'), 'utf8')
const server = readFileSync(join(root, 'server.mjs'), 'utf8')
const flag = readFileSync(join(root, 'lib/originalOnly.mjs'), 'utf8')

assert.match(flag, /ORIGINAL_ONLY_SONGBOOK = true/)
assert.match(app, /function SongViewer/)
assert.doesNotMatch(app, /function TransposeDialog/)
assert.doesNotMatch(app, /LeadSheetOsmd/)
assert.doesNotMatch(app, /setView\('chords'\)/)
assert.doesNotMatch(app, /setView\('leadsheet'\)/)
assert.doesNotMatch(app, /songs\.editKey/)
assert.doesNotMatch(app, /songs\.viewLeadsheet/)
assert.doesNotMatch(app, /songs\.changeKey/)
assert.doesNotMatch(app, /analyzeSongChords/)
assert.doesNotMatch(app, /saveSongVariant/)
assert.match(app, /straightenScanFile/)
assert.match(app, /LiveDocumentCamera/)
assert.match(app, /openEnvironmentCamera/)
assert.match(app, /scan\.straightened/)
assert.match(app, /songs\.originalPdf/)
assert.match(app, /songs\.youtubeRehearsal/)
assert.match(app, /songs\.tuner/)
assert.match(app, /songs\.autoScroll/)
assert.match(app, /songs\.cajon/)

assert.match(de, /Scannen und Original speichern/)
assert.match(de, /Begradigt/)
assert.match(de, /ruhig halten/)
assert.match(de, /Die blaue Fläche zeigt die erkannte Seite/)
assert.match(de, /Seite wird erkannt/)
assert.doesNotMatch(de, /Scannen und Lead-Sheet erstellen/)

assert.match(server, /ORIGINAL_ONLY_SONGBOOK/)
assert.match(server, /extractOriginalSheetMetadata/)
assert.match(server, /originalOnlyDisabledMessage/)
assert.match(server, /from '\.\/lib\/chartHtml\.mjs'/)
assert.match(server, /normalizeSheetColumns/)

console.log('ok: original-only UI and import gates')
