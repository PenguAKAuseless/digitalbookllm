import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack configuration for Next.js 16+
  turbopack: {
    resolveAlias: {
      canvas: './empty-module.js',
    },
  },
  // Webpack fallback for production builds
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
