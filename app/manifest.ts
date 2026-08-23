import type { MetadataRoute } from 'next'

/**
 * The whole thing is a static export that has everything it needs after the
 * first load — the piano, the hand model, the scores — so it may as well be
 * installable. Nothing here asks for anything the page does not already use.
 */
export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Piano Cat',
    short_name: 'Piano Cat',
    description: 'Mime a masterpiece at your webcam.',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    background_color: '#07060c',
    theme_color: '#0b0910',
    categories: ['music', 'entertainment'],
    icons: [
      { src: './icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: './apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
