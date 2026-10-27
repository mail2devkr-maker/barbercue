/**
 * Types and pure rules for the administrator Owner Transfer screen. The server is always the authority; these helpers only
 * decide what the screen offers and say plainly why something is unavailable. Nothing here ever handles an invitation
 * token or a password: administrators never see either.
 */

export type TransferStatus = "PREPARED" | "VERIFIED" | "INVITED" | "COMPLETED" | "CANCELLED";

export type EvidenceKind =
  | "GOVERNMENT_ID"
  | "IN_PERSON_VISIT"
  | "BUSINESS_OR_SHOP_PROOF"
  | "CURRENT_OWNER_WRITTEN_CONSENT"
  | "REGISTERED_PHONE_CALLBACK";

export interface TransferHistoryEntry {
  action: string;
  at: string;
  actorEmail: string | null;
}

export interface OwnerTransfer {
  id: string;
  salonId: string;
  newEmail: string;
  status: TransferStatus;
  preparedByAdminId: string;
  verifiedByAdminId: string | null;
  verificationEvidence: EvidenceKind[];
  verifiedAt: string | null;
  inviteNotBefore: string | null;
  invitationExpiresAt: string | null;
  invitationCount: number;
  breakGlass: boolean;
  preparedAt: string;
  completedAt: string | null;
  history?: TransferHistoryEntry[];
}

export const EVIDENCE_OPTIONS: ReadonlyArray<{ kind: EvidenceKind; label: string; hint: string; counts: "identity" | "authority" | "supplementary" }> = [
  { kind: "GOVERNMENT_ID", label: "Government photo ID checked", hint: "Matches the person asking for ownership. Do not record the number.", counts: "identity" },
  { kind: "IN_PERSON_VISIT", label: "Met in person at the shop", hint: "An administrator or field employee met the person at the shop.", counts: "identity" },
  { kind: "BUSINESS_OR_SHOP_PROOF", label: "Business or shop proof checked", hint: "Licence, registration or similar document in the owner's name for this shop.", counts: "authority" },
  { kind: "CURRENT_OWNER_WRITTEN_CONSENT", label: "Current owner's written consent", hint: "The current owner agreed in writing to hand the shop over.", counts: "authority" },
  { kind: "REGISTERED_PHONE_CALLBACK", label: "Called the registered shop phone", hint: "Supplementary only. The shop's phone is public, so this never counts as proof.", counts: "supplementary" },
];

export const STATUS_LABEL: Record<TransferStatus, string> = {
  PREPARED: "Prepared - waiting for verification",
  VERIFIED: "Verified - invitation not sent",
  INVITED: "Invited - waiting for the recipient",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ACTION_LABEL: Record<string, string> = {
  SALON_OWNER_TRANSFER_PREPARED: "Prepared",
  SALON_OWNER_TRANSFER_VERIFIED: "Verified",
  SALON_OWNER_TRANSFER_INVITED: "Invitation sent",
  SALON_OWNER_TRANSFER_REINVITED: "Invitation sent again",
  SALON_OWNER_TRANSFER_COMPLETED: "Accepted - ownership moved",
  SALON_OWNER_TRANSFER_CANCELLED: "Cancelled",
};

export const OPEN_STATUSES: readonly TransferStatus[] = ["PREPARED", "VERIFIED", "INVITED"];
export const isOpen = (t: OwnerTransfer): boolean => OPEN_STATUSES.includes(t.status);

/** Identity AND authority are both required; a phone callback counts toward neither. Mirrors the server and the database. */
export function evidenceProblem(selected: readonly EvidenceKind[]): string | null {
  const has = (kind: EvidenceKind) => selected.includes(kind);
  if (!has("GOVERNMENT_ID") && !has("IN_PERSON_VISIT")) return "Add an identity check: government ID or an in-person visit.";
  if (!has("BUSINESS_OR_SHOP_PROOF") && !has("CURRENT_OWNER_WRITTEN_CONSENT")) return "Add proof of authority over the shop: business/shop proof or the current owner's written consent.";
  return null;
}

export const REFERENCE_MIN = 20;
export const JUSTIFICATION_MIN = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(email: string, confirm: string): string | null {
  const value = email.trim().toLowerCase();
  if (!EMAIL.test(value) || value.length > 254) return "Enter a valid e-mail address.";
  if (value !== confirm.trim().toLowerCase()) return "The two e-mail addresses do not match.";
  return null;
}

export interface VerifyView {
  /** The same person who prepared a transfer may verify it only through the audited break-glass exception. */
  needsBreakGlass: boolean;
  problem: string | null;
}

export function verifyProblem(args: { evidence: readonly EvidenceKind[]; reference: string; breakGlassJustification: string; needsBreakGlass: boolean }): string | null {
  const evidence = evidenceProblem(args.evidence);
  if (evidence) return evidence;
  if (args.reference.trim().length < REFERENCE_MIN) return `Describe who checked what, when and how (at least ${REFERENCE_MIN} characters). Never write a document number.`;
  if (args.needsBreakGlass && args.breakGlassJustification.trim().length < JUSTIFICATION_MIN) return `Break-glass needs a written justification of at least ${JUSTIFICATION_MIN} characters.`;
  return null;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function isExpired(iso: string | null, now = Date.now()): boolean {
  if (!iso) return true;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) || time <= now;
}

/** What the screen may offer next for a transfer, and why not when it cannot. */
export function nextStep(t: OwnerTransfer, now = Date.now()): { kind: "verify" | "invite" | "reinvite" | "wait" | "none"; note: string } {
  if (t.status === "PREPARED") return { kind: "verify", note: "A different administrator must verify the owner's identity and authority." };
  if (t.status === "VERIFIED") {
    if (t.inviteNotBefore && new Date(t.inviteNotBefore).getTime() > now) return { kind: "wait", note: `Break-glass cool-down: the invitation can be sent after ${formatWhen(t.inviteNotBefore)}.` };
    return { kind: "invite", note: "FastQue e-mails a single-use link to the destination address. Ownership moves only when its holder accepts." };
  }
  if (t.status === "INVITED") {
    if (!isExpired(t.invitationExpiresAt, now)) return { kind: "wait", note: `The link is live until ${formatWhen(t.invitationExpiresAt)}. Nothing has moved yet.` };
    if (t.invitationCount >= 3) return { kind: "none", note: "The limit of 3 invitations was reached. Cancel this transfer and verify again." };
    return { kind: "reinvite", note: "The link expired or was cancelled after an uncertain delivery. Send a new one with a written reason (at least 10 minutes after the last attempt)." };
  }
  return { kind: "none", note: t.status === "COMPLETED" ? "Ownership moved when the recipient accepted." : "This transfer was cancelled." };
}
