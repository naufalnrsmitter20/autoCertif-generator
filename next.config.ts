import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "pdf-lib", "inngest"],
};

export default nextConfig;
