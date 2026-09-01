# Changelog

All notable changes to Worship Songbook are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **iOS/iPad responsive layout** (`app/src/mobile-layout.css`): overflow clipping, safe-area padding for modals/drawer/bottom nav, 16px minimum input font-size (prevents iOS focus zoom), mobile editor/PDF heights.
- **Scan image prep** (`app/src/scanImagePrep.js`): upscale camera photos to ≥2000px width before upload.
- **Leadsheet quality gate** (`lib/leadsheetAnalysis.mjs`): shared chord/lyric scoring, OCR candidate selection, `needsReview` flag in analyze-chords API.
- Tests: `scripts/test-leadsheet-quality.mjs`, `scripts/test-mobile-layout.mjs`.

### Fixed

- **Horizontal overflow on iPhone/iPad**: root cause was missing tablet breakpoint padding (768–1024px still used desktop `.content` gutters), WebKit text-size-adjust, and modals/drawer wider than viewport; fixed via `mobile-layout.css` + `interactive-widget=resizes-content`.
- **Original PDF blank on iOS**: WKWebView failed to render PDF blob URLs in `<iframe>`; native iOS now uses `<embed type="application/pdf">` with forced `application/pdf` blob MIME (`AuthorizedMedia.jsx`, `apiConfig.js`).
- **Scan OCR quality**: iPhone JPEGs were often low-resolution; now upscaled client-side and server-side (`scan_to_pdf.py` min 2400px + sharpen). Server runs multi-PSM Tesseract at 400 DPI and picks best candidate; poor results surface `needsReview` warning in editor.

### Changed

- `scan_to_pdf.py`: min width 1800→2400px, sharpen/contrast pass, PDF optimize=false.
- `server.mjs`: unified `analyzeSongPdf()` with shared leadsheet analysis; force OCR path for `Gescannter Import` scans.

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
