"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { locationNudge, parseLocation, type LocationNudge as Nudge } from "../../lib/location-proposal";
import { Banner, BtnLink } from "./parts";

const COPY: Record<Nudge, { text: string; action: string | null }> = {
  missing: {
    text: "Customers can't see how far your shop is. Set your shop's location so FastQue shows the distance and lists you for nearby customers.",
    action: "Set shop location",
  },
  rejected: {
    text: "Your last shop location was not approved, so customers still can't see how far your shop is. Please send it again from inside the shop.",
    action: "Send location again",
  },
  pending: {
    text: "Your shop location has been sent and is waiting for FastQue approval. Distance shows to customers once it is approved.",
    action: null,
  },
};

/**
 * Owner report (14 Nov): only 6 of 108 active shops had a map pin, so most shops showed customers
 * no distance. Shown on the shop's Overview until the shop has an approved pin. Reads the same
 * owner-only location endpoint as the Location page; shows nothing if it can't be read.
 */
export function LocationNudge({ salonId }: { salonId: string }) {
  const [nudge, setNudge] = useState<Nudge | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.location}`;
    apiFetch<unknown>(path)
      .then((raw) => {
        if (!cancelled) setNudge(locationNudge(parseLocation(raw)));
      })
      .catch(() => {
        if (!cancelled) setNudge(null);
      });
    return () => {
      cancelled = true;
    };
  }, [salonId]);

  if (!nudge) return null;
  const copy = COPY[nudge];
  return (
    <Banner tone={nudge === "pending" ? "info" : "warn"}>
      📍 {copy.text}
      {copy.action && (
        <>
          {" "}
          <BtnLink small variant="primary" href={`/dashboard/salons/${salonId}/location`}>
            {copy.action}
          </BtnLink>
        </>
      )}
    </Banner>
  );
}
