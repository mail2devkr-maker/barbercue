import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CampaignCapture } from "../../components/booking/CampaignCapture";

// Public pages need no shared chrome here; the only addition is remembering a campaign code (`?fq_campaign=`) that an
// owner added to their shop's public link, so the booking flow can attribute the booking. See lib/campaign-token.ts.
// A cross-origin link from a public page never receives its address, only its origin, so a campaign code in the address cannot reach other sites.
export const metadata: Metadata = { referrer: "strict-origin-when-cross-origin" };

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CampaignCapture />
    </>
  );
}
