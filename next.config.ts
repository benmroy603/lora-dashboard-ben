import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  output: 'export',
  basePath: '/lora-dashboard-ben',
};

export default nextConfig;
