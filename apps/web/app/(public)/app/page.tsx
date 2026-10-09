import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "../../../lib/seo";
import { BrandLockup } from "../../../components/ui/BrandLockup";
import { FASTQUE_GOOGLE_PLAY_URL, PlayStoreQr } from "../../../components/layout/PlayStoreQr";

export const metadata: Metadata = {
  title: "FastQue Android App & Google Play QR",
  description:
    "Scan FastQue's direct Google Play QR. The Android app is being tested; installation becomes available after its public Play Store release.",
  alternates: { canonical: absoluteUrl("/app") },
  robots: { index: true, follow: true },
};

export default function FastQueAppPage() {
  return (
    <main
      style={{
        minHeight: "70vh",
        display: "grid",
        placeItems: "center",
        padding: "clamp(28px, 6vw, 70px) 18px",
        background: "radial-gradient(circle at 24% 8%, #3e0a24 0, #160a14 36%, #09080b 75%)",
        color: "#fff",
      }}
    >
      <section
        style={{
          width: "min(900px, 100%)",
          borderRadius: 28,
          padding: "clamp(22px, 5vw, 50px)",
          border: "1px solid rgba(255,255,255,.15)",
          background: "linear-gradient(140deg, rgba(255,0,117,.10), rgba(255,122,34,.07) 53%, rgba(255,255,255,.025))",
          boxShadow: "0 28px 90px rgba(255,48,96,.12)",
        }}
      >
        <div style={{ width: "min(410px, 100%)", marginBottom: 28 }}>
          <BrandLockup compact canonicalArtwork />
        </div>
        <p style={{ color: "#ffb87a", fontSize: 12, letterSpacing: ".15em", fontWeight: 700, textTransform: "uppercase" }}>
          FastQue for Android
        </p>
        <h1 style={{ fontSize: "clamp(32px, 6vw, 58px)", lineHeight: 1.08, letterSpacing: "-.04em", margin: "14px 0 16px" }}>
          Scan. Discover. Book.
        </h1>
        <p style={{ fontSize: 17, color: "#e9dfe6", lineHeight: 1.65, maxWidth: 710 }}>
          Scan the QR below to open FastQue directly on Google Play. This QR uses the real Android
          package link, not our website URL.
        </p>
        <div
          role="status"
          style={{
            margin: "24px 0",
            padding: "13px 16px",
            borderRadius: 12,
            background: "rgba(255,185,108,.10)",
            border: "1px solid rgba(255,185,108,.35)",
            color: "#ffe1bd",
            lineHeight: 1.55,
          }}
        >
          Android public release is still being prepared. The Google Play page or Install button
          may not be available to visitors until Google Play publishes the app.
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 30,
            padding: "clamp(16px, 4vw, 28px)",
            background: "rgba(255,255,255,.055)",
            border: "1px solid rgba(255,255,255,.13)",
            borderRadius: 23,
          }}
        >
          <div
            style={{
              padding: 12,
              borderRadius: 18,
              background: "#fff",
              boxShadow: "0 0 0 2px #fa357e, 0 0 0 5px rgba(255,154,45,.5), 0 18px 55px rgba(236,56,112,.22)",
              flexShrink: 0,
              maxWidth: "100%",
            }}
          >
            <PlayStoreQr size={248} />
          </div>
          <div style={{ flex: "1 1 235px", minWidth: 0 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 25 }}>FastQue on Google Play</h2>
            <p style={{ margin: "0 0 18px", lineHeight: 1.7, color: "#e6dae2" }}>
              Point your phone camera at the QR. Once the public release is live, the same link will
              show the FastQue listing and Install option on supported Android devices.
            </p>
            <a
              href={FASTQUE_GOOGLE_PLAY_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                borderRadius: 999,
                padding: "14px 18px",
                color: "#fff",
                fontWeight: 750,
                textDecoration: "none",
                background: "linear-gradient(95deg,#f20a83,#ff7a22)",
              }}
            >
              Open Google Play ↗
            </a>
            <p style={{ fontSize: 13, margin: "16px 0 0", color: "#d9c9d4", overflowWrap: "anywhere" }}>
              Android package: com.dcw.fastque
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
          <Link href="/" style={{ border: "1px solid rgba(255,255,255,.25)", color: "#fff", padding: "12px 20px", borderRadius: 999, textDecoration: "none" }}>
            Explore FastQue on the web
          </Link>
          <Link href="/search" style={{ border: "1px solid rgba(255,255,255,.25)", color: "#fff", padding: "12px 20px", borderRadius: 999, textDecoration: "none" }}>
            Find salons &amp; barbers
          </Link>
        </div>
      </section>
    </main>
  );
}
