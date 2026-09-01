# Native document scanner + structured leadsheet OCR

## Capture (iOS)

| Platform | Capture |
|----------|---------|
| **iOS native** | Apple **VisionKit** `VNDocumentCameraViewController` via Tauri plugin `document-scanner` — edge detect, crop, perspective correction, multi-page |
| Desktop / web / fallback | HTML `<input type="file" accept="image/*">` (camera or gallery) |

Frontend: `app/src/documentScanner.js` → `plugin:document-scanner|scan`  
Plugin: `app/src-tauri/plugins/document-scanner/` (Swift + Rust)

## Analysis (shared backend)

Same path for desktop upload and iOS scan:

```
pages → scan_to_pdf.py (full-frame PDF, no crop)
     → POST /api/songs/:id/analyze-chords
     → ocr_structured.py (RapidOCR / PaddleOCR-ONNX, CPU)
     → lib/leadsheetReconstruct.mjs (geometry + chord/lyric structure)
```

### OCR engines evaluated

| Engine | Role | Notes |
|--------|------|-------|
| **RapidOCR (ONNX)** | **Primary** | PaddleOCR det/rec models; token + bbox + confidence; ~0.7–1s/page CPU |
| Full PaddlePaddle + PaddleOCR | Evaluated | Heavier install; same model family — RapidOCR preferred for CPU hosts |
| Tesseract TSV | Fallback | Word boxes if RapidOCR unavailable |
| Legacy Tesseract stdout | Legacy candidate | Flat text only; used if structured score &lt; 45 |
| Apple Vision OCR | Not used server-side | Capture quality comes from VisionKit; recognition stays self-hosted |

Install OCR venv on the server:

```bash
python3 -m venv /var/www/songbook/.venv-ocr
/var/www/songbook/.venv-ocr/bin/pip install -r /var/www/songbook/requirements-ocr.txt
```

Env override: `SONGBOOK_OCR_PYTHON=/path/to/python`

### Structured OCR token shape

```json
{ "text": "Jesus", "bbox": [x0,y0,x1,y1], "confidence": 0.98, "line_index": 2 }
```

### Original page viewer (iOS)

Root cause of “only part of the page visible”: WKWebView PDF `<iframe>`/`<embed>` + CSP `object-src 'none'` + fixed-height sheet.

Fix:

- CSP allows `object-src 'self' blob:`
- iOS original tab uses **`GET /api/songs/:id/pages`** → full-width JPEG page images (`OriginalPagesViewer`)
- `scan_to_pdf.py` no longer over-sharpens/crops; preserves full frame

## Tests

```bash
node scripts/test-leadsheet-quality.mjs
node scripts/test-leadsheet-reconstruct.mjs
node scripts/benchmark-leadsheet-ocr.mjs   # synthetic fixtures only
```

## Device retest (iPhone)

1. Build iOS app on Mac (includes VisionKit plugin).
2. Ensure production API has `.venv-ocr` + restarted `server.mjs`.
3. Add → Aus dem Buch scannen → **Dokument scannen** (VisionKit UI).
4. Scan a leadsheet page → create song → open editor.
5. **Original**: full page visible, not cropped.
6. **Bearbeiten**: chords above lyrics, no `SSS`/`♪` junk; transpose works.
7. If quality low: `needsReview` warning shown; original still available.
