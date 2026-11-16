import type { NextConfig } from "next";

import { buildGlobalSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // Sized for 10 MiB max document uploads (issued-letters, activity-docs) + multipart overhead on Node.js container hosting
      bodySizeLimit: "16mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildGlobalSecurityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
};

export default nextConfig;
