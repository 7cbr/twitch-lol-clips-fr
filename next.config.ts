import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { hostname: "clips-media-assets2.twitch.tv" },
      { hostname: "static-cdn.jtvnw.net" },
    ],
  },
  // NOTE: COOP/COEP headers removed — multi-threaded ffmpeg core disabled
  // (deadlocks on complex filter_complex). Re-add when re-enabling MT core.
};

export default nextConfig;
