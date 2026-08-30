# Native architecture (Tauri 2)

Worship Songbook ships as a React/Vite web app. Native clients reuse the **same** frontend under `app/` via Tauri 2 (`app/src-tauri/`).

Identifier: `studio.lyruma.worshipsongbook`  
Product name: Worship Songbook  
Author: Eduard Wiebe

## API base

All client HTTP calls must go through `app/src/apiConfig.js`:

| Environment | API base |
|-------------|----------|
| Web (production / same origin) | `''` → relative `/api/...` |
| Native (Tauri) | `VITE_API_BASE` or default `https://songbook.lyruma.app` |

Helpers: `getApiBase()`, `apiUrl(path)`, `apiFetch(path, options)` (always `credentials: 'include'` unless overridden).

## Authentication assessment (critical)

The **web** app uses HttpOnly session cookies:

- Cookie flags: `HttpOnly; Secure; SameSite=Strict; Path=/`
- CSRF guard: mutating requests require `Origin` host to match `Host` (`auth.mjs` `safeOrigin`)
- Band selection uses a second cookie with the same flags

### Why cookie auth is unreliable for bundled Tauri apps

A typical Tauri desktop/mobile shell loads the UI from a **local asset origin** (e.g. `tauri://localhost` / custom scheme), then calls `https://songbook.lyruma.app/api/...`.

That is a **cross-site** request relative to the API host:

1. **`SameSite=Strict`** session cookies set by `songbook.lyruma.app` are **not** sent on cross-site fetches from the WebView origin.
2. Even if cookies were set/sent, **CSRF Origin checks** reject mutations when `Origin` is the WebView scheme/host, not `songbook.lyruma.app`.
3. Cookie jar / partition behavior differs across **Windows WebView2**, **macOS WKWebView**, **Android WebView**, and **iOS WKWebView**.
4. Loading the remote site full-frame (`https://songbook.lyruma.app` inside the WebView) can make cookies work but defeats offline packaging and blurs “native app” vs browser.

**Conclusion:** Do **not** rely on the current cookie session for native clients without a dedicated auth design. Do **not** weaken `SameSite=Strict` or CSRF checks for web security.

### Planned native auth layer (not implemented in v0.1.0)

Minimal secure migration path (web login unchanged):

1. Add optional **Bearer access token + refresh token** endpoints alongside cookie sessions.
2. Web continues to use cookies; native stores tokens in **platform secure storage** (Keychain / Credential Manager / Keystore).
3. `apiFetch` attaches `Authorization: Bearer …` when a native token is present.
4. CSRF Origin check remains for cookie-authenticated browser requests; token auth uses separate validation.
5. Document token lifetimes, rotation, and revocation (sessions table or dedicated token table).

Until that lands: native builds may show the UI, but **login against production is not considered working**.

## Desktop (Windows / macOS)

Prepared: Tauri 2 config, icons placeholder, npm scripts.

This Linux host cannot produce signed Windows/macOS installers in-place. Use GitHub Actions runners (`windows-latest`, `macos-latest`) later. See `docs/CI.md`.

Still needed later:

- Platform toolchain verification (`tauri info`)
- Real `tauri build` on each OS
- Code signing certificates (never commit)
- Installer smoke tests (login blocked until token auth)

## Mobile (Android / iOS)

Tauri 2 mobile structure is supported by the toolchain; project is prepared at the config level.

Still needed later:

- `tauri android init` / `tauri ios init` on a machine with Android SDK / Xcode
- Permission planning (enable only when features need them):

| Feature | Likely permission / capability |
|---------|--------------------------------|
| PDF import / save | filesystem / document picker |
| Scan pages | camera |
| Share charts | share sheet |
| External legal links | open URL |
| Push (future) | notifications — **not** enabled now |

Do not add unused permissions.

## Regression rule

Native work must not break web:

- Relative API base on web
- Cookie auth unchanged
- `npm run build` and live `/api/health` remain green
