import type { ReactNode } from "react";
import { CampaignCapture } from "../../components/booking/CampaignCapture";

// Public pages need no shared chrome here; the only addition is remembering a campaign code (`?fq_campaign=`) that an
// owner added to their shop's public link, so the booking flow can attribute the booking. See lib/campaign-token.ts.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <CampaignCapture />
    </>
  );
}
