import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";
import { SiteHeader } from "../components/layout/SiteHeader";
import { SiteFooter } from "../components/layout/SiteFooter";
import { HideOnOwnerShell } from "../components/layout/HideOnOwnerShell";
import { UniqueVisitorTracker } from "../components/analytics/UniqueVisitorTracker";

export const metadata: Metadata = {
  title: {
    default: "FastQue",
    template: "%s | FastQue",
  },
  description: "Find nearby barbershops, check the wait, and book your chair.",
  icons: {
    icon: "/brand/fastque-premium-3d-mark.png",
    apple: "/brand/fastque-premium-3d-mark.png",
  },
};

// Build 12 physical retest: a real Android phone rendered the entire site with inverted colors —
// dark backgrounds, light text, a black/red hero — despite globals.css's `html { color-scheme:
// light }`. That CSS property alone isn't reliably honored by Android Chrome/WebView's automatic
// "force dark" page-darkening heuristic; a `<meta name="color-scheme">` tag in <head> is the
// documented, more broadly-respected opt-out. Next's `viewport` export is what renders that tag
// (colorScheme here, not the `metadata` export above, which has no such field).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#fffdf9",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Self-hosted brand fonts (see app/fonts.css): preload the Latin faces used above the fold. */}
        <link rel="preload" href="/fonts/fraunces-latin-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/work-sans-latin-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <UniqueVisitorTracker />
        <AuthProvider>
          <SiteHeader />
          {children}
          <HideOnOwnerShell>
            <SiteFooter />
          </HideOnOwnerShell>
        </AuthProvider>
      </body>
    </html>
  );
}
