/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Builds a plain static website (the app runs entirely in the browser).
  output: 'export',
  // On GitHub Pages the site lives at /ubo-mapper; locally it stays at /.
  basePath: process.env.PAGES_BASE_PATH || '',
};
module.exports = nextConfig;
