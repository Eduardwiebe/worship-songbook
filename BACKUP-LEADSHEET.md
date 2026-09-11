# Backup — pre leadsheet redesign (2026-09-11)

Freeze of Songbook Band UI ~**1.0.1.23** before clean lead-sheet redesign
(section headers, chord pills, Nur Text / lyrics-only, ChartSheet + chartHtml).

## Locations

| Kind | Path / ref |
|------|------------|
| Git branch | `backup/pre-leadsheet-redesign-20260911` |
| Git commit | `6db1becb955e3c32d41dea83b214171f00a0f6d1` |
| Tarball | `/Users/eduardwiebe/Backups/songbook-pre-leadsheet-redesign-20260911.tar.gz` |

Tarball includes: `app/src`, `app/public`, `app/package.json`, `lib`, `server.mjs`, `auth.mjs`, `CHANGELOG.md`, `index.html`, `README.md` (excludes `node_modules` / `target` / `dist` / `.git`).

## Restore

```bash
cd /Users/eduardwiebe/songbook
# Preferred: reset working tree to freeze commit (destructive to later local edits)
git checkout backup/pre-leadsheet-redesign-20260911
# Or restore files onto current branch without switching:
git checkout backup/pre-leadsheet-redesign-20260911 -- .
# From tarball:
mkdir -p /tmp/songbook-restore && tar -xzf /Users/eduardwiebe/Backups/songbook-pre-leadsheet-redesign-20260911.tar.gz -C /tmp/songbook-restore
```

Created: 2026-09-11 (Europe/Berlin).
