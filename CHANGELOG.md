# Changelog

## Static HTML — 2026-09-23

Displayed app version stays **1.1.4**. This note is static HTML and navigation only; `APP_VERSION` is unchanged. A deploy of the web build picks the tags up.

- **Social cards:** `twitter:image` matches `og:image` at `https://songbook.lyruma.de/brand-icon.png` on the app entry, install page, and legal pages. `twitter:card` stays `summary` because the icon is 256×256 (a large-image card wants a wide image).
- **Cross-links:** the page header and the login screen show Lyruma and Eduard Wiebe next to Install. The footer websites nav (Lyruma, Eduard Wiebe) and the footer Install link stay. The install page header and the Impressum, Datenschutz, and Nutzungsbedingungen footers link the same hosts.


## 1.1.4 — 2026-09-23

- **Public links use the current .de domains.** About “Webseiten” shows only https://lyruma.de and https://eduardwiebe.lyruma.de. Footer, login, the native Help menu, invite share links, and the native API base use those hosts or https://songbook.lyruma.de. The footer link to lyruma.app is gone.
- Displayed app version is **1.1.4** (`appMeta.js`, `package.json`, Tauri/`Cargo.toml`, public `version.json`, iOS bundle).


## 1.1.3 — 2026-09-22

- **Original sheet stays fitted and fixed** on iPhone, iPad, desktop, and the set stage. The scanned page is a page image scaled to the frame (`object-fit: contain`), centered, with pan, drag, and plugin scroll turned off. A single page stays fully visible. Multi-page songs scroll vertically one full page at a time.
- Cause: iPad and desktop embedded the PDF (`view=FitH`, `overflow: auto`, PDF plugin pointer events), so the sheet could be dragged inside the frame. iPhone already looked locked because the page image or the narrow fit filled the screen.
- YouTube Probe, Stimmgerät, and Original-only (no Akkorde / LeadSheet / Tonart ändern) are unchanged.


## 1.1.2 — 2026-09-22

- **Scan save 500:** srv1 `POST /api/scans` threw `ReferenceError: Cannot access 'pdf' before initialization` because `preferSongTitle` read `pdf` before `const pdf=form.get('pdf')`. That was the “Interner Serverfehler.” after **Begradigt**. Deskew and OpenCV were not the cause. `pdf` is declared before the title. `scripts/test-scan-save-guard.mjs` keeps that order.
- **Scan PDF interpreter:** After the `pdf` reorder, srv1 failed with `ModuleNotFoundError: No module named 'PIL'` because `scan_to_pdf.py` and the text-page renderer ran on `/usr/bin/python3`. Both now use `OCR_PYTHON` (`.venv-ocr`, which has Pillow). There is no fallback to system Python.
- **Live document camera:** “Seite scannen” / “Nächste Seite scannen” opens the camera with a live page outline (blue fill, shadow, and corners). When the sheet holds still it captures automatically; the shutter is always there. The next screen is the cropped, straightened page. Gallery, PDF, and text import are unchanged, and gallery photos are still deskewed after import. iOS VisionKit stays the native scanner. Original-only: no Akkorde, LeadSheet, or Tonart ändern.


## 1.1.1 — 2026-09-22

- **Document scan:** Camera and gallery photos of Original lead sheets are page-detected, perspective-deskewed, and cropped before they are stored (Adobe Scan style). The scan dialog shows “Seite wird erkannt” and then “Begradigt”, or “Ganzes Foto” when no reliable page edge is found.
- VisionKit pages and an already-straightened sheet stay full-frame so they are not cropped twice. Printed key/BPM extraction is unchanged. Akkorde, LeadSheet, and Tonart ändern stay out of Songbook Band.


## 1.1.0 — 2026-09-22

- **Release version for Original-only Songbook Band.** Round version **1.1.0** supersedes the draft numbering **1.0.1.27**. GitHub is the source of truth for this release.
- **Product decision unchanged:** Songbook Band shows the imported Original PDF/scan for practice. No player UI for **Tonart ändern**, **AKKORDE**, or **LEADSHEET** (chord/notation reconstruction belongs in lyruma.de).
- **Kept:** ORIGINAL view, YouTube Probe, Stimmgerät, Auto-Scroll, BPM/Cajón, library/sets/bands/PWA.
- Public release URL is **https://songbook.lyruma.de** (`app/public/version.json` `releaseUrl`).
- Native shell version (`tauri.conf.json`, `Cargo.toml`, iOS bundle) aligned to **1.1.0** so it tracks the web release.
- **Song list:** import `normalizeSheetColumns` (and chart HTML helper) from `lib/chartHtml.mjs`. `GET /api/songs` called it without an import, which would throw after a Git redeploy.


## 1.0.1.27 — 2026-09-22

- **Product pivot — Original-only digital songbook:** Songbook Band shows the imported Original PDF/scan for practice. Removed player UI for **Tonart ändern**, **AKKORDE**, and **LEADSHEET** (chord/notation reconstruction belongs in lyruma.de).
- **Kept:** ORIGINAL view, YouTube Probe, Stimmgerät, Auto-Scroll, BPM/Cajón, library/sets/bands/PWA.
- **Import:** PDF + images/scans are deskewed/stored as Original. Key and BPM are filled only when printed on the sheet; otherwise blank. No chord/ChordPro/LeadSheet rebuild for Songbook Band.
- Flag: `ORIGINAL_ONLY_SONGBOOK` in `lib/originalOnly.mjs`. Analyze-chords / MusicXML / variant / chart APIs return 410.


## 1.0.1.26 — 2026-09-18

- **Chord view vs LeadSheet:** two reconstructions. Akkorde shows readable German words (syllables rehydrated from native PDF words/boxes/baselines); LeadSheet is MusicXML + OpenSheetMusicDisplay (chords above staff, melody, syllabic lyrics under notes) — never faked from chord-view text.
- Filter SongSelect/CCLI/©/author/website/page-number lines out of lyrics into metadata fields.
- Titles prefer native PDF text and drop `-lead-G` / `-lead-Bb` filename suffixes.
- BPM: hide unless a document tempo exists (no default 120).
- Editor tabs labeled ORIGINAL / AKKORDE / LEADSHEET.


## 1.0.1.24 — 2026-09-11

- **Lead sheet redesign (editor + Set play):** Uniform section headers like `[Refrain]` / `[Strophe 1]` / `[Bridge]`; subtle chord pills with stable syllable alignment; single chart header (title + Tonart + optional BPM) without duplicate Tonart meta lines.
- Keep **Einfach / Voll** chord simplify toggle; add **Nur Text / Lyrics** view toggle (same source data) in the song editor and Set play toolbar.
- Generous section spacing and stage-readable fonts; `lib/chartHtml.mjs` mirrors ChartSheet so Set starten matches the editor.


## 1.0.1.23 — 2026-09-11

- **Guitar tuner:** Song editor view-switch row adds **Stimmgerät / Tuner** next to YouTube Probe.
- Opens a modal that uses `getUserMedia` + autocorrelation pitch detection (A4=440): nearest note, cents sharp/flat, needle meter, and standard guitar string references (E2–E4).
- German/English i18n; graceful mic permission denial; stops mic tracks when the modal closes (iPad Safari/PWA + desktop).

## 1.0.1.22 — 2026-09-11

- **Set play iPad blank charts:** Root cause — on iOS native, `AuthorizedFrame` routed HTML lead sheets (`/api/songs/:id/chart`) through `PdfNativeViewer`, which always used `<embed type="application/pdf">`. HTML blob/src content rendered blank.
- **Fix:** Edited charts (`fitContent`) always fetch chart HTML (with offline cache) and render via `<iframe srcDoc>` on native + Safari/web. PDF embed remains only for real PDFs; Set play originals on iOS prefer page images.
- No server API change required for the shell fix; web deploy picks up the React bundle.


## 1.0.1.21 — 2026-09-11

- **Cajón sample:** Replaced the synthetic/generated `cajon-hit.mp3` with a real acoustic cajón bass (tono) hit — warm, wooden, low-body — trimmed to ~0.6s and normalized loud for phone speakers.
- **Source:** [cajonbass.wav by bikesnbassboi on Freesound](https://freesound.org/people/bikesnbassboi/sounds/517523/) — **Creative Commons 0 (CC0 1.0)** (`https://creativecommons.org/publicdomain/zero/1.0/`). HQ preview downloaded, mono-converted, warm EQ (bass shelf), fade, peak near 0 dBFS; exported as `app/public/cajon-hit.mp3`.
- Playback code unchanged (keeps 1.0.1.20 iOS tap-unlock / HTMLAudioElement fallback).

## 1.0.1.20 — 2026-09-11

- **iOS Cajón audio:** Play-button click now awaits unlock + sample preload, plays the first hit immediately in that gesture (does not wait for the BPM interval), and uses HTMLAudioElement.play() as a Safari/PWA fallback when the Web Audio buffer is not ready.
- Regenerated a louder 0.42s cajón thump (cajon-hit.mp3, peak near 0 dBFS) so phone speakers can hear it.

## 1.0.1.19 — 2026-09-11

- **Cajón sample playback:** Replaced the quiet Web Audio noise/pulse synth with a soft self-generated acoustic-like cajón hit sample (`app/public/cajon-hit.mp3`), shared by Set play and the song editor.
- Preloads an `AudioBuffer`, unlocks `AudioContext` on the play-button gesture, and strikes on BPM (stronger/warmer on downbeats). Volume tuned to be clearly audible on phone speakers without being harsh.


## 1.0.1.18 — 2026-09-11

- **Set play safe-area toolbar:** RunSet header/footer now pad with `env(safe-area-inset-*)` (+ breathing room) so Auto-Scroll and BPM/Cajón sit below the iPhone status bar / notch and stay tappable (portrait, landscape, iPad, desktop).
- Set title meta truncates instead of crushing the toolbar; Zurück/Weiter and stage arrows respect left/right/bottom insets.
- **Lead sheet:** drop redundant `TONART:` / `KEY:` meta lines in chart HTML when the Tonart header is already shown (fixes double Tonart under the title).


## 1.0.1.17 — 2026-09-11

- **Set play Autoscroll + Cajón:** Set starten / stage toolbar now has Auto-Scroll and BPM / Cajón (same soft pulse as the song editor). BPM loads from the current song lead sheet (or song metadata) and updates when switching songs.
- Controls are session-local (stay on while navigating the set); mobile/iPad friendly layout in the run-mode header.


## 1.0.1.16 — 2026-09-11

- **Band invitation codes:** Creating an invite now shows the code under „Aktive Einladungscodes“ (root cause: POST response omitted `active`, so the UI filter hid new codes).
- Shareable link `https://songbook.lyruma.app/join?code=XXXX` routes via `/install/?join=` when the PWA is not installed, then into `/#/bands?code=` after install / in standalone.
- Copy code / copy link actions; German UI copy; install page explains invite-then-join.


## 1.0.1.15 — 2026-09-11

- **PWA for band distribution:** `manifest.webmanifest`, service worker (app shell via vite-plugin-pwa; `/api` network-only), and install page at `/install.html` (DE primary, EN toggle). Chromium `beforeinstallprompt`, iOS Safari Home-Screen steps, desktop browser guidance.
- Links to install from About, Settings, and footer. Does not replace Tauri native builds.
- Branding icons for PWA (192/512 + maskable) from Songbook Band mark.

## 1.0.1.14 — 2026-09-11

- **Offline-first Set play / library:** IndexedDB cache for songs, sets, team, appointments, bands, and lead-sheet HTML/PDFs. After opening a set once online, Set start and library work without network. Offline banner; sync resumes when connectivity returns.
- Native auth falls back to the last cached user session when the API is unreachable.


## 1.0.1.13 — 2026-09-11

- **Set play two-column lead sheets:** Editor column preference (`Spalten` 1/2) is now stored on the song (`sheet_columns`) and applied by `/api/songs/:id/chart`, so Set start shows the same Doppelspalten overview as the editor. Toggle persists immediately; Save also writes layout.
- Chart HTML uses structured chord/lyric pairs with CSS columns (same break-inside rules as the editor) instead of a single-column `<pre>`.


## 1.0.1.12 — 2026-09-11

### Set playback lead sheet layout
- Fixed clipped edited charts in set run mode: stage fills the viewport between header/footer; long lead sheets scroll vertically inside `.pdf-stage-scroll`.
- Cause: `.run-mode main` flex centering + `.pdf-stage { overflow: hidden }` + iframe `pointer-events: none` left a dark empty band and blocked chart scroll.
- Edited HTML charts size to content (`fitContent`) so the stage scrolls while song swipe still works; original PDF iframes fill the stage and scroll internally (edge swipe strips + arrows preserved).

## 1.0.1.11 — 2026-09-11

### Technik-Briefing contrast
- **Technik auswählen** dropdown: option/selected names use dark text on light option backgrounds so technician names (e.g. Fabian Hinn) stay readable without hover in light and dark themes.
- Closed control keeps light text on the dark field shell; `color-scheme: dark` aligns native popup styling.

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
