import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const nextConfig: NextConfig = {
  // Empty Turbopack config so `next dev` (Turbopack) accepts the webpack config
  // that @serwist/next injects, instead of erroring on the mismatch. The service
  // worker is still built only by the webpack production build.
  turbopack: {},
};

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Serwist builds via webpack, which conflicts with Turbopack `next dev`.
  // Enable it only for the production build (`next build --webpack` / `npm run dev:pwa`);
  // plain `next dev` (Turbopack) runs without the service worker.
  disable: process.env.NODE_ENV !== 'production',
});

export default withSerwist(nextConfig);
