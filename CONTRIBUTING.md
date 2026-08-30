# Contributing to Worship Songbook

Thanks for your interest in contributing.

## Ground rules

- The live web app at https://songbook.lyruma.app is the reference UX. Prefer small, focused changes over redesigns.
- Do not commit private or user data: databases, PDFs, uploads, `.env`, keys, backups, or session material.
- Keep the existing footer attribution: `Open Source · Entwickelt von Eduard Wiebe`.

## Development setup

1. Clone the repository.
2. Copy `.env.example` to `.env` only if you need local overrides (never commit `.env`).
3. Frontend:

```bash
cd app
npm install
npm run dev
```

4. Backend (from project root, with Node.js 20+):

```bash
node server.mjs
```

Exact process management may differ per host (systemd, reverse proxy, etc.).

5. Build the web frontend:

```bash
cd app
npm run build
```

## Native / Tauri

See `docs/NATIVE.md`. Do not add signing certificates or store secrets to the repository.

## Pull requests

- Describe the problem and the fix briefly.
- Note any API or auth impact.
- Confirm `npm run build` and `node --check server.mjs` succeed.
- Confirm no secrets or user data are included.

## License

By contributing, you agree that your contributions are licensed under the Apache License, Version 2.0.
