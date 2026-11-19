import type { Metadata } from "next";

// Sign-in, account and staff screens are private: keep them out of search results. The page is
// still crawlable (no robots.txt block) so Google can actually see this noindex directive.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PrivateAreaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
