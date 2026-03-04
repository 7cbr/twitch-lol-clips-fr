import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { hostname: "clips-media-assets2.twitch.tv" },
      { hostname: "static-cdn.jtvnw.net" },
    ],
  },
  headers: async () => [
    {
      source: "/montage",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      ],
    },
  ],
};

export default nextConfig;
