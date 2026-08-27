import type { Metadata } from "next";
import { Fraunces, Work_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../lib/auth-context";

// next/font self-hosts these at build time (no runtime request to Google, no layout shift) and
// exposes each as a CSS variable so globals.css can assign them without a hardcoded font stack
// living in two places. Fraunces (a warm, characterful serif with real editorial presence at
// display sizes) carries headings; Work Sans, a clean and slightly warmer alternative to the
// ubiquitous Inter/Helvetica-everywhere look, carries body copy and UI chrome — the pairing is the
// single biggest lever for "premium barbershop brand" over "generic SaaS dashboard".
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  // Fraunces' optical-size + soft axes are what give it character at large sizes without going
  // twee at small ones — both weights below lean on that rather than faux-bolding a single cut.
  weight: ["500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});
const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BarberCue",
    template: "%s | BarberCue",
  },
  description: "Find nearby barbershops, check the wait, and book your chair.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${workSans.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
