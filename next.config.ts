import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required by the Phase 6 Dockerfile: emits .next/standalone so the runtime
  // stage can run the app without node_modules resolution from the repo root.
  output: "standalone",
};

export default nextConfig;
