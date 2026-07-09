import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Off: its floating "Open Next.js Dev Tools" button has an aria-label
  // that collides with short getByLabel() queries (e.g. 'To') in e2e tests
  // run against `next dev`. Compile/runtime error overlays still show.
  devIndicators: false,
}

export default nextConfig
