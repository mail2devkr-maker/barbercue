"use client";

import { QRCodeSVG } from "qrcode.react";
import { isValidGtin } from "@barbercue/shared";

// Barcode pictures are drawn from the stored barcode NUMBER (never from an uploaded picture), so the
// picture can never disagree with the number. The QR code is something else entirely: it carries the
// FastQue product id (fastque:product:<id>) for internal labels — it is not a retail barcode.

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => p.replace(/[01]/g, (b) => (b === "0" ? "1" : "0")));
const G = R.map((p) => p.split("").reverse().join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export const FASTQUE_QR_PREFIX = "fastque:product:";
export const productQrPayload = (productId: string) => `${FASTQUE_QR_PREFIX}${productId}`;
/** The product id inside a scanned FastQue QR code, or null for anything else. */
export function productIdFromQr(text: string): string | null {
  const m = text.trim().match(/^fastque:product:([0-9a-f-]{36})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Module pattern ("1" = bar) and which modules are guard bars, for EAN-13, UPC-A and EAN-8. */
export function eanModules(digits: string): { bits: string; guards: Set<number> } | null {
  if (!isValidGtin(digits)) return null;
  let code = digits;
  if (code.length === 12) code = `0${code}`; // UPC-A is EAN-13 with a leading 0
  if (code.length === 14) {
    if (!code.startsWith("0")) return null; // GTIN-14 (ITF-14) is not drawn here
    code = code.slice(1);
  }
  const guards = new Set<number>();
  const mark = (start: number, len: number) => {
    for (let i = 0; i < len; i++) guards.add(start + i);
  };
  let bits = "";
  if (code.length === 13) {
    const parity = PARITY[Number(code[0])];
    mark(0, 3);
    bits += "101";
    for (let i = 1; i <= 6; i++) bits += parity[i - 1] === "L" ? L[Number(code[i])] : G[Number(code[i])];
    mark(bits.length, 5);
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
    mark(bits.length, 3);
    bits += "101";
    return { bits, guards };
  }
  if (code.length === 8) {
    mark(0, 3);
    bits += "101";
    for (let i = 0; i < 4; i++) bits += L[Number(code[i])];
    mark(bits.length, 5);
    bits += "01010";
    for (let i = 4; i < 8; i++) bits += R[Number(code[i])];
    mark(bits.length, 3);
    bits += "101";
    return { bits, guards };
  }
  return null;
}

export function BarcodeSvg({ value, height = 56, module = 2 }: { value: string; height?: number; module?: number }) {
  const encoded = eanModules(value);
  if (!encoded) return <span title="This barcode type is shown as text only">{value}</span>;
  const quiet = 9 * module;
  const width = encoded.bits.length * module + quiet * 2;
  const rects: React.ReactNode[] = [];
  for (let i = 0; i < encoded.bits.length; i++) {
    if (encoded.bits[i] !== "1") continue;
    const h = encoded.guards.has(i) ? height + 8 : height;
    rects.push(<rect key={i} x={quiet + i * module} y={0} width={module} height={h} />);
  }
  return (
    <svg role="img" aria-label={`Barcode ${value}`} viewBox={`0 0 ${width} ${height + 22}`} width={width} height={height + 22} style={{ background: "#fff", color: "#000", maxWidth: "100%" }}>
      <g fill="#000">{rects}</g>
      <text x={width / 2} y={height + 20} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={13} fill="#000" letterSpacing={2}>
        {value}
      </text>
    </svg>
  );
}

export function ProductQr({ productId, size = 112 }: { productId: string; size?: number }) {
  return (
    <figure style={{ margin: 0, display: "grid", gap: 4, justifyItems: "center" }}>
      <QRCodeSVG value={productQrPayload(productId)} size={size} level="M" marginSize={2} bgColor="#ffffff" fgColor="#000000" aria-label="FastQue product QR code" role="img" />
      <figcaption style={{ fontSize: "0.72rem", opacity: 0.75 }}>FastQue product QR (not a retail barcode)</figcaption>
    </figure>
  );
}

/** Barcode picture(s) plus the internal QR, with each identifier labelled so they are never confused. */
export function ProductCodes({ productId, barcodes }: { productId: string; barcodes: Array<{ display: string; symbology?: string }> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      {barcodes.length === 0 ? (
        <p style={{ margin: 0 }}>No barcode on file.</p>
      ) : (
        barcodes.map((b) => (
          <figure key={b.display} style={{ margin: 0, display: "grid", gap: 4, justifyItems: "center" }}>
            <BarcodeSvg value={b.display} />
            <figcaption style={{ fontSize: "0.72rem", opacity: 0.75 }}>{b.symbology ?? "Barcode"} (retail barcode)</figcaption>
          </figure>
        ))
      )}
      <ProductQr productId={productId} />
      <div style={{ fontSize: "0.72rem", opacity: 0.75, alignSelf: "center", maxWidth: 220, overflowWrap: "anywhere" }}>
        Internal id: <code>{productId}</code>
      </div>
    </div>
  );
}
