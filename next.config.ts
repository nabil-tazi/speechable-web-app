import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ovhsrztvavugvoggpexz.supabase.co",
        port: "",
        pathname: "/storage/v1/object/**",
      },
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // Increased for larger PDFs
    },
  },

  // Exclude packages that need native binaries from server-side bundling
  serverExternalPackages: ["mupdf", "@sparticuz/chromium", "puppeteer-core"],

  // Empty turbopack config to silence the warning
  turbopack: {},
};

export default nextConfig;
