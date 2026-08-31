# CI/CD plan (GitHub Actions)

No secrets are stored in the repository. Native signing remains optional and undocumented credentials must never be committed.

## Workflows

| Workflow | Runner | Purpose |
|----------|--------|---------|
| `ci-web.yml` | `ubuntu-latest` | Frontend build / server syntax checks |
| `windows-native.yml` | `windows-latest` | Tauri NSIS + MSI (unsigned smoke); see `docs/WINDOWS.md` |
| `macos-native.yml` | `macos-latest` | Tauri `.app` + `.dmg` (unsigned smoke); see `docs/MACOS.md` |
| `ios-native.yml` | `macos-latest` (+ Xcode) | Tauri iOS **Simulator** build (unsigned); see `docs/IOS.md` |
| `android.yml` | `ubuntu-latest` (+ Android SDK) | Debug APK/AAB later (not active) |

Native workflows use `workflow_dispatch` (and optional `windows-v*` / `macos-v*` tags). They do not auto-run on every push.

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
