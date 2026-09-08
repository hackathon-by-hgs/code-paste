import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js and only the node_modules
  // actually reached at runtime, so the container image does not carry the
  // build toolchain. `public` and `.next/static` are not included by design and
  // are copied in explicitly by the Dockerfile.
  output: "standalone",
};

export default nextConfig;
