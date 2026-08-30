# Worship Songbook

Worship Songbook is a web app for worship bands to plan sets, manage songs, team members, bands, and appointments.

**Live web version:** https://songbook.lyruma.app

**Original developer:** Eduard Wiebe

> Open Source · Entwickelt von Eduard Wiebe

## Screenshots

_Screenshots can be added later._

## Features

- Account login / registration with session authentication
- Guided onboarding wizard
- Song library (PDF import, scan import, transpose/chart views)
- Sets and set planning
- Bands, invites, and join requests
- Team members
- Appointments / schedule
- Profile and settings
- Responsive layout including mobile navigation

## Web version

The production deployment serves the built React app and proxies `/api` to the Node backend.

User-generated content (imported SongSelect/CCLI PDFs, scans, profile photos, band logos, SQLite data) is **not** included in this repository and must never be committed.

## Architecture

```
/var/www/songbook/          # project root (example path)
  app/                      # React + Vite frontend
    src/                    # UI and client stores
    src-tauri/              # Tauri 2 native shell (foundation)
    dist/                   # web build output (not committed)
  server.mjs                # HTTP API
  auth.mjs                  # auth / sessions
  data/                     # local SQLite + uploads (not committed)
```

API calls go through a central helper (`app/src/apiConfig.js`):

- **Web:** relative `/api/...` (same origin) with cookie sessions
- **Native (Tauri):** `VITE_API_BASE` or default `https://songbook.lyruma.app` with Bearer access tokens + OS keyring refresh storage

Details: [docs/NATIVE.md](docs/NATIVE.md).

## Developer installation

Requirements: Node.js 20+, npm. For native builds: Rust + Tauri 2 toolchain (see `docs/NATIVE.md`).

```bash
git clone <repository-url>
cd songbook
cd app && npm install
```

### Backend

```bash
# from project root
node --check server.mjs
node server.mjs
```

Configure reverse proxy / systemd for production. Default API listen is typically `127.0.0.1:8791` behind nginx.

### Frontend (dev)

```bash
cd app
npm run dev
```

### Frontend (production build)

```bash
cd app
npm run build
```

### Native (foundation only)

```bash
cd app
npm run tauri dev    # requires Rust + platform deps; not validated on this Linux host for Win/macOS/iOS
npm run tauri build
```

## Privacy

- Do not publish databases, session cookies, password hashes, certificates, or API tokens.
- Do not include SongSelect / CCLI / other licensed sheet music in the repo.
- See `.gitignore` and `docs/NATIVE.md` before any public push.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

See [NOTICE](NOTICE) for attribution.

Copyright 2026 Eduard Wiebe
