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
