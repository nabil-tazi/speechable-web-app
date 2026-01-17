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

  // Exclude MuPDF from server-side bundling so it loads WASM correctly
  serverExternalPackages: ["mupdf"],

  // Empty turbopack config to silence the warning
  turbopack: {},
};

export default nextConfig;
