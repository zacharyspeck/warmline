import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the browser-extension source so /api/extension/download can zip it
  // in production (it lives outside the normal module graph).
  outputFileTracingIncludes: {
    "/api/extension/download": ["./extension/**/*"],
  },
};

export default nextConfig;
