import type { Metadata } from "next";
import { PublicQueueJoinFlow } from "../../../../components/queue/PublicQueueJoinFlow";

interface PublicQueuePageParams {
  publicQueueToken: string;
}

// Scan-and-join page — never indexable (same reasoning as /queue/[salonSlug]: per-visit,
// customer-specific, not discovery content).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublicQueuePage({
  params,
}: {
  params: Promise<PublicQueuePageParams>;
}) {
  const { publicQueueToken } = await params;
  return <PublicQueueJoinFlow token={publicQueueToken} />;
}
