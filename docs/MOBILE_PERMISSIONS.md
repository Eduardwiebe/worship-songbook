# Mobile permissions plan

Enable permissions only when a feature needs them. v0.1.0 does **not** activate these in the native shell.

| Capability | Android | iOS | Needed when |
|------------|---------|-----|-------------|
| Read user PDFs / files | storage / SAF document picker | document picker | Song import |
| Camera / scan | `CAMERA` | `NSCameraUsageDescription` | Scan-to-PDF |
| Save / export files | SAF / downloads | share / Files | Export charts |
| Share | share intent | `UIActivityViewController` | Share song text/PDF |
| Open external links | implicit VIEW intents | `SFSafari` / openURL | Legal + donations |
| Notifications | POST_NOTIFICATIONS (13+) | push entitlement | Future only — **not planned for v0.1** |

Current Tauri capability file (`app/src-tauri/capabilities/default.json`) grants only `core:default`. Keep it minimal until features land.
