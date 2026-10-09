import { approvedSignatureSvg } from "./id-card-authorized-signature";

/** Authorized HR-only browser PDF generation from existing active employee records. */
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

function cardBase(ctx: CanvasRenderingContext2D, back = false): void {
  const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bg.addColorStop(0, "#190917");
  bg.addColorStop(0.58, "#0e0814");
  bg.addColorStop(1, "#07070e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Corrected Shambhoo Yogi master: one sweeping bronze arc, not concentric circles.
  ctx.strokeStyle = "rgba(162,80,29,.58)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(back ? 395 : 490, -18);
  ctx.bezierCurveTo(back ? 385 : 440, 236, 602, 485, 1082, 457);
  ctx.stroke();
  if (back) {
    ctx.strokeStyle = "rgba(216,30,121,.43)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-20, 522);
    ctx.bezierCurveTo(158, 576, 318, 526, 503, 465); ctx.stroke();
  } else {
    ctx.strokeStyle = "#eb4b83";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(655 + i * 10, 529 - i * 19);
      ctx.bezierCurveTo(705 + i * 8, 358 - i * 5, 842, 320, 1043, 375 + i * 5);
      ctx.stroke();
    }
  }

  const stripe = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  stripe.addColorStop(0, "#f02582");
  stripe.addColorStop(.55, "#ff5a67");
  stripe.addColorStop(1, "#ff973b");
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, CARD_WIDTH, 9);
  ctx.fillRect(0, 595, CARD_WIDTH, 5);

  ctx.fillStyle = "#f3dce9";
  ctx.fillRect(52, 177, CARD_WIDTH - 104, 2);
  ctx.fillStyle = "#080912";
  ctx.fillRect(0, 600, CARD_WIDTH, 48);
  text(ctx, "FASTQUE DIGITAL TECHNOLOGY PRIVATE LIMITED",
    52, 630, 760, 20, 700, "#f5edf7");
  text(ctx, "fastque.com", 865, 630, 132, 22, 600, "#ffb17d");
}

async function loadBrand(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => resolve(null);
    logo.src = "/brand/fastque-clean-lockup-transparent.png";
  });
}

function drawBrand(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null, front: boolean): void {
  if (logo && logo.naturalWidth > 0) {
    const width = 540;
    const height = width * logo.naturalHeight / logo.naturalWidth;
    ctx.drawImage(logo, 52, 27, width, Math.min(height, 139));
  } else {
    text(ctx, "FastQue", 52, 128, 540, 95, 750, "#ff739b");
  }
  if (front) {
    text(ctx, "TEAM ID", 841, 89, 161, 27, 700, "#efd4df");
    text(ctx, "FASTQUE", 858, 119, 130, 18, 600, "#f8e4ec");
  }
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
  if (!ctx) throw new Error("Unable to create card.");
  cardBase(ctx);
  drawBrand(ctx, logo, true);

  text(ctx, "EMPLOYEE", 54, 239, 420, 24, 650, "#ff81a7");
  const name = input.fullName.trim().replace(/\s+/g, " ");
  const words = name.split(" ");
  if (words.length > 1 && (name.length > 10 || ctx.measureText(name).width > 490)) {
    const half = Math.max(1, Math.ceil(words.length / 2));
    text(ctx, words.slice(0, half).join(" "), 53, 309, 575, 58, 750);
    text(ctx, words.slice(half).join(" "), 53, 377, 575, 58, 750);
  } else {
    text(ctx, name, 53, 359, 575, 59, 750);
  }

  ctx.strokeStyle = "#ff6e72";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(55, 393); ctx.lineTo(606, 393); ctx.stroke();

  text(ctx, "EMPLOYEE ID", 54, 430, 246, 21, 650, "#e7c8d3");
  text(ctx, "JOINING DATE", 345, 430, 290, 21, 650, "#e7c8d3");
  text(ctx, input.employeeCode, 54, 470, 270, 32, 700);
  const joined = new Date(input.joinedAt);
  const dateLabel = Number.isNaN(joined.getTime())
    ? "Not recorded"
    : joined.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).replace(/ /g, "-");
  text(ctx, dateLabel, 345, 470, 274, 29, 650);

  text(ctx, "DESIGNATION", 54, 523, 230, 19, 650, "#e7c8d3");
  text(ctx, "TERRITORY", 345, 523, 270, 19, 650, "#e7c8d3");
  text(ctx, input.designation || "Field Executive", 54, 568, 272, 29, 600);
  text(ctx, input.territory || "Not assigned", 345, 568, 275, 28, 600);

  roundedRect(ctx, 682, 190, 303, 365, 21);
  ctx.fillStyle = "#201522"; ctx.fill();
  ctx.strokeStyle = "#ff6a9e"; ctx.lineWidth = 4; ctx.stroke();
  ctx.save();
  roundedRect(ctx, 700, 208, 266, 330, 13);
  ctx.clip();
  cropImage(ctx, photo, 700, 208, 266, 330);
  ctx.restore();
  ctx.strokeStyle = "#f5e3ee"; ctx.lineWidth = 2;
  roundedRect(ctx, 697, 204, 271, 337, 13); ctx.stroke();
  return canvas;
}

function drawBack(
  input: EmployeeCardDraftInput, qr: HTMLCanvasElement,
  logo: HTMLImageElement | null, signature: HTMLImageElement,
): HTMLCanvasElement {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create card.");
  cardBase(ctx, true);
  drawBrand(ctx, logo, false);

  text(ctx, "EMPLOYEE IDENTIFICATION", 56, 254, 620, 24, 700, "#ff8ab1");
  text(ctx, input.fullName, 56, 332, 610, 47, 750);
  text(ctx, input.employeeCode, 56, 371, 620, 29, 700, "#f6bbd0");
  ctx.fillStyle = "rgba(255,255,255,.55)";
  ctx.fillRect(56, 387, 580, 2);
  text(ctx, "Issued for FastQue company use.", 56, 431, 610, 23, 600);
  text(ctx, "If found, contact:", 56, 471, 610, 21, 450, "#dccbd6");
  text(ctx, "support@fastque.com", 56, 505, 530, 25, 700, "#ffb17d");
  text(ctx, "Company property / Return on request", 56, 545, 602, 19, 450, "#dccbd6");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(728, 202, 234, 234);
  ctx.drawImage(qr, 740, 214, 210, 210);
  text(ctx, "OFFICIAL WEBSITE", 746, 469, 210, 21, 700);

  // Exactly one owner-approved authorized HR signature, in the back-bottom field.
  // No signature on the front, no decorative signature in the center.
  ctx.strokeStyle = "rgba(246,237,248,.45)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(56, 565); ctx.lineTo(641, 565); ctx.stroke();
  text(ctx, "Authorized HR signature:", 56, 586, 290, 18, 500, "#e9dce5");
  ctx.drawImage(signature, 332, 515, 221, 84);
  return canvas;
}

/** Loads the owner-approved D K Pandey artwork, tint-matched to the corrected premium master. */
async function loadAuthorizedSignature(): Promise<HTMLImageElement> {
  const svg = approvedSignatureSvg(1).replace('fill="#23437f"', 'fill="#f4dce9"');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Approved HR signature could not be loaded. No card was issued."));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
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
    "BT /F1 15 Tf 60 792 Td (FastQue Employee ID Card) Tj ET",
    "BT /F1 9 Tf 60 771 Td (Print at 100 percent / Actual Size. Do not fit to page.) Tj ET",
    "BT /F1 12 Tf 60 758 Td (FRONT) Tj ET",
    "q " + w + " 0 0 " + h + " " + x + " 600 cm /Front Do Q",
    "BT /F1 12 Tf 60 533 Td (BACK) Tj ET",
    "q " + w + " 0 0 " + h + " " + x + " 360 cm /Back Do Q",
    "BT /F1 9 Tf 60 315 Td (Authorized HR signature appears on back only; QR links to the official website.) Tj ET",
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
    const [logo, signature] = await Promise.all([loadBrand(), loadAuthorizedSignature()]);
    return cardImagesToA4Pdf(
      jpegBytes(drawFront(input, bitmap, logo)),
      jpegBytes(drawBack(input, input.siteQrCanvas, logo, signature)),
    );
  } finally {
    bitmap.close();
  }
}
