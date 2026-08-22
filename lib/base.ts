/**
 * Public asset prefix. Empty in dev; on GitHub Pages the site lives under
 * /<repo>/, so anything we fetch by hand needs this in front of it.
 */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
