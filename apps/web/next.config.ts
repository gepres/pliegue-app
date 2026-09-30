import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pliegue/tokens", "@pliegue/ui"],
  // El service worker se revisa en cada visita: si se sirviera desde caché, una versión nueva
  // tardaría en llegar a quien tiene la app instalada.
  async headers() {
    return [
      {
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
        source: "/sw.js",
      },
    ];
  },
};

export default nextConfig;
