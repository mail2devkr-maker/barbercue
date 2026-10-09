import { Role, type AdminEmployeeDto } from "@barbercue/shared";
import { approvedSignatureSvg } from "./approved-signature-watermark";

/**
 * Printable ID-1 sized TEMPLATE ONLY. This is deliberately not an issuance endpoint:
 * HR must confirm portrait, identity, authorization and printed QR independently.
 * Special IDs 00000-00100 are never previewable from this UI except by PLATFORM_ADMIN.
 */
export function mayPreviewCompanyIdCard(roles: Role[], employeeCode: string): boolean {
  const match = /^FQ-FE-(\d{5})$/.exec(employeeCode);
  if (!match) return false;
  const number = Number(match[1]);
  const authorized = roles.some(role =>
    role === Role.PLATFORM_ADMIN || role === Role.CO_FOUNDER || role === Role.HR_ADMIN);
  return authorized && (number > 100 || roles.includes(Role.PLATFORM_ADMIN));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type CardPreviewOptions = {
  photoDataUrl?: string | null;
  qrSvg: string;
  logoUrl: string;
};

/** Self-contained HTML for A4 print or Save as PDF. Does not authorize an employee ID. */
export function buildEmployeeIdCardPreview(
  employee: Pick<AdminEmployeeDto, "fullName" | "employeeCode" | "territory" | "joinedAt">,
  options: CardPreviewOptions,
): string {
  if (!/^FQ-FE-\d{5}$/.test(employee.employeeCode)) throw new Error("Unexpected employee code.");
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/.test(options.qrSvg.trim()) || /<(script|foreignObject)\b|\son\w+\s*=|javascript:/i.test(options.qrSvg)) {
    throw new Error("A real website QR SVG is required.");
  }
  if (!options.logoUrl.endsWith("/brand/fastque-clean-lockup-transparent.png") || !(/^https:\/\//.test(options.logoUrl) || /^http:\/\/localhost(?::\d+)?\//.test(options.logoUrl))) {
    throw new Error("Use an HTTPS URL for the original FastQue logo.");
  }
  const hasPhoto = Boolean(options.photoDataUrl);
  if (hasPhoto && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(options.photoDataUrl!)) {
    throw new Error("Only embedded PNG, JPEG, or WebP employee portraits are accepted.");
  }
  const joinedAt = new Date(employee.joinedAt);
  if (Number.isNaN(joinedAt.getTime())) throw new Error("Employee joining date is invalid.");
  const dateLabel = joinedAt.toLocaleDateString("en-GB", {day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"});
  const watermark = approvedSignatureSvg(0.24);
  const photo = hasPhoto
    ? '<img alt="Employee portrait" class="photo" src="' + options.photoDataUrl + '">'
    : '<div class="photo missing">PHOTO<br>REQUIRED</div>';
  const qr = options.qrSvg;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FastQue Employee ID Preview - ' +
    escapeHtml(employee.employeeCode) +
    '</title><style>' +
    '@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#16172d;background:#f4f5f9;margin:0;padding:12mm}' +
    '.intro{font-size:11px;max-width:170mm;margin:0 auto 5mm;color:#31354d}.intro b{color:#c92e58}' +
    '.sheet{max-width:185mm;margin:auto;display:flex;gap:8mm;flex-wrap:wrap;align-items:flex-start}.slot{width:85.6mm}' +
    '.caption{font-size:10px;font-weight:700;margin-bottom:2mm;color:#575e70}.card{position:relative;width:85.6mm;height:54mm;overflow:hidden;border:1px solid #c6cad7;border-radius:3mm;background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
    '.bar{height:12mm;background:#101321;position:relative;padding:2mm 3.5mm}.bar img{max-width:35mm;max-height:8mm;object-fit:contain}' +
    '.brandtext{position:absolute;top:7mm;right:3mm;color:#fff;font-size:6px;letter-spacing:1px}.accent{height:1.3mm;background:linear-gradient(90deg,#ed3a68,#8147cc,#337ad8)}' +
    '.face{display:flex;gap:3mm;padding:3mm 3mm 0;position:relative;z-index:1}.photo{width:20mm;height:24mm;object-fit:cover;border:1px solid #b8bed0;border-radius:1mm}.missing{font-size:9px;color:#777c8c;text-align:center;display:grid;place-items:center;background:#f0f2f6}' +
    '.details{flex:1;min-width:0}.name{font-size:13px;font-weight:750;letter-spacing:.1px;overflow-wrap:anywhere}.role{font-size:9px;color:#a62654;font-weight:700;margin-top:1mm}.meta{font-size:7.5px;margin-top:1.6mm;color:#384158;overflow-wrap:anywhere}.label{color:#69728b;font-weight:700}' +
    '.watermark{position:absolute;width:38mm;left:27mm;bottom:1.7mm;opacity:.75;pointer-events:none}.watermark svg{width:100%;height:auto}' +
    '.bottom{position:absolute;bottom:2mm;left:3mm;right:3mm;border-top:1px solid #dfe2ea;padding-top:1mm;display:flex;justify-content:space-between;align-items:center;font-size:6px;color:#666}' +
    '.back{background:linear-gradient(145deg,#fff,#f0f2fa)}.back .wm{position:absolute;width:68mm;top:8mm;left:7mm;pointer-events:none}.back .wm svg{width:100%;height:auto}' +
    '.back h2{font-size:13px;letter-spacing:.5px;margin:3mm 4mm 1mm;position:relative}.qrbox{position:absolute;top:18mm;left:4mm;width:27mm;height:27mm;padding:1mm;border:1px solid #d8dbe7;border-radius:2mm;background:#fff;display:flex;align-items:center;justify-content:center}.qrbox svg{width:100%;height:100%}' +
    '.backinfo{position:absolute;left:34mm;right:3.5mm;top:18mm;font-size:8px;line-height:1.6}.backinfo strong{font-size:9px}.footer{position:absolute;bottom:3mm;right:4mm;font-size:7px;color:#474c62}' +
    '.draft{position:absolute;top:31mm;left:27mm;transform:rotate(-14deg);font-size:11px;font-weight:800;letter-spacing:2px;color:rgba(199,43,82,.64);border:1px solid rgba(199,43,82,.64);padding:1mm;z-index:4;pointer-events:none}' +
    '.print{display:block;margin:7mm auto 0;background:#152d68;color:white;border:0;border-radius:5px;padding:9px 16px;cursor:pointer}' +
    '@media print{body{padding:0;background:white}.sheet{margin:0}.caption,.intro,.print{display:none}.card{break-inside:avoid;page-break-inside:avoid;box-shadow:none}.slot{break-inside:avoid}}' +
    '</style></head><body>' +
    '<p class="intro"><b>DRAFT TEMPLATE - NOT AN ISSUED ID.</b> Original employee portrait and authorized HR approval required. QR links to the official website only; it does not verify employee identity. Print at <b>100% scale</b> (85.6 x 54 mm).</p>' +
    '<main class="sheet"><section class="slot"><p class="caption">FRONT - ISO ID-1</p><div class="card"><div class="bar"><img src="' + escapeHtml(options.logoUrl) +
    '" alt="FastQue official logo"><span class="brandtext">GOOD LOOKS · LESS WAITING</span></div><div class="accent"></div>' +
    '<div class="face">' + photo + '<div class="details"><div class="name">' + escapeHtml(employee.fullName) +
    '</div><div class="role">Field Executive</div><div class="meta"><span class="label">EMPLOYEE ID</span><br>' + escapeHtml(employee.employeeCode) +
    '</div><div class="meta"><span class="label">JOINED</span> ' + escapeHtml(dateLabel) +
    '</div><div class="meta"><span class="label">TERRITORY</span> ' + escapeHtml(employee.territory || "Not assigned") +
    '</div></div></div><div class="watermark">' + watermark + '</div><div class="bottom"><span>Fastque Digital Technology Private Limited</span><span>HR SIGNATURE / APPROVAL PENDING</span></div><div class="draft">DRAFT</div></div></section>' +
    '<section class="slot"><p class="caption">BACK - ISO ID-1</p><div class="card back"><div class="accent"></div><h2>FastQue · TEAM MEMBER</h2><div class="wm">' + watermark +
    '</div><div class="qrbox">' + qr + '</div><div class="backinfo"><strong>OFFICIAL WEBSITE</strong><br>Scan to visit fastque.com<br><br>Support: support@fastque.com<br>Property of Fastque Digital Technology Private Limited</div><div class="footer">If found, contact support@fastque.com</div><div class="draft">DRAFT</div></div></section></main>' +
    '<button class="print" onclick="window.print()">Print / Save as PDF (100% scale)</button></body></html>';
}
