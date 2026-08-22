/**
 * Static export — the whole app is client-side, so GitHub Pages can serve it.
 * BASE_PATH is set by CI to the repo name; locally it stays empty.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  agentRules: false,
}
