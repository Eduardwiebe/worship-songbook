# Mobile permissions plan

Enable permissions only when a feature needs them. Desktop shells do not surface these prompts.

| Capability | Android | iOS | Needed when |
|------------|---------|-----|-------------|
| Read user PDFs / files | storage / SAF document picker | document picker (HTML file input / Files) | Song import |
| Camera / scan | `CAMERA` | `NSCameraUsageDescription` (`Info.ios.plist`) | Scan-to-PDF |
| Photos / profile | — | `NSPhotoLibraryUsageDescription` (+ Add) | Profile photo / gallery import |
| Save / export files | SAF / downloads | share / Files | Export charts |
| Share | share intent | `UIActivityViewController` | Share song text/PDF |
| Open external links | implicit VIEW intents | opener → Safari / openURL | Legal + donations |
| Notifications | POST_NOTIFICATIONS (13+) | push entitlement | Future only — **not planned for v0.1** |

Desktop capability file (`app/src-tauri/capabilities/default.json`) and mobile (`mobile.json`) grant `core:default`, secure storage, scoped `http` to `https://songbook.lyruma.app/**`, and scoped `opener` allow-list. Keep them minimal until new features land.

See also `docs/IOS.md`.
