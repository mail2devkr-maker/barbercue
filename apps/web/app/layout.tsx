import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";
import "./theme-vars.css";
import "./theme-fixes.css";
import { THEME_BOOT_SCRIPT } from "../components/theme/ThemeSwitcher";
import { AuthProvider } from "../lib/auth-context";
import { SiteHeader } from "../components/layout/SiteHeader";
import { SiteFooter } from "../components/layout/SiteFooter";
import { HideOnOwnerShell } from "../components/layout/HideOnOwnerShell";
import { SITE_URL } from "../lib/seo";
import { UniqueVisitorTracker } from "../components/analytics/UniqueVisitorTracker";
import { MaintenanceOverlay } from "../components/layout/MaintenanceOverlay";

const SITE_DESCRIPTION =
  "Find salons, barbershops, beauty parlours and spas near you in India. Compare services and prices, book an appointment or join the live queue online with FastQue.";

export const metadata: Metadata = {
  // Resolves every relative canonical/OG URL against the public host (issue #429).
  metadataBase: new URL(SITE_URL),
  title: {
    default: "FastQue — book salons, barbers & beauty parlours near you",
    template: "%s | FastQue",
  },
  description: SITE_DESCRIPTION,
  applicationName: "FastQue",
  openGraph: {
    type: "website",
    siteName: "FastQue",
    locale: "en_IN",
    title: "FastQue — book salons, barbers & beauty parlours near you",
    description: SITE_DESCRIPTION,
    images: [{ url: "/brand/fastque-premium-3d-mark.png", alt: "FastQue" }],
  },
  twitter: { card: "summary", title: "FastQue", description: SITE_DESCRIPTION },
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
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
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
        <MaintenanceOverlay />
      </body>
    </html>
  );
}
