/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.CRM_BUILD_DIR || ".next",
  assetPrefix: process.env.LEGION_ASSET_PREFIX || '/_legion/crm',
  // The same build serves authenticated website embedding and standalone CRM.
  async rewrites() {
    return { beforeFiles: [{ source: '/_legion/crm/_next/:path*', destination: '/_next/:path*' }] };
  },
  // Keep ESM-only packages that need transpiling
  transpilePackages: ["franc", "p-limit", "linkedom"],

  // Next.js 14 uses experimental.serverComponentsExternalPackages
  experimental: {
    serverComponentsExternalPackages: [
      "crawlee",
      "got-scraping",
      "header-generator",
      "playwright",
      "playwright-core",
      "@sparticuz/chromium",
      "@crawlee/cheerio",
      "@crawlee/http",
      "@crawlee/core",
      "@crawlee/browser",
      "@apify/timeout",
      "compromise",
    ],
  },

  webpack: (config, { isServer }) => {
    // Prevent webpack from trying to bundle playwright/chromium — they're runtime-only
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : [config.externals]),
        "playwright",
        "playwright-core",
        "@sparticuz/chromium",
      ];
    }
    return config;
  },
};
module.exports = nextConfig;
