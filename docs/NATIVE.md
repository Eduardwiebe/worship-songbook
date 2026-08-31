# Native architecture (Tauri 2)

Worship Songbook ships as a React/Vite web app. Native clients reuse the **same** frontend under `app/` via Tauri 2 (`app/src-tauri/`).

Identifier: `studio.lyruma.worshipsongbook`  
Product name: Worship Songbook  
Author: Eduard Wiebe

## API base

All client HTTP calls go through `app/src/apiConfig.js`:

| Environment | API base |
|-------------|----------|
| Web (production / same origin) | `''` → relative `/api/...` |
| Native (Tauri) | `VITE_API_BASE` or default `https://songbook.lyruma.app` |

Helpers: `getApiBase()`, `apiUrl(path)`, `apiFetch(path, options)`.

Native `apiFetch` also attaches:

- `Authorization: Bearer <accessToken>` when logged in
- `X-Songbook-Band: <bandId>` when a band is selected (cookie band selection does not work cross-origin)

## Authentication

### What works in the browser today

- Login/register set HttpOnly session cookie `songbook_session`
- Flags: `HttpOnly; Secure; SameSite=Strict; Path=/`
- Band selection cookie `songbook_band` with the same flags
- Mutating cookie-authenticated requests require `Origin` host === `Host` (CSRF guard)
- Credentials: `include` on same-origin fetches

### Why cookies fail in typical Tauri WebViews

Bundled UI origin ≠ `https://songbook.lyruma.app`:

1. `SameSite=Strict` cookies are not sent on cross-site API calls
2. CSRF Origin check rejects mutations from `tauri://` / custom schemes
3. Cookie jars differ across WebView2 / WKWebView / Android WebView

**Do not weaken** cookie `SameSite` or CSRF for web.

### Native token auth (implemented)

Web remains cookie-only. Native uses opaque tokens:

| Token | Lifetime | Storage (server) | Client |
|-------|----------|------------------|--------|
| Access | 15 minutes | SHA-256 hash in `native_access_tokens` | memory only |
| Refresh | 30 days | SHA-256 hash in `native_refresh_tokens` | OS keyring via Tauri `secure_*` commands |

Endpoints:

- `POST /api/auth/native/login` → access + refresh
- `POST /api/auth/native/refresh` → rotation (old refresh revoked)
- `POST /api/auth/native/logout` → revoke family
- `GET /api/auth/native/me` → Bearer required

Protected `/api/*` accepts **cookie session OR** `Authorization: Bearer`.

Refresh rotation and logout are server-side revocable. Tokens are never logged by the API. Raw tokens are not stored in SQLite.

### Secure storage (Tauri)

Rust commands in `app/src-tauri/src/lib.rs` use the `keyring` crate:

- `secure_set` / `secure_get` / `secure_delete`
- Service id: `studio.lyruma.worshipsongbook`

Frontend: `app/src/secureStorage.js` + `app/src/nativeSession.js`.

If keyring is unavailable at runtime, refresh tokens fall back to **process memory only** (not localStorage). That fallback is for broken toolchains — not a production claim.

**Not runtime-verified on this Linux server for Windows/macOS/iOS/Android builds.**

## Automated tests

```bash
node scripts/test-native-auth.mjs
```

Creates a temporary user, exercises login/refresh/logout/expiry/Bearer API access, then deletes the user.

## Desktop / mobile readiness

See `docs/CI.md`, `docs/WINDOWS.md`, and `docs/MACOS.md`.

| Platform | Workflow | Status |
|----------|----------|--------|
| Windows | `.github/workflows/windows-native.yml` | Unsigned CI artifact (device smoke may still be open) |
| macOS | `.github/workflows/macos-native.yml` | Unsigned CI artifact when runner succeeds |
| Android / iOS | — | Not in this phase |

Still needed for production native apps:

- Device smoke-tests per platform
- Signing / notarization secrets (never in git)
- End-to-end login smoke inside each WebView against production API
