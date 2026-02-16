import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { hostname: "clips-media-assets2.twitch.tv" },
      { hostname: "static-cdn.jtvnw.net" },
    ],
  },
};

export default nextConfig;
