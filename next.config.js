/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ESM-only packages that need transpiling
  transpilePackages: ["franc", "p-limit", "linkedom"],

  // Don't bundle these server-side packages — let Node.js require them natively
  serverExternalPackages: [
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
};
module.exports = nextConfig;
