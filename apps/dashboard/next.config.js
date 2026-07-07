/** @type {import('next').NextConfig} */

// Same-origin API proxy (backend-for-frontend). The browser only ever calls
// the dashboard's own origin at `/api/...` (see src/lib/api.ts's empty
// API_BASE); Next.js proxies those to the real API here. API_PROXY_TARGET
// points at the API's base URL — e.g. https://grafista-api-staging.onrender.com
// on Render staging — and MUST be present at BUILD time (Next.js bakes the
// rewrite destination into the routes manifest during `next build`; Render
// injects service env vars during the build, so setting it on the service is
// enough). Falls back to the local API for dev. Chosen in Production Step 19
// to avoid the split-origin cookie/CORS trap — see docs/deployment-runbook.md §28.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
