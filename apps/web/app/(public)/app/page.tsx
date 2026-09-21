import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "../../../lib/seo";

export const metadata: Metadata = {
  title: "FastQue App",
  description: "Open FastQue on the web now and use this permanent app link for future Android app access.",
  alternates: { canonical: absoluteUrl("/app") },
  robots: { index: true, follow: true },
};

export default function FastQueAppPage() {
  return (
    <main style={{
      minHeight: "70vh",
      display: "grid",
      placeItems: "center",
      padding: "48px 20px",
      background: "radial-gradient(circle at 20% 10%, #3a071d 0, #120711 34%, #09080b 72%)",
      color: "#fff"
    }}>
      <section style={{
        width: "min(760px, 100%)",
        border: "1px solid rgba(255,255,255,.14)",
        borderRadius: 28,
        padding: "clamp(28px, 6vw, 56px)",
        background: "linear-gradient(145deg, rgba(255,0,102,.10), rgba(255,128,0,.06) 52%, rgba(255,255,255,.025))",
        boxShadow: "0 28px 90px rgba(255,48,96,.16)"
      }}>
        <p style={{letterSpacing: ".18em", textTransform: "uppercase", fontSize: 12, color: "#ffb073", fontWeight: 700}}>
          FastQue App
        </p>
        <h1 style={{fontSize: "clamp(44px, 8vw, 78px)", lineHeight: .96, margin: "14px 0 22px", letterSpacing: "-.05em"}}>
          Good looks.<br/>Less waiting.
        </h1>
        <p style={{fontSize: 18, lineHeight: 1.7, color: "#e6dfe4", maxWidth: 600}}>
          This is FastQue&apos;s permanent app access link. Use FastQue on the web today. When the public Android store listing is enabled, this same link can route customers to the app without changing printed QR codes.
        </p>
        <div style={{display:"flex", gap:12, flexWrap:"wrap", marginTop:28}}>
          <Link href="/" style={{background:"linear-gradient(90deg,#ff0a78,#ff7a22)", color:"#fff", textDecoration:"none", padding:"13px 20px", borderRadius:999, fontWeight:700}}>
            Open FastQue
          </Link>
          <Link href="/search" style={{border:"1px solid rgba(255,255,255,.22)", color:"#fff", textDecoration:"none", padding:"13px 20px", borderRadius:999, fontWeight:650}}>
            Find salons & barbers
          </Link>
        </div>
      </section>
    </main>
  );
}
