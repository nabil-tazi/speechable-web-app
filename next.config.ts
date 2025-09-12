import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },

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
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
