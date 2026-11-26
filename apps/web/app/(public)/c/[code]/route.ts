import { NextResponse, type NextRequest } from "next/server";
import { VI_PATHS } from "@barbercue/shared";
import { fetchDiscoveryOrNull } from "../../../../lib/discovery-api";

/**
 * Campaign short links and QR codes (fastque.com/c/<code>): redirect to the campaign's landing page with its
 * UTM tags and campaign code, which the first-party tracker records (only with the visitor's consent).
 * Unknown or archived codes land on the home page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const safe = /^[a-z0-9-]{1,40}$/i.test(code) ? code.toLowerCase() : null;
  const resolved = safe ? await fetchDiscoveryOrNull<{ url: string }>(`${VI_PATHS.root}/c/${safe}`, 0).catch(() => null) : null;
  // Only ever redirect to a path on this site.
  const target = resolved?.url && resolved.url.startsWith("/") && !resolved.url.startsWith("//") ? resolved.url : "/";
  return NextResponse.redirect(new URL(target, request.url), 302);
}
