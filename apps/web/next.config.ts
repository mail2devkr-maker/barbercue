import type { NextConfig } from "next";
import path from "path";

// The browser talks to the web service only. API requests are reverse-proxied by Next.js to the
// backend so the httpOnly refresh cookie is first-party to the public web origin. This avoids
// relying on third-party cookies between Railway's separate *.up.railway.app service domains.
const backendOrigin = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // Monorepo: prevents Next.js from mis-inferring the workspace root when multiple
  // package-lock.json files exist in the tree (root + legacy-prototype/).
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    // BarberCue's own editorial asset library (apps/web/public/editorial/**) is hand-authored,
    // script-free SVG — next/image otherwise refuses to optimize any SVG at all (XSS protection,
    // since an SVG can embed <script>). The CSP below is the same mitigation Next's own docs
    // recommend when opting in: it strips any script capability from the optimizer's SVG response
    // regardless of source, so this stays safe even if a future editorial asset were mistakenly
    // less careful than these are.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendOrigin.replace(/\/+$/, "")}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
