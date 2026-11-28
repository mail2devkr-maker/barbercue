import { isValidReviewProfileUrl, type ReviewProfileProvider } from "@barbercue/shared";
import type { ReviewSource, ReviewSourceDto, ReviewSourceState } from "@barbercue/shared";

// Owner review sources and external profile links (requirement #6) on Codex's docs/contracts/EXTERNAL_REVIEW_PROFILES_V1.md
// (PR #261, in the #265 integration):
//   GET dashboard/salons/:id/reviews?source=FASTQUE|GOOGLE|FACEBOOK|INSTAGRAM   -> { source, items, nextCursor, sources }
//   GET/PUT dashboard/salons/:id/review-profiles                              (PUT: { googleUrl?, facebookUrl?, instagramUrl? }, null clears)
//
// Only FastQue's own reviews are ever listed. A Google, Facebook or Instagram link is a link the owner typed in: FastQue does not
// fetch, count or show anything from those sites, and says so. A link is not proof that the profile belongs to the shop.

export const SOURCE_ORDER: ReadonlyArray<ReviewSource> = ["FASTQUE", "GOOGLE", "FACEBOOK", "INSTAGRAM"];

export interface ProviderInfo {
  source: Exclude<ReviewSource, "FASTQUE">;
  provider: ReviewProfileProvider;
  field: "googleUrl" | "facebookUrl" | "instagramUrl";
  label: string;
  example: string;
}

export const PROVIDERS: ReadonlyArray<ProviderInfo> = [
  { source: "GOOGLE", provider: "google", field: "googleUrl", label: "Google", example: "https://g.page/your-shop" },
  { source: "FACEBOOK", provider: "facebook", field: "facebookUrl", label: "Facebook", example: "https://www.facebook.com/your-shop" },
  { source: "INSTAGRAM", provider: "instagram", field: "instagramUrl", label: "Instagram", example: "https://www.instagram.com/your-shop/" },
];

export function sourceLabel(source: string): string {
  if (source === "FASTQUE") return "FastQue";
  return PROVIDERS.find((p) => p.source === source)?.label ?? source;
}

/** Reads the server's source list defensively; anything unknown is dropped. null means this server does not report sources. */
export function parseSources(raw: unknown): ReviewSourceDto[] | null {
  if (!Array.isArray(raw)) return null;
  const states: ReadonlyArray<string> = ["CONNECTED", "LINK_ONLY", "UNAVAILABLE"];
  const result: ReviewSourceDto[] = [];
  for (const row of raw) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.source !== "string" || !SOURCE_ORDER.includes(r.source as ReviewSource)) continue;
    if (typeof r.state !== "string" || !states.includes(r.state)) continue;
    result.push({
      source: r.source as ReviewSource,
      state: r.state as ReviewSourceState,
      profileUrl: typeof r.profileUrl === "string" && r.profileUrl.trim() !== "" ? r.profileUrl : null,
    });
  }
  return result;
}

export function stateText(state: ReviewSourceState): string {
  switch (state) {
    case "CONNECTED":
      return "Reviews shown here";
    case "LINK_ONLY":
      return "Link only";
    default:
      return "No link added";
  }
}

/** What an owner sees when they pick an outside source: only a link, never fetched reviews. */
export function externalSourceNote(label: string, hasLink: boolean): string {
  return hasLink
    ? `FastQue does not fetch, count or show reviews from ${label}. This is only the link you added, so you can open your ${label} page.`
    : `You have not added a ${label} link yet. FastQue does not fetch, count or show reviews from ${label}; add your link below if you want a shortcut to it.`;
}

export type ProfileForm = Record<ProviderInfo["field"], string>;

export function formFromSources(sources: ReadonlyArray<ReviewSourceDto> | null): ProfileForm {
  const url = (s: ReviewSource) => sources?.find((x) => x.source === s)?.profileUrl ?? "";
  return { googleUrl: url("GOOGLE"), facebookUrl: url("FACEBOOK"), instagramUrl: url("INSTAGRAM") };
}

export type ProfileErrors = Partial<Record<ProviderInfo["field"], string>>;

/** The link as the server will store it (trimmed, canonical), or the reason it will be refused. */
export function checkProfileUrl(info: ProviderInfo, text: string): { url: string | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { url: null, error: null };
  if (t.length > 500) return { url: null, error: "Use a link of at most 500 characters." };
  if (!/^https:\/\//i.test(t)) return { url: null, error: `Use a secure link that starts with https:// from ${info.label}.` };
  if (!isValidReviewProfileUrl(info.provider, t)) return { url: null, error: `That is not a ${info.label} page link. Paste the link to your shop's ${info.label} page.` };
  try {
    return { url: new URL(t).toString(), error: null };
  } catch {
    return { url: null, error: "That link could not be read." };
  }
}

/**
 * Only the links that changed, as the server's partial update takes them: a new link as text, a cleared box as null. Nothing
 * changed returns a null body (so no empty request is sent), and any invalid link returns its message instead.
 */
export function buildProfileUpdate(sources: ReadonlyArray<ReviewSourceDto> | null, form: ProfileForm): { body: Record<string, string | null> | null; errors: ProfileErrors } {
  const original = formFromSources(sources);
  const errors: ProfileErrors = {};
  const body: Record<string, string | null> = {};
  for (const info of PROVIDERS) {
    const checked = checkProfileUrl(info, form[info.field]);
    if (checked.error) {
      errors[info.field] = checked.error;
      continue;
    }
    const before = original[info.field].trim();
    const after = checked.url;
    if (after === null && before !== "") body[info.field] = null;
    else if (after !== null && after !== before) body[info.field] = after;
  }
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: Object.keys(body).length > 0 ? body : null, errors };
}

export function reviewProfileErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case "INVALID_REVIEW_SOURCE":
      return "That review source is not supported.";
    case "VALIDATION_ERROR":
      return "A link was not accepted. Use a secure https:// link to your own page on that site.";
    default:
      return message;
  }
}
