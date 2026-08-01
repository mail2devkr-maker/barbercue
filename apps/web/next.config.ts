import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo: prevents Next.js from mis-inferring the workspace root when multiple
  // package-lock.json files exist in the tree (root + legacy-prototype/).
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
