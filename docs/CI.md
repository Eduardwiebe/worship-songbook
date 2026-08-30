# CI/CD plan (GitHub Actions)

Status for v0.1.0: **workflow stubs only**. No secrets are stored in the repository. No public push is required to use these files locally.

## Planned workflows

| Workflow | Runner | Purpose |
|----------|--------|---------|
| `web.yml` | `ubuntu-latest` | `npm ci`, `npm run build`, `node --check server.mjs` |
| `windows-native.yml` | `windows-latest` | Tauri NSIS + MSI (unsigned smoke); see `docs/WINDOWS.md` |
| `desktop-macos.yml` | `macos-latest` | Tauri build (unsigned or signed later) |
| `android.yml` | `ubuntu-latest` (+ Android SDK) | Debug APK/AAB later |
| `ios.yml` | `macos-latest` (+ Xcode) | Archive later |

Stub file: `.github/workflows/ci-web.yml` (safe, no secrets).

## Secrets required later (do not commit values)

### Web / general

- None mandatory for a public OSS build of the frontend.
- Optional: deploy tokens if CD is added (prefer OIDC / environment protection).

### Windows signing

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (Tauri updater, if used)
- Windows code-signing certificate material (e.g. `.pfx` + password) via Actions secrets — **never** in git

### macOS signing / notarization

- Apple Developer certificate + provisioning
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Notarization credentials

### Android

- Keystore file (secret) + `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
- Optional Play Console service account JSON

### iOS

- Distribution certificate + provisioning profile
- App Store Connect API key (`ASC_KEY_ID`, `ASC_ISSUER_ID`, private key)

## Explicit non-goals for v0.1.0

- No store submission
- No signing keys in the repo
- No automatic deploy of native binaries without operator approval
