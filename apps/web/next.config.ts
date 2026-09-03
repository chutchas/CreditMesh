import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source rather than a build step, so
  // Next compiles them along with the app.
  transpilePackages: ['@creditmesh/core', '@creditmesh/adapters'],
};

export default nextConfig;
