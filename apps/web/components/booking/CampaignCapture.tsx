"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { parseCampaignParam, recallCampaign, rememberCampaign, salonKeyFromPublicPath, sessionTokenStore, withoutCampaignParam } from "../../lib/campaign-token";

/**
 * Remembers a campaign code from the page address (`?fq_campaign=`) for this shop, in this tab's session only, so the
 * booking flow can send it as `attributionToken` when the customer confirms. It renders nothing and only acts when the
 * value has the bounded token shape. Once the code is safely remembered it is removed from the address bar, so later
 * navigation, referrers and a re-shared page address do not carry it; if the code could not be remembered (blocked
 * storage) the address is left alone so a reload still works. Pass `salonKey` where the shop is known (the booking page);
 * on public shop pages it is read from the path.
 */
export function CampaignCapture({ salonKey }: { salonKey?: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const token = parseCampaignParam(window.location.search);
    if (!token) return;
    const key = salonKey ?? salonKeyFromPublicPath(pathname ?? "");
    if (!key) return;
    const store = sessionTokenStore();
    rememberCampaign(store, key, token);
    if (recallCampaign(store, key) !== token) return;
    try {
      const { pathname: path, search, hash } = window.location;
      window.history.replaceState(window.history.state, "", `${path}${withoutCampaignParam(search)}${hash}`);
    } catch {
      /* the address keeps the code; nothing else is affected */
    }
  }, [pathname, salonKey]);
  return null;
}
