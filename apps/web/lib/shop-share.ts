import type { SalonShareLinksDto } from "@barbercue/shared";

// Owner Marketing > Share: the public shop link, an invite message, and share targets (requirements #11, #14, #24).
//
// Everything here is an ordinary link the OWNER opens or sends themselves: a WhatsApp "send" page, the
// browser/OS share sheet, a Facebook share dialog. FastQue posts nothing on anyone's behalf, never claims a
// message was sent, and has no Instagram integration (Instagram has no web share link; the native share
// sheet or the copied link is how an owner posts there).

export const INVITE_TEXT_MAX = 500;

export type ShareView =
  | { kind: "ready"; name: string; url: string }
  /** The shop is not open to the public, so there is no page worth sharing yet. */
  | { kind: "not-public"; name: string }
  /** The server has no trusted public address to build a link from, so no link is shown. */
  | { kind: "not-configured"; name: string };

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Turns the server's canonical share-link answer (GET dashboard/salons/:id/share-links) into what the page shows.
 * The link is the server's `publicUrl` and nothing else: it is never rebuilt from the browser's address or from a
 * name lookup, and it is shown only when the server says the shop is ready.
 */
export function classifyShareLinks(dto: SalonShareLinksDto): ShareView {
  const name = dto.metadata?.title || "Your shop";
  const reasons = dto.readiness?.reasons ?? [];
  if (dto.status !== "ACTIVE" || reasons.includes("SALON_NOT_PUBLIC")) return { kind: "not-public", name };
  if (!dto.readiness?.ready || !dto.publicUrl || !isHttpUrl(dto.publicUrl)) return { kind: "not-configured", name };
  return { kind: "ready", name, url: dto.publicUrl };
}

export function defaultInviteText(shopName: string): string {
  return `Book your visit at ${shopName} on FastQue: choose a time, or join the Live Queue and skip the wait.`;
}

/** Trims, collapses runs of blank lines and caps the length so a pasted essay cannot break a share link. */
export function cleanInviteText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, INVITE_TEXT_MAX);
}

/** The message plus the link, exactly as it will be sent. */
export function composeMessage(text: string, url: string): string {
  const body = cleanInviteText(text);
  return body ? `${body}\n${url}` : url;
}

/** wa.me opens WhatsApp (app or web) with the message ready; the owner picks the contact and presses send. */
export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(composeMessage(text, url))}`;
}

/** Facebook's share dialog for a link; the owner reviews and posts it. Nothing is posted by FastQue. */
export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

/** mailto: with a subject and the message, for an owner who wants to email the link. */
export function emailShareUrl(shopName: string, text: string, url: string): string {
  return `mailto:?subject=${encodeURIComponent(`Book at ${shopName} on FastQue`)}&body=${encodeURIComponent(composeMessage(text, url))}`;
}
