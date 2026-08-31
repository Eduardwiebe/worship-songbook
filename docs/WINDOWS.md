# Windows native build

Target: **Windows 10/11 x64**  
Shell: Tauri 2 (`app/src-tauri/`)  
Product: Worship Songbook `0.1.0`  
Identifier: `studio.lyruma.worshipsongbook`  
Author: Eduard Wiebe

The git tag `v0.1.0` remains the **web baseline**. Windows work lives in later commits on `main`.

---

## DEVELOPMENT / UNSIGNED TEST BUILD

**This Windows build is an unsigned development / smoke-test build.**

| Rule | Detail |
|------|--------|
| Audience | Internal development and manual smoke-test only |
| Public distribution | **Not** intended — do not ship this installer to end users |
| SmartScreen | Windows SmartScreen warnings on unsigned installers are **expected** |
| Signing | Not enabled; self-signed certificates are **not** a public trust solution |
| Validation | Do **not** mark Windows as “validated” or “production-ready” until a human smoke-test passes on a real device |

**Public end-user distribution later requires** either a trusted Authenticode signature (or cloud signing) **or** Microsoft Store distribution — see [Distribution options](#distribution-options-decision-note) below. Signing is **not** implemented in this documentation pass.

---

## What this prepares

- GitHub Actions workflow: `.github/workflows/windows-native.yml`
- Bundles uploaded today: **NSIS setup `.exe`** and **WiX `.msi`** (unsigned)
- Native API base: `https://songbook.lyruma.app` via `app/src/apiConfig.js`
- Native auth: Bearer access + refresh (Credential Manager via `keyring` / `secure_*`)
- Native HTTP: `@tauri-apps/plugin-http` (scoped to production host; avoids WebView CORS)
- External links: `@tauri-apps/plugin-opener` (system browser)
- Protected media: blob URLs via authenticated fetch (`AuthorizedImg` / `AuthorizedFrame`)

## Artifact contents (run `33364284696` and same workflow shape)

The Actions artifact `Worship-Songbook-Windows-x64` contains **only** installer bundles:

| File (typical name) | Type | Role |
|---------------------|------|------|
| `Worship Songbook_0.1.0_x64-setup.exe` | NSIS installer | Preferred for internal smoke-test install |
| `Worship Songbook_0.1.0_x64_de-DE.msi` | WiX MSI | Alternative installer |

### Portable / direct Tauri `.exe`?

**Not available in the current artifact.**

- The workflow uploads only `bundle/nsis/*.exe` and `bundle/msi/*.msi`.
- Tauri also produces a raw app binary under `app/src-tauri/target/release/` on the runner (e.g. product exe next to `bundle/`), but that path is **not** uploaded today.
- There is **no** separate “portable” package in the artifact.
- For smoke-test, use the **NSIS installer** (or MSI). Do not invent SmartScreen / Defender / registry workarounds.

Local server copy of the preferred installer (not in git):

`/var/www/songbook/backups/windows-artifacts-run-33364284696/nsis/Worship Songbook_0.1.0_x64-setup.exe`

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

## Signing (later — not required for smoke, not done here)

Recommended later for **public** classic installers:

- Standard Authenticode code-signing certificate (OV/EV) for `.exe` / `.msi`
- Or Azure Trusted Signing

GitHub Secrets (examples — do **not** commit values):

| Secret | Purpose |
|--------|---------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` (or use cloud signing) |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| Optional Tauri updater keys | Only if updater is enabled |

Where to wire: add env vars to the “Build Tauri Windows bundles” step / `tauri-action` signing inputs. Keep unsigned builds until certificates exist.

**Do not** treat self-signed certificates as a substitute for public trust / SmartScreen reputation.

## Active Tauri rights (minimal)

- `core:default`
- custom `secure_set|get|delete` (OS keyring)
- `http:default` **only** `https://songbook.lyruma.app/**`
- `opener:default` for known public https sites (Lyruma, PayPal, GitHub, Instagram)

No broad shell, no full filesystem ACL.

## Status honesty

- CI has produced unsigned NSIS + MSI artifacts on `windows-latest` (e.g. run `33364284696`).
- A human device smoke-test may still be incomplete.
- Do **not** claim “Windows app works for end users” or “Windows validated”.
- Claim only: **unsigned development installers exist for internal smoke-test**; public distribution needs Store and/or trusted signing (see below).

---

## Distribution options (decision note)

No signing or Store onboarding is implemented in this mission — options only.

### OPTION A — Microsoft Store distribution

| | |
|--|--|
| **Idea** | Package as MSIX (or Store-compatible package) and publish via Partner Center; users install from the Store. |
| **Voraussetzungen** | Microsoft Partner Center account; app packaging (MSIX / Store pipeline); Store policies, age rating, privacy disclosures; ongoing update submissions. |
| **Kosten** | One-time Partner Center registration (historically ~\$19 USD for individuals / ~\$99 for companies — confirm current Microsoft pricing). Store cut on paid apps if monetized; free apps still need account. |
| **Identitätsprüfung** | Microsoft developer/publisher identity verification via Partner Center (ID / business details). |
| **Vorteile** | Built-in trust / update channel; less SmartScreen friction for Store installs; discoverability; simpler uninstall story for many users. |
| **Nachteile** | Store review latency; packaging and capability constraints; less control over install UX; Tauri/Store packaging is extra pipeline work; not ideal if you need classic MSI/GPO-first distribution. |
| **Fit for Worship Songbook** | Good if the primary goal is **trusted consumer installs** with low friction and Microsoft-managed updates. Weaker if churches/IT need **offline MSI / group policy** deploy. |

### OPTION B — Classic signed MSI/EXE distribution

| | |
|--|--|
| **Idea** | Keep NSIS `.exe` and/or WiX `.msi`; sign with a trusted Authenticode certificate (OV/EV) or Azure Trusted Signing; host downloads yourself (website / GitHub Releases). |
| **Voraussetzungen** | Code-signing cert from a public CA (or Azure Trusted Signing setup); CI signing step; optional timestamping; download hosting; still expect reputation warm-up for new publishers. |
| **Kosten** | OV: often roughly \$200–400+/year; EV: often \$300–600+/year (vendor-dependent). Azure Trusted Signing: pay-as-you-go / subscription (check current Azure pricing). Plus engineering time for CI. |
| **Identitätsprüfung** | CA or Azure validates organization/individual identity (stronger for OV/EV); EV usually requires stricter org verification. |
| **Vorteile** | Full control over installers, versioning, and hosting; MSI fits IT / silent install; matches current Tauri NSIS+MSI workflow; no Store review gate. |
| **Nachteile** | Cert cost and renewal; SmartScreen reputation still builds over time even when signed; you own hosting, malware scanning optics, and update UX; unsigned builds must never be marketed as public releases. |
| **Fit for Worship Songbook** | Good default if you want **direct downloads** and optional **church/IT MSI** deploy alongside the existing Actions pipeline. |

### Practical recommendation (non-binding)

- **Now:** keep treating artifacts as **internal unsigned smoke builds** only.
- **Later public Windows:** prefer **OPTION B** first if you already ship NSIS/MSI and may need IT-friendly MSI; evaluate **OPTION A** if Store trust and discovery matter more than classic installers.
- Combination is possible later (Store + signed classic), but doubles packaging/signing work.
