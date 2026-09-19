import type { NextConfig } from "next";
import path from "path";

// The browser talks to the web service only. API requests are reverse-proxied by Next.js to the
// backend so the httpOnly refresh cookie is first-party to the web origin and browser CORS never
// depends on the backend allowing localhost or Railway's generated domain directly.
//
// BACKEND_INTERNAL_URL is the preferred server-only target (Railway/private networking). For
// existing local worktrees that still set an absolute NEXT_PUBLIC_API_BASE_URL such as
// http://localhost:3000/api/v1 or a remote preview backend, preserve that value only as the
// SERVER-SIDE proxy target. The browser itself is forced to /api/v1 below, so the backend origin
// is never exposed as a cross-origin fetch target.
const configuredPublicApi = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const legacyBackendOrigin =
  configuredPublicApi && /^https?:\/\//i.test(configuredPublicApi)
    ? configuredPublicApi.replace(/\/api\/v1\/?$/i, "").replace(/\/+$/, "")
    : undefined;
const backendOrigin =
  process.env.BACKEND_INTERNAL_URL?.trim() || legacyBackendOrigin || "http://localhost:3000";

const nextConfig: NextConfig = {
  // Browser code must always use the same-origin proxy. This also covers older client modules
  // that still read NEXT_PUBLIC_API_BASE_URL directly instead of going through lib/api.ts.
  env: {
    NEXT_PUBLIC_API_BASE_URL: "/api/v1",
  },
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
