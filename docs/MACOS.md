# macOS native build

Target: **macOS** (GitHub Actions `macos-latest`)  
Shell: Tauri 2 (`app/src-tauri/`)  
Product: Worship Songbook `0.1.0`  
Identifier: `studio.lyruma.worshipsongbook`  
Author: Eduard Wiebe

The git tag `v0.1.0` remains the **web baseline**. macOS work lives in later commits on `main`.

---

## DEVELOPMENT / UNSIGNED TEST BUILD

**This macOS build is a development / smoke-test build.**

| Rule | Detail |
|------|--------|
| Audience | Internal development and manual smoke-test only |
| Public distribution | **Not** intended — do not ship this build to end users |
| Bundle signing in CI | **Ad-hoc** only (`bundle.macOS.signingIdentity: "-"`) — seals `_CodeSignature` / resources |
| Developer ID / notarization | **Not** enabled |
| Gatekeeper | After ad-hoc seal, expect “unidentified developer” / Open Anyway — **not** “beschädigt”, if quarantine is set |
| Self-signed CA certs | **Not** a public trust / distribution solution |
| Validation | Do **not** claim “macOS validated” until a human smoke-test on a real Mac passes |

**Do not** automate Gatekeeper disablement, SIP changes, or `xattr -d com.apple.quarantine` as a product fix.

### “ist beschädigt” diagnosis (2026-08-31)

| Check | Result on CI |
|-------|----------------|
| Local GitHub Artifact vs Smoke-Kopie DMG | Byte-identical (SHA256 matched for run `33370068659`) |
| `hdiutil verify` | **Pass** — DMG not corrupted |
| Bundle completeness | Complete (Info.plist, MacOS binary +x, icon.icns) |
| Architecture | **arm64 only** |
| Without `signingIdentity` | Mach-O only `adhoc,linker-signed`; `codesign --verify --deep --strict` → **fail** (`code has no resources but signature indicates they must be present`) |
| Effect | Gatekeeper shows misleading **“beschädigt”** on Apple Silicon for that incomplete signature |

**Fix applied:** set `signingIdentity` to `-` so Tauri runs full ad-hoc `codesign` on the `.app` (and DMG contents). CI now **fails the job** if `codesign --verify` still fails.

Ad-hoc ≠ public distribution. Public opens still need Apple Developer ID + notarization (separate decision).

---

## What this prepares

- GitHub Actions workflow: `.github/workflows/macos-native.yml`
- Bundles: **`.app`** and **`.dmg`** (unsigned)
- Same native API base as Windows: `https://songbook.lyruma.app` (`app/src/apiConfig.js`)
- Native auth: Bearer access + refresh via OS keyring (`keyring` crate with `apple-native` → **macOS Keychain**)
- Native HTTP: `@tauri-apps/plugin-http` (scoped to production host)
- External links: `@tauri-apps/plugin-opener` (system browser)
- Protected media: authenticated blob URLs (`AuthorizedImg` / `AuthorizedFrame`)

## Architecture honesty

`macos-latest` on GitHub Actions is currently an **Apple Silicon** runner in typical configurations.

| Claim | Status |
|-------|--------|
| Built on real macOS Actions runner | Yes (when workflow succeeds) |
| Architecture | Document the **actual** arch from the run logs (`uname -m`, `lipo -info`) — usually **arm64 / aarch64** |
| Universal Binary (`arm64` + `x86_64`) | **Not** built by default (extra time/complexity) |
| “Runs on all Macs” | **Do not** claim this unless a universal (or separate Intel) artifact exists |

If only arm64 is produced: it targets Apple Silicon Macs. Intel Macs need a separate `x86_64` or universal build later.

## How to run the macOS build

1. Push `main` to GitHub (**requires explicit operator approval**).
2. Actions → **macOS Native** → **Run workflow**.
3. Download artifact `Worship-Songbook-macOS`.

Or after tagging: `macos-v0.1.0-preview` (does not move `v0.1.0`).

Local (on a Mac with Xcode CLT + Rust):

```bash
cd app
npm ci
npm run tauri build -- --bundles app,dmg
```

## Native auth & Keychain

Same stack as Windows:

| Piece | Behavior |
|-------|----------|
| Login | `POST /api/auth/native/login` → access + refresh |
| Access token | Memory only |
| Refresh token | `secure_set` / `secure_get` / `secure_delete` → macOS Keychain via `keyring` (`apple-native`) |
| Session restore | App restart loads refresh from Keychain, refreshes access |
| Logout | Server revoke + Keychain delete |
| Bad refresh | Clear session, return to login (no retry loop) |

**Not device-verified** until a human smoke-tests on a real Mac. Keychain prompts (if any) are OS-controlled.

Web cookie auth (`SameSite=Strict`, CSRF Origin check) stays unchanged.

## Auth lifecycle to verify on a real Mac

| Case | Expected |
|------|----------|
| A Login | Native login → Home |
| B Restart | Refresh from Keychain restores session |
| C Access expiry | Silent refresh, API keeps working |
| D Logout | Refresh revoked, Keychain cleared, login required |
| E Bad refresh | Return to login, no retry loop |

## Smoke checklist (manual on macOS)

1. App öffnen (`.app` or mount `.dmg`)
2. Login
3. Session Restore (App schließen → erneut öffnen)
4. Logout
5. Home
6. Bands
7. Team
8. Sets
9. Termine
10. Songs
11. Einstellungen
12. Profil
13. Wizard (nur wenn ausgelöst)
14. PDF/File Picker
15. Externe Links (Systembrowser)

Optional: Fenster 1440×900 / 1280×800 / 1024×768; Keychain; geschützte PDFs/Bilder.

## File / PDF

Reuse existing browser File API / `<input type="file">` in the Tauri WKWebView. No second import pipeline for this mission.

## Window sizes

Default window in `tauri.conf.json`: 1280×800, min 1024×700. Responsive layout is the existing web CSS — do not rebuild for macOS alone.

## Security (minimal)

- CSP and capabilities as in Windows prep (`http` only to `https://songbook.lyruma.app/**`)
- Opener limited to known public https hosts
- No broad filesystem ACL, no shell rights
- Signing / notarization secrets never in git

## App metadata

| Field | Value |
|-------|-------|
| Product Name | Worship Songbook |
| Version | 0.1.0 |
| Author | Eduard Wiebe |
| Copyright | Copyright 2026 Eduard Wiebe |
| Identifier | `studio.lyruma.worshipsongbook` |
| Icons | `app/src-tauri/icons/` (incl. `icon.icns`) |

## Signing / notarization (later — not done here)

For **public** distribution Apple typically requires:

1. Apple Developer Program membership (paid)
2. **Developer ID Application** certificate (outside App Store) — or App Store distribution certs
3. Codesign the `.app` / `.dmg`
4. **Notarization** via Apple (stapler)
5. Optionally App Store Connect for Mac App Store

Document only — **do not** put Apple ID, app-specific passwords, or certificates in the repo or this mission’s CI.

GitHub Secrets examples for a later mission (never commit values):

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` / related P12 material | Developer ID Application |
| `APPLE_CERTIFICATE_PASSWORD` | Cert password |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | Notarization |
| `APPLE_TEAM_ID` | Team ID |

Where to wire later: Tauri / `tauri-action` signing inputs or dedicated `codesign` / `xcrun notarytool` steps.

## Status honesty

Until a human has smoke-tested the unsigned `.app`/`.dmg` on a real Mac:

- Do **not** claim “macOS app works”
- Claim only: **unsigned CI artifact built on a macOS runner** (when the workflow succeeded)

### Latest successful CI (reference)

| | |
|--|--|
| Run | [33370068659](https://github.com/Eduardwiebe/worship-songbook/actions/runs/33370068659) |
| Commit | `8dd7de8` |
| Runner image | `macos-26-arm64` |
| Architecture | **arm64 only** (not universal; not x86_64) |
| `.app` | `Worship Songbook.app` (~8.4 MB on runner) |
| `.dmg` | `Worship Songbook_0.1.0_aarch64.dmg` (~3.9 MB) |
| Binary | `Contents/MacOS/worship-songbook` — Mach-O 64-bit **arm64** |

Local server copy (not in git): `/var/www/songbook/backups/macos-artifacts-run-33370068659/`
