// Owner Marketing > Share: the public shop link, an invite message, and share targets (requirements #11, #14, #24).
//
// Everything here is an ordinary link the OWNER opens or sends themselves: a WhatsApp "send" page, the
// browser/OS share sheet, a Facebook share dialog. FastQue posts nothing on anyone's behalf, never claims a
// message was sent, and has no Instagram integration (Instagram has no web share link; the native share
// sheet or the copied link is how an owner posts there).

export interface PublicShopListing {
  id: string;
  slug: string;
  citySlug: string;
  countryCode: string;
  name: string;
}

export const INVITE_TEXT_MAX = 500;

/** The shop's public page path: /{country}/{city}/{shop}, the same route customers and search engines use. */
export function publicShopPath(shop: Pick<PublicShopListing, "countryCode" | "citySlug" | "slug">): string {
  return `/${shop.countryCode.toLowerCase()}/${shop.citySlug}/${shop.slug}`;
}

/** The listing for THIS shop among public directory results, or null when the shop is not publicly listed. */
export function findOwnListing<T extends Pick<PublicShopListing, "id">>(items: ReadonlyArray<T>, salonId: string): T | null {
  return items.find((item) => item.id === salonId) ?? null;
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

/** Only a shop that is ACTIVE has a public page worth sharing. */
export function isShareable(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}
