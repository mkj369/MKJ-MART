import type { NextConfig } from 'next';

/**
 * Static security headers applied to every response.
 * The Content-Security-Policy (with a per-request nonce) is set in `src/proxy.ts`.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  // Docker builds set BUILD_STANDALONE=1 to produce a self-contained server in .next/standalone.
  // Regular builds stay compatible with `npm start`.
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  // Allow remote preview/tunnel hosts to load dev assets (development only).
  allowedDevOrigins: ['*.e2b.app', '**.e2b.app'],
  images: {
    formats: ['image/webp'],
    qualities: [75, 85],
    // Only optimise our own catalogue imagery (demo assets + uploaded media).
    localPatterns: [
      { pathname: '/images/**', search: '' },
      { pathname: '/media/**', search: '' },
    ],
  },
  experimental: {
    // Product image uploads go through route handlers (multipart). Limit is enforced in code too.
    proxyClientMaxBodySize: '12mb',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
