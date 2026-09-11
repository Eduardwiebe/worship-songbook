# Changelog

## 1.0.1.10 — 2026-09-11

### Editor toolbar font controls
- Centered the Lucide `Type` icon between font-size − and + in `.font-tools` (equal gaps via `justify-self: center`).

## 1.0.1.9 — 2026-09-10

### Home song-tile carousel layout
- Redesigned **Songs direkt öffnen** tiles as contained cover cards (`overflow: hidden`) so metadata no longer bleeds between tiles.
- Single readable title in a bottom dark scrim — removed duplicate UI title / rank / PDF-Import / „Im Editor öffnen“ from the carousel.
- Small key badge (top-right letter only); play control bottom-left; subtle note icon.
- Fixed ~200px tile width for consistent horizontal scroll (iPad-friendly contrast on light and dark covers).
- Library list page unchanged.

## 1.0.1.8 — 2026-09-10

### YouTube rehearsal link
- Song editor: third header button **YouTube Probe** beside **Tonart bearbeiten** opens YouTube via `openExternal` for listening/rehearsal.
- On PDF/scan/text import, API resolves a YouTube link (baseline: search URL; improves query via DE→EN worship map + optional iTunes metadata; uses Data API video id when `YOUTUBE_API_KEY` is set).
- Stores `youtubeUrl` / `youtubeVideoId` / `youtubeSource` on songs; lazy `POST /api/songs/:id/resolve-youtube` for existing songs without a link (same pattern as covers).
- Prefer original-language worship recordings for German chart titles (e.g. *Wie schön dieser Name ist* → What A Beautiful Name / Hillsong search).

## 1.0.1.7 — 2026-09-10

### SongSelect key detection / transpose
- Trust explicit SongSelect headers (`Key - E`, `Key - C`, TONART) over diatonic chord-scale guesses when borrowed chords mislead scoring (Bb in C → F, bVII D in E → A).
- Verified snapshots now persist with `sourceKey` from the document header even when chord analysis disagrees — unlocks editable lead sheet + transpose.
- Soft-repair (`Erneut analysieren` / open editor) upgrades existing review_required snapshots that already have the header in stored text.
- Tests: Key - E / Key - C header parse + persist with verified snapshot despite chord conflict.
- Auto-repaired live songs: *Ich trau auf dich o Herr* (C), *Würdig und herrlich ist das Lamm* (E).

## 1.0.1.6 — 2026-09-10

### Editor toolbar readability (iPad)
- **Einfach/Voll** simplify toggle: wider control (no clipping), darker active blue for contrast in light + dark themes.
- Toolbar groups no longer shrink under labels — **Auto-Scroll** / **BPM / Cajón** / **Akkorde** / **Notenblatt** stop overlapping; wrap cleanly on iPad widths.
- Toolbar labels darkened (`#2a3540`, bold) for contrast on the light editor paper background.

## 1.0.1.5 — 2026-09-10

### Chords: German spelling + simplify
- Transpose output uses **German/European** roots: **H** (English B), **B** (Bb), Cis/Dis/Fis/Gis/As/Es.
- Key picker shows **B** for Bb and **H** for B; legacy stored key `B` maps to `H`.
- Display-layer **simplify** (default ON for DE): maj7/m7/7/add → triad/minor; slash bass dropped; sus kept. Toggle Einfach/Voll in editor toolbar. Original PDF + snapshot stay full fidelity (`data-full` on chart stacks).
- Fixed Asus/Esus parsing so `As`/`Es` roots do not swallow `sus`.
- Tests: D→E worship table (Anker-style) + German H/B + simplify round-trip from original snapshot.

## 1.0.1.4 — 2026-09-10

### Library covers & tiles
- Home **Songs direkt öffnen** tiles: title overlay at top, smaller note icon on the right, play control bottom-left, cover image background (gradient fallback).
- **/songs** library stays a searchable action list; rows show a small cover thumbnail when available.
- On PDF/scan/text import, the API resolves a cover (iTunes Search artwork cached under `data/covers/`, else procedural SVG from title/artist/key).
- Lazy one-shot backfill for existing songs without covers when the library loads.
- Song model exposes `hasCover` / `coverUrl`; `GET /api/songs/:id/cover`, `POST /api/songs/:id/resolve-cover`.

All notable changes to Worship Songbook are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **About dialog (dark):** "Webseiten" label contrast; musical-note logo instead of letter "L".
- **Update check:** prefer server `/version.json` manifest so older installs can discover **1.0.1.3** (GitHub Releases fallback kept).

### Changed

- App version bumped to **1.0.1.3** (`appMeta`, `package.json`, Tauri/`Cargo.toml`, public `version.json`).


### Added

- **iOS VisionKit document scanner** (`app/src-tauri/plugins/document-scanner`): native page detect/crop/perspective via `VNDocumentCameraViewController`; HTML camera remains fallback.
- **Audiveris OMR pipeline** (`omr_structured.py`): staff systems and chord names from `.omr`; RapidOCR only fills lyric text into those zones. VisionKit remains the iOS document scanner.
- **Original page images API** `GET /api/songs/:id/pages` for reliable iOS original view.
- **Central modal lock + viewport restore** (`modalLock.js`, `ModalBackdrop.jsx`) for iOS keyboard cycles.
- Docs: `docs/SCAN_OCR.md`. Tests: `scripts/test-leadsheet-reconstruct.mjs`, `scripts/benchmark-leadsheet-ocr.mjs`, `scripts/test-modal-lock.mjs`.

### Fixed

- **iOS original page only partially visible:** PDF embed/CSP/fixed height; now full-width page JPEGs + full-frame `scan_to_pdf.py` (no crop/over-sharpen).
- **iOS viewport corruption after modal + keyboard:** WKWebView stayed zoomed/shifted after closing Set/Band/Team dialogs. Causes: inherited `<16px` input font (auto-zoom), `autoFocus`, inconsistent scroll lock, modal `dvh` sizing. Fixed via central modal lifecycle, 16px form-control typography, viewport restore passes.
- **iPhone/iPad horizontal overflow (root cause):** `.song-tile-row` forced `minmax(420px)` carousel columns; app shell lacked `min-width: 0`; hero background used `transform: scale`. Prior `overflow-x: clip` masked symptoms — replaced with real layout containment in `mobile-layout.css`.
- **Original PDF blank on iOS**: WKWebView failed to render PDF blob URLs in `<iframe>`; native iOS now uses `<embed type="application/pdf">` with forced `application/pdf` blob MIME (`AuthorizedMedia.jsx`, `apiConfig.js`).
- **Scan OCR quality**: replaced flat Tesseract-only path for scans with structured RapidOCR reconstruction (legacy Tesseract kept as fallback).

### Changed

- `scan_to_pdf.py`: preserve full frame; lighter correction (removed aggressive sharpen chain).
- Analyze-chords returns engine/confidence metadata for scans.
- Tauri CSP: `object-src 'self' blob:` so PDF embed can load when needed.

- Tauri HTTP plugin (scoped to production API) and opener plugin for system-browser links.
- Authorized media helpers for native Bearer-protected images/PDFs.
- Docs: `docs/WINDOWS.md` (runner steps, smoke checklist, signing secrets).

### Native authentication

- Native authentication foundation: opaque access + refresh tokens alongside web cookie sessions.
- Endpoints: `/api/auth/native/login|refresh|logout|me`.
- Bearer acceptance on existing protected API routes; `X-Songbook-Band` for native band scope.
- Tauri OS keyring commands for refresh-token storage; frontend native session helpers.
- Automated script `scripts/test-native-auth.mjs`.

## [0.1.0] - 2026-08-30

### Added

- First stable web baseline of Worship Songbook.
- React/Vite frontend with login, wizard, bands, team, sets, appointments, songs, profile, and settings.
- Node.js API (`server.mjs`) with session authentication and SQLite storage.
- Central API configuration (`app/src/apiConfig.js`) for web and future native clients.
- Tauri 2 project foundation under `app/src-tauri/` (desktop/mobile scaffold; no store release yet).
- Apache License 2.0, NOTICE, CONTRIBUTING, and native/CI planning docs.

### Notes

- User content (songs, PDFs, profile photos, band logos, database) is **not** part of this repository.
- No public GitHub push is implied by this release tag; push requires an explicit operator approval after a privacy check.
