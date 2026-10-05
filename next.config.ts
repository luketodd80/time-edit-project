import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev debug channel waits on a WebSocket. When that socket cannot connect,
  // React never hydrates and Accept / Reject / Override do nothing.
  experimental: {
    reactDebugChannel: false,
  },
};

export default nextConfig;
