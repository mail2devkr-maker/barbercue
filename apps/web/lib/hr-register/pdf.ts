import {
  buildOfferLetterPdf,
  loadFastQueLogoForPdf,
  type OfferLetterData,
} from "../../app/(dashboard)/dashboard/admin/crm/offer-letter";
import type { HrRegisterApi } from "./api";
import type { HrCreateOfferResult, HrOfferVersion, HrPdfEvent } from "./types";
import { newIdempotencyKey } from "../idempotency";

/**
 * Offer PDFs are always produced from a SAVED offer version: the permanent employee code, the
 * issue instant and the terms come back from the register, so a reprint of version N reproduces
 * the original letter. The visual design and the standard Expected Performance Incentive text come
 * unchanged from `buildOfferLetterPdf`.
 */

export type LetterContacts = HrCreateOfferResult["letter"];

export function offerLetterData(
  employeeCode: string,
  candidateName: string,
  offer: HrOfferVersion,
  contacts: LetterContacts,
): OfferLetterData {
  return {
    candidateName,
    email: contacts.email ?? undefined,
    phone: contacts.phone ?? undefined,
    address: contacts.address ?? undefined,
    role: offer.terms.role,
    employeeCode,
    issuedAt: offer.issuedAt,
    baseSalary: offer.terms.baseSalaryInr,
    salaryBasis: offer.terms.salaryBasis,
    salesTarget: offer.terms.salesTarget ?? undefined,
    incentiveBeyondTarget: offer.terms.incentiveBeyondTargetInr ?? undefined,
    joiningDate: offer.terms.proposedJoiningDate ?? undefined,
  };
}

export function pdfFileName(employeeCode: string, version: number): string {
  return `FastQue-Offer-${employeeCode}-v${version}.pdf`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This browser cannot fingerprint the PDF.");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function triggerPdfDownload(bytes: Uint8Array, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export type PdfOutcome = {
  filename: string;
  sha256: string;
  byteLength: number;
  /** Key used for the history call; reuse it when retrying so one download is recorded once. */
  idempotencyKey: string;
  /** False when the PDF was produced but the register could not record the history entry. */
  recorded: boolean;
  event: HrPdfEvent | null;
};

/**
 * Builds the PDF for one saved version, hands it to the browser, then records the history entry.
 * A recording failure never hides the fact that the PDF exists: the caller shows `recorded:false`
 * and may call `recordPdfHistory` again with the returned key.
 */
export async function generateOfferPdf(args: {
  api: HrRegisterApi;
  employeeCode: string;
  candidateName: string;
  offer: HrOfferVersion;
  contacts: LetterContacts;
  event: HrPdfEvent["event"];
  deliver?: (bytes: Uint8Array, filename: string) => void;
}): Promise<PdfOutcome> {
  const brand = await loadFastQueLogoForPdf();
  const bytes = buildOfferLetterPdf(offerLetterData(args.employeeCode, args.candidateName, args.offer, args.contacts), brand);
  const filename = pdfFileName(args.employeeCode, args.offer.version);
  const sha256 = await sha256Hex(bytes);
  (args.deliver ?? triggerPdfDownload)(bytes, filename);
  return recordPdfHistory(args.api, args.offer.id, { event: args.event, sha256, byteLength: bytes.byteLength }, filename, newIdempotencyKey());
}

export async function recordPdfHistory(
  api: HrRegisterApi,
  offerId: string,
  input: { event: HrPdfEvent["event"]; sha256: string; byteLength: number },
  filename: string,
  idempotencyKey: string,
): Promise<PdfOutcome> {
  const base = { filename, sha256: input.sha256, byteLength: input.byteLength, idempotencyKey };
  try {
    const event = await api.recordPdfEvent(offerId, input, idempotencyKey);
    return { ...base, recorded: true, event };
  } catch {
    return { ...base, recorded: false, event: null };
  }
}
