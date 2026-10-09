/**
 * Browser-only, printable ID-card DRAFT. No issuance, personnel database mutation,
 * or claim of online identity verification is made by this renderer.
 */
export type EmployeeCardDraftInput = {
  employeeCode: string;
  fullName: string;
  designation: string;
  territory: string;
  joinedAt: string;
  photo: File;
  siteQrCanvas: HTMLCanvasElement;
};

const CARD_WIDTH = 1028; // 85.6 mm at 12 px/mm
const CARD_HEIGHT = 648; // 54 mm at 12 px/mm
const CARD_PDF_WIDTH = 85.6 * 72 / 25.4;
const CARD_PDF_HEIGHT = 54 * 72 / 25.4;

export const OFFICIAL_SITE_QR_URL = "https://fastque.com";

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  return canvas;
}

function text(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight = 600,
  color = "#f9f6fc",
): void {
  ctx.font = String(weight) + " " + String(size) + "px Arial, sans-serif";
  ctx.fillStyle = color;
  let value = content.trim();
  if (ctx.measureText(value).width > maxWidth) {
    while (value.length > 1 && ctx.measureText(value + "\u2026").width > maxWidth) {
      value = value.slice(0, -1);
    }
    value += "\u2026";
  }
  ctx.fillText(value, x, y);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function cardBase(ctx: CanvasRenderingContext2D): void {
  const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  background.addColorStop(0, "#130b1d");
  background.addColorStop(0.56, "#241020");
  background.addColorStop(1, "#100c18");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.strokeStyle = "rgba(245,92,133,.17)";
  ctx.lineWidth = 3;
  for (let index = 0; index < 7; index += 1) {
    ctx.beginPath();
    ctx.ellipse(835, 310, 190 + index * 37, 250 + index * 35, -.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  const stripe = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  stripe.addColorStop(0, "#f52d80");
  stripe.addColorStop(.54, "#fc5871");
  stripe.addColorStop(1, "#ff9939");
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, CARD_WIDTH, 10);
  ctx.fillRect(0, CARD_HEIGHT - 12, CARD_WIDTH, 5);
  ctx.fillStyle = "#f5ecf2";
  ctx.fillRect(40, 155, CARD_WIDTH - 80, 1);
  text(ctx, "FASTQUE DIGITAL TECHNOLOGY PRIVATE LIMITED", 40, CARD_HEIGHT - 29, 770, 17, 600, "#e7dde7");
  text(ctx, "fastque.com", 862, CARD_HEIGHT - 29, 130, 18, 500, "#ff9b5d");
}

async function loadBrand(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => resolve(null);
    logo.src = "/brand/fastque-clean-lockup-transparent.png";
  });
}

function drawBrand(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null): void {
  if (logo) {
    const width = 370;
    const height = width * logo.naturalHeight / logo.naturalWidth;
    ctx.drawImage(logo, 40, 26, width, Math.min(height, 116));
  } else {
    text(ctx, "FastQue", 44, 112, 395, 78, 700, "#ff749d");
  }
  text(ctx, "TEAM ID", 857, 78, 126, 24, 700);
  text(ctx, "FASTQUE", 851, 105, 130, 17, 600, "#f0c6d4");
}

function cropImage(
  ctx: CanvasRenderingContext2D, photo: ImageBitmap,
  x: number, y: number, width: number, height: number,
): void {
  const scale = Math.max(width / photo.width, height / photo.height);
  const sw = width / scale;
  const sh = height / scale;
  ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, x, y, width, height);
}

function drawFront(
  input: EmployeeCardDraftInput, photo: ImageBitmap, logo: HTMLImageElement | null,
): HTMLCanvasElement {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create card preview.");
  cardBase(ctx);
  drawBrand(ctx, logo);

  text(ctx, "EMPLOYEE", 47, 213, 370, 21, 600, "#ff9db6");
  const name = input.fullName.trim().replace(/\s+/g, " ");
  const words = name.split(" ");
  if (name.length > 20 && words.length > 1) {
    const pivot = Math.ceil(words.length / 2);
    text(ctx, words.slice(0, pivot).join(" "), 47, 268, 597, 47, 700);
    text(ctx, words.slice(pivot).join(" "), 47, 320, 597, 47, 700);
  } else {
    text(ctx, name, 47, 287, 595, 50, 700);
  }

  ctx.strokeStyle = "rgba(255,106,154,.8)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(45, 342); ctx.lineTo(625, 342); ctx.stroke();

  text(ctx, "EMPLOYEE ID", 47, 392, 280, 17, 600, "#e7bfcf");
  text(ctx, "JOINING DATE", 373, 392, 290, 17, 600, "#e7bfcf");
  text(ctx, input.employeeCode, 47, 427, 293, 31, 700);
  const joined = new Date(input.joinedAt);
  const dateLabel = Number.isNaN(joined.getTime())
    ? "Not recorded"
    : joined.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  text(ctx, dateLabel, 373, 427, 264, 28, 700);

  text(ctx, "DESIGNATION", 47, 478, 595, 17, 600, "#e7bfcf");
  text(ctx, input.designation || "Field Executive", 47, 508, 590, 27);
  text(ctx, "LOCATION / TERRITORY", 47, 552, 595, 17, 600, "#e7bfcf");
  text(ctx, input.territory || "Not assigned", 47, 581, 590, 25);

  roundedRect(ctx, 682, 176, 303, 403, 18);
  ctx.fillStyle = "#251421"; ctx.fill();
  ctx.save();
  roundedRect(ctx, 696, 190, 275, 375, 13);
  ctx.clip();
  cropImage(ctx, photo, 696, 190, 275, 375);
  ctx.restore();
  ctx.strokeStyle = "#ff6e9b"; ctx.lineWidth = 3;
  roundedRect(ctx, 682, 176, 303, 403, 18); ctx.stroke();

  // Always mark a browser-rendered card as a non-issued HR draft.
  ctx.save();
  ctx.translate(325, 355);
  ctx.rotate(-Math.PI / 8);
  ctx.globalAlpha = .20;
  text(ctx, "HR DRAFT", -180, 0, 490, 90, 700, "#ffffff");
  ctx.restore();
  return canvas;
}

function drawBack(
  input: EmployeeCardDraftInput, qr: HTMLCanvasElement, logo: HTMLImageElement | null,
): HTMLCanvasElement {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create card preview.");
  cardBase(ctx);
  drawBrand(ctx, logo);

  text(ctx, "EMPLOYEE IDENTIFICATION", 52, 214, 610, 19, 700, "#ff9bb9");
  text(ctx, input.fullName, 52, 282, 600, 42, 700);
  text(ctx, input.employeeCode, 52, 320, 600, 25, 600, "#fce0e9");
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.fillRect(52, 340, 573, 1);
  text(ctx, "For authorised company use only.", 52, 384, 600, 20, 500);
  text(ctx, "If found, please contact:", 52, 425, 600, 20, 500, "#dccbd6");
  text(ctx, "support@fastque.com", 52, 457, 590, 22, 700, "#ffb593");
  text(ctx, "Company property \u2014 return on request.", 52, 490, 600, 20, 500);
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 708, 182, 257, 257, 8); ctx.fill();
  ctx.drawImage(qr, 724, 198, 225, 225);
  text(ctx, "OFFICIAL WEBSITE", 730, 469, 220, 18, 700);
  text(ctx, "NOT AN ID VERIFICATION", 711, 493, 254, 15, 700, "#ffa6b8");

  ctx.fillStyle = "rgba(248,248,248,.6)";
  ctx.fillRect(52, 555, 510, 1);
  text(ctx, "Authorised HR signature required before issuing", 52, 581, 590, 17, 500);
  return canvas;
}

function jpegBytes(canvas: HTMLCanvasElement): Uint8Array {
  const encoded = canvas.toDataURL("image/jpeg", .95).split(",")[1];
  if (!encoded) throw new Error("Could not export card image.");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let value = "";
  for (const b of bytes) value += b.toString(16).padStart(2, "0").toUpperCase();
  return value + ">";
}

/** Build one A4 PDF containing two ISO ID-1 faces, both at their physical 100% dimensions. */
export function cardImagesToA4Pdf(front: Uint8Array, back: Uint8Array): Uint8Array {
  const frontStream = hex(front) + "\n";
  const backStream = hex(back) + "\n";
  const img = (body: string) =>
    "<< /Type /XObject /Subtype /Image /Width " + CARD_WIDTH +
    " /Height " + CARD_HEIGHT +
    " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length " +
    new TextEncoder().encode(body).length + " >>\nstream\n" + body + "endstream";

  const x = ((595 - CARD_PDF_WIDTH) / 2).toFixed(3);
  const w = CARD_PDF_WIDTH.toFixed(3);
  const h = CARD_PDF_HEIGHT.toFixed(3);
  const commands = [
    "BT /F1 15 Tf 60 792 Td (FastQue Employee ID Card - HR Draft) Tj ET",
    "BT /F1 9 Tf 60 771 Td (Print at 100 percent / Actual Size. Do not fit to page.) Tj ET",
    "BT /F1 12 Tf 60 739 Td (FRONT) Tj ET",
    "q " + w + " 0 0 " + h + " " + x + " 558 cm /Front Do Q",
    "BT /F1 12 Tf 60 526 Td (BACK) Tj ET",
    "q " + w + " 0 0 " + h + " " + x + " 345 cm /Back Do Q",
    "BT /F1 9 Tf 60 315 Td (DRAFT: Employee photo and authorised HR signature must be reviewed before issue.) Tj ET",
    "BT /F1 9 Tf 60 296 Td (QR opens fastque.com only; it does not verify employee identity.) Tj ET",
  ].join("\n") + "\n";

  const objects: string[] = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [7 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    img(frontStream),
    img(backStream),
    "<< /Length " + new TextEncoder().encode(commands).length + " >>\nstream\n" + commands + "endstream",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << /Front 4 0 R /Back 5 0 R >> >> /Contents 6 0 R >>",
  ];

  let document = "%PDF-1.4\n%FastQue\n";
  const offsets = [0];
  const encoder = new TextEncoder();
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = encoder.encode(document).length;
    document += String(i) + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const startXref = encoder.encode(document).length;
  document += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    document += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  document += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" +
    String(startXref) + "\n%%EOF";
  return encoder.encode(document);
}

export async function buildEmployeeIdCardDraftPdf(input: EmployeeCardDraftInput): Promise<Uint8Array> {
  if (!/^FQ-FE-\d{5,}$/.test(input.employeeCode) || /\s/.test(input.employeeCode) || input.fullName.trim().length < 2) {
    throw new Error("Select a valid registered employee.");
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(input.photo.type) ||
    input.photo.size > 5 * 1024 * 1024 || input.photo.size === 0) {
    throw new Error("Choose a PNG, JPG or WebP photo up to 5 MB.");
  }
  const bitmap = await createImageBitmap(input.photo);
  try {
    const logo = await loadBrand();
    return cardImagesToA4Pdf(
      jpegBytes(drawFront(input, bitmap, logo)),
      jpegBytes(drawBack(input, input.siteQrCanvas, logo)),
    );
  } finally {
    bitmap.close();
  }
}
