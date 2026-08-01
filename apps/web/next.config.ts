import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pliegue/tokens", "@pliegue/ui"],
};

export default nextConfig;
