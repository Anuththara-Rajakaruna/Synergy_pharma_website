import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Content-Security-Policy is set dynamically (with a per-request nonce) in
        // src/proxy.ts so React hydration scripts can be allow-listed without 'unsafe-inline'.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // No `preload`: preloading would force HTTPS on every current and future subdomain.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        // Document downloads redirect to short-lived presigned storage URLs; never leak them
        // to the storage host via the Referer header. Later rules override earlier ones.
        source: "/api/admin/documents/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/careers/admin/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
