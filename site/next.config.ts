import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo runs the CLI's own layout engine from ../cli/src, so the root is the repo.
  turbopack: { root: path.join(__dirname, "..") },
};

export default nextConfig;
