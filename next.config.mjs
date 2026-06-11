/** @type {import('next').NextConfig} */
const nextConfig = {
  /* Pure static export: the site is HTML + a WebGL canvas, no server needed. */
  output: 'export',
  reactStrictMode: true,
};

export default nextConfig;
