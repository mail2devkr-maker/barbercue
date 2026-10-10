// Non-deploying browser QA: exercise the *real* browser PDF renderer with synthetic employee data.
// Requires only locally available Chrome/Chromium, a transient playwright-core, and npm-ci packages.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import QRCode from "qrcode";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const brand = path.resolve("apps/web/public/brand/fastque-clean-lockup-transparent.png");
const source = path.resolve("apps/web/app/(dashboard)/dashboard/admin/crm/employee-id-card.ts");
assert.ok(existsSync(source), "Employee ID Card source must exist");
const signatureSource = path.resolve("apps/web/app/(dashboard)/dashboard/admin/crm/id-card-authorized-signature.ts");
assert.ok(existsSync(signatureSource), "Owner-approved signature artwork module must exist");
assert.ok(existsSync(brand), "Real brand logo must exist at the application's expected path");
const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const signatureCompiled = ts.transpileModule(readFileSync(signatureSource, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const server = createServer((req, res) => {
  if (req.url === "/brand/fastque-clean-lockup-transparent.png") {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    res.end(readFileSync(brand));
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>FastQue synthetic QA</body></html>");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((item) => item && existsSync(item));
assert.ok(chrome, "No Chrome/Chromium available for real-browser certification");
let browser;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + address.port);
  const qr = await QRCode.toDataURL("https://fastque.com", {
    width: 256, margin: 2, errorCorrectionLevel: "H",
    color: { dark: "#17131b", light: "#ffffff" },
  });
  const result = await page.evaluate(async ({ compiled, signatureCompiled, qr }) => {
    const module = { exports: {} };
    // Trusted checked-out project source, transpiled from TypeScript, executed only in local synthetic QA.
    const signatureModule = { exports: {} };
    new Function("module", "exports", signatureCompiled)(signatureModule, signatureModule.exports);
    const localRequire = (name) => {
      if (name === "./id-card-authorized-signature") return signatureModule.exports;
      throw new Error("Unexpected import in browser PDF QA");
    };
    new Function("module", "exports", "require", compiled)(module, module.exports, localRequire);
    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Synthetic QR image failed to load"));
      img.src = src;
    });
    const qrCanvas = document.createElement("canvas");
    qrCanvas.width = qrCanvas.height = 256;
    qrCanvas.getContext("2d").drawImage(await loadImage(qr), 0, 0, 256, 256);
    const photoCanvas = document.createElement("canvas");
    photoCanvas.width = 400;
    photoCanvas.height = 600;
    const c = photoCanvas.getContext("2d");
    c.fillStyle = "#00c8f2";
    c.fillRect(0, 0, 400, 600);
    c.fillStyle = "#132a50";
    c.fillRect(90, 75, 220, 160);
    const blob = await new Promise((resolve) => photoCanvas.toBlob(resolve, "image/png"));
    const photo = new File([blob], "synthetic-qa-photo.png", { type: "image/png" });
    const pdf = await module.exports.buildEmployeeIdCardDraftPdf({
      employeeCode: "FQ-FE-98765",
      fullName: "Synthetic QA Employee",
      joinedAt: "2026-10-08T18:30:00.000Z", // 09-Oct midnight in India
      designation: "Field Executive",
      territory: "Test Territory",
      photo,
      siteQrCanvas: qrCanvas,
    });
    let binary = "";
    for (let i = 0; i < pdf.length; i += 8192)
      binary += String.fromCharCode(...pdf.subarray(i, i + 8192));
    return { base64: btoa(binary), pdfLength: pdf.length, joining: module.exports.formatEmployeeJoiningDate("2026-10-08T18:30:00.000Z") };
  }, { compiled, signatureCompiled, qr });
  assert.ok(result.pdfLength > 40000, "Generated PDF was implausibly small");
  assert.equal(result.joining, "09-Oct-2026", "India midnight must not become 08-Oct in the PDF");
  const pdf = Buffer.from(result.base64, "base64").toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"), "PDF magic missing");
  assert.ok(pdf.includes("/MediaBox [0 0 595 842]"), "A4 media box missing");
  assert.ok(pdf.includes("242.646") && pdf.includes("153.071"), "ISO ID-1 print size missing");
  assert.ok(pdf.includes("QR opens fastque.com only; it does not verify employee identity."), "QR disclaimer missing");
  assert.ok(!pdf.includes("HR Draft") && !pdf.includes("DRAFT:"), "Downloaded card must use the approved title");
  const images = [...pdf.matchAll(/\/Filter \[\/ASCIIHexDecode \/DCTDecode\] \/Length \d+ >>\nstream\n([0-9A-F]+)>\nendstream/g)];
  assert.equal(images.length, 2, "Front and back raster images must be embedded in PDF");
  // Decode the actual rendered FRONT image to verify the visible logo occupies
  // the corrected large upper-left header rather than the prior tiny, padded art.
  const logoVisible = await page.evaluate(async (jpegBase64) => {
    const raw = atob(jpegBase64);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    const img = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(img, 0, 0);
    img.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minX = 9999; let maxX = -1; let count = 0;
    for (let y = 40; y < 152; y++) {
      for (let x = 50; x < 645; x++) {
        const p = (y * canvas.width + x) * 4;
        const lum = (data[p] + data[p + 1] + data[p + 2]) / 3;
        if (lum < 138) continue; // logo's cream/pink/orange, not dark card background
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        count++;
      }
    }
    return { count, minX, maxX };
  }, Buffer.from(images[0][1], "hex").toString("base64"));
  assert.ok(logoVisible.count > 1200, "FastQue logo has too few visible premium pixels");
  assert.ok(logoVisible.minX <= 100, "Logo visible content must be left aligned");
  assert.ok(logoVisible.maxX >= 430, "Logo must visually fill the premium header width");

  await page.addScriptTag({ path: require.resolve("jsqr") });
  const decoded = await page.evaluate(async (backBase64) => {
    const raw = atob(backBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    URL.revokeObjectURL(url);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(pixels.data, canvas.width, canvas.height);
    bitmap.close();
    return { decodedUrl: code?.data ?? null, width: canvas.width, height: canvas.height };
  }, Buffer.from(images[1][1], "hex").toString("base64"));
  assert.equal(decoded.decodedUrl, "https://fastque.com", "QR must decode from the actual generated card back");
  assert.equal(decoded.width, 1028, "Back raster width mismatch");
  assert.equal(decoded.height, 648, "Back raster height mismatch");
  console.log("BROWSER PDF QA PASS: approved premium front/back with authorized back-only signature; generated real PDF with uploaded synthetic photo and brand image; A4/ISO size PASS; embedded back-card QR decodes to https://fastque.com; this is NOT an employee verification service or a physical print test.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
