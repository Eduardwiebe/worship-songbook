#!/usr/bin/env node
/**
 * Lightweight audit for leftover German UI chrome outside i18n catalogs.
 * Allows: comments, hero content titles, invite-code placeholders, brand names.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../app/src/', import.meta.url).pathname
const allowFile = (p) => !p.includes('/i18n/') && !p.includes('.bak') && /\.(jsx?|mjs)$/.test(p)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (allowFile(p)) out.push(p)
  }
  return out
}

const umlaut = /[äöüÄÖÜß]/
const germanUi = /\b(Noch kein|Keine Songs|Bitte gib|Hinzufügen|anlegen|Speichern|Löschen|Abbrechen|Einrichtung|Bandprobe|Termin anlegen|Set anlegen|Plane dein|Persönliches Songbook|Mitglieder|Einladungscode|Willkommen zurück|Durchsuchen|wirklich endgültig)\b/

const hits = []
for (const file of walk(root)) {
  const lines = readFileSync(file, 'utf8').split(/\n/)
  lines.forEach((line, i) => {
    if (line.includes('t(') || line.includes('tStatic(')) return
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) return
    if (line.includes('console.')) return
    if (line.includes('Nichts unmöglich')) return // content slide title
    if (umlaut.test(line) || germanUi.test(line)) {
      hits.push(`${file}:${i + 1}:${line.trim().slice(0, 160)}`)
    }
  })
}

if (hits.length) {
  console.error('Possible leftover German UI strings:')
  hits.forEach((h) => console.error(h))
  process.exit(1)
}
console.log('hardcoded-DE audit: clean')
