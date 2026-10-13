# Catalog Import — Keyless On-Device OCR

The salon-owner Services page has a privacy-first, keyless import option.

## What it does

- CSV / TSV / TXT / XLSX: existing backend parser, no Gemini required.
- JPG / JPEG / PNG / WEBP: Tesseract.js OCR inside the owner's browser (English and Hindi models), with a visible progress indicator.
- PDF with selectable text: PDF.js reads each page **in the browser**.
- Scanned/image-only PDF: PDF.js renders each page locally and Tesseract.js OCR reads it in the browser.
- Rate text is converted into **reviewable draft candidates** only when both an explicit service name and price are recognizable.
- Missing prices and durations are **never fabricated**. Duration stays blank until the user sets it explicitly or uses the visible, review-before-save bulk duration helper.
- The recognized raw text can be viewed/edited and reparsed; a shop owner always explicitly chooses which services to save.

## Data safety

OCR happens in the browser. Raw catalog files are not uploaded to FastQue, Google Gemini, or an AI provider when the recommended local mode is enabled. The browser may download the JavaScript/WASM worker and trained English/Hindi language models on first use. These model downloads are network requests, not file uploads. Network access, device memory, and CPU are required.

Actual service records are saved only on explicit user confirmation via the pre-existing authenticated, shop-authorized `import-reviewed` endpoint. Existing services are skipped, never overwritten. Failing inputs remain selected for retry. No production database schema changes are involved.

## Limits and supported behavior

- 6 MB per file. Up to eight files per batch. Local PDF maximum: five pages per file.
- English/Hindi OCR quality varies by picture sharpness, lighting, font size and table layout.
- The text-to-service review parser intentionally recognizes only clear service/price pairs. For multi-column or difficult menus, edit the transcript or manually enter missing rows.
- OCR models may need a sizable one-time download and can be slow or exhaust browser memory on older phones. Use smaller clear photos or CSV/XLSX when that happens.
- Cloud Gemini OCR is **optional**, off by default in the UI. It requires a separately configured `GEMINI_API_KEY` and explicit per-upload consent; there is no silent fallback to third-party processing.
- Device/browser runtime QA with genuine text and scanned PDFs and Android phones must be completed before calling the release fully certified. CI confirms TypeScript/build, tests and data handling rules, not real-device OCR accuracy.

## Release constraints

Release only the isolated catalog fix after its exact-head CI and authenticated browser smoke tests. Never merge unrelated owner-ops PRs into a catalog hotfix. Take care that automated deploys on `master` can redeploy *both* web and backend services.
