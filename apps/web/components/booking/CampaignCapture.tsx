"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { parseCampaignParam, rememberCampaign, salonKeyFromPublicPath, sessionTokenStore } from "../../lib/campaign-token";

/**
 * Remembers a campaign code from the page address (`?fq_campaign=`) for this shop, in this tab's session only, so the
 * booking flow can send it as `attributionToken` when the customer confirms. It renders nothing, changes nothing in the
 * address, and only acts when the value has the bounded token shape. Pass `salonKey` where the shop is known (the booking
 * page); on public shop pages it is read from the path.
 */
export function CampaignCapture({ salonKey }: { salonKey?: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const token = parseCampaignParam(window.location.search);
    if (!token) return;
    const key = salonKey ?? salonKeyFromPublicPath(pathname ?? "");
    if (!key) return;
    rememberCampaign(sessionTokenStore(), key, token);
  }, [pathname, salonKey]);
  return null;
}
