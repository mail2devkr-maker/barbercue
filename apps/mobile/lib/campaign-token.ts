// Same rules as apps/web/lib/campaign-token.ts (the parts an owner needs to BUILD a campaign link).
// The token is an attribution marker, not a credential; the server alone validates it.

export const CAMPAIGN_QUERY_KEY = 'fq_campaign';

/** The server issues 43-character base64url tokens and accepts 40 to 128 characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,128}$/;

export function isValidCampaignToken(value: string): boolean {
  return TOKEN_RE.test(value);
}
