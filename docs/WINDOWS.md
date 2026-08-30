# Windows native build

Target: **Windows 10/11 x64**  
Shell: Tauri 2 (`app/src-tauri/`)  
Product: Worship Songbook `0.1.0`  
Identifier: `studio.lyruma.worshipsongbook`  
Author: Eduard Wiebe

The git tag `v0.1.0` remains the **web baseline**. Windows work lives in later commits on `main`.

## What this prepares

- GitHub Actions workflow: `.github/workflows/windows-native.yml`
- Bundles: **NSIS `.exe`** and **WiX `.msi`** (unsigned for first smoke builds)
- Native API base: `https://songbook.lyruma.app` via `app/src/apiConfig.js`
- Native auth: Bearer access + refresh (Credential Manager via `keyring` / `secure_*`)
- Native HTTP: `@tauri-apps/plugin-http` (scoped to production host; avoids WebView CORS)
- External links: `@tauri-apps/plugin-opener` (system browser)
- Protected media: blob URLs via authenticated fetch (`AuthorizedImg` / `AuthorizedFrame`)

## How to run the Windows build

1. Push `main` to GitHub (**requires explicit operator approval** — not done automatically).
2. Actions → **Windows Native** → **Run workflow**.
3. Download artifact `Worship-Songbook-Windows-x64`.

Or after tagging: `windows-v0.1.0-preview` (does not move `v0.1.0`).

Local (on a Windows machine with VS Build Tools + WebView2):

```bash
cd app
npm ci
npm run tauri build -- --bundles nsis,msi
```

## Auth lifecycle to verify on a real Windows install

| Case | Expected |
|------|----------|
| A Login | Native login → Home |
| B Restart | Refresh token from Credential Manager restores session |
| C Access expiry | Silent refresh, API keeps working |
| D Logout | Refresh revoked, storage cleared, login required |
| E Bad refresh | Return to login, no retry loop |

## Smoke checklist (manual on Windows)

- Login / Logout
- Home, Bands, personal scope, band switch
- Team, Sets, Termine, Settings, profile (+ photo)
- Wizard only when required
- PDF import via `<input type="file">` (browser File API)
- Song / chart open
- External links open in system browser
- Window sizes ~1440×900, 1280×720, 1024×768

## Signing (later — not required for smoke)

Recommended later:

- Standard Authenticode code-signing certificate (OV/EV) for `.exe` / `.msi`
- Or Azure Trusted Signing

GitHub Secrets (examples — do **not** commit values):

| Secret | Purpose |
|--------|---------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` (or use cloud signing) |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| Optional Tauri updater keys | Only if updater is enabled |

Where to wire: add env vars to the “Build Tauri Windows bundles” step / `tauri-action` signing inputs. Keep unsigned builds until certificates exist.

## Active Tauri rights (minimal)

- `core:default`
- custom `secure_set|get|delete` (OS keyring)
- `http:default` **only** `https://songbook.lyruma.app/**`
- `opener:default` for known public https sites (Lyruma, PayPal, GitHub, Instagram)

No broad shell, no full filesystem ACL.

## Status honesty

Until a `windows-latest` runner has produced artifacts and a human has smoke-tested the installer:

- Do **not** claim “Windows app works”
- Claim only: **workflow and app config are prepared for a Windows runner**
