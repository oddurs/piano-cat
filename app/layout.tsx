import type { Metadata, Viewport } from 'next'
import './globals.css'

// The origin only. Next resolves image paths against metadataBase *and*
// prefixes them with basePath, so putting the base path in both produced
// https://oddurs.github.io/piano-cat/piano-cat/opengraph-image.png
const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'https://oddurs.github.io'
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
const site = `${origin}${base}/`
const blurb = 'Mime a masterpiece at your webcam. Your hands are the hammers and the pedal; the cat has opinions.'

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: 'Piano Cat',
    template: '%s · Piano Cat',
  },
  description: blurb,
  applicationName: 'Piano Cat',
  keywords: ['webcam', 'piano', 'hand tracking', 'music', 'pixel art', 'toy'],
  authors: [{ name: 'Oddur Sigurdsson' }],
  // A performance is shared as a link, so the link has to look like something
  // when it lands somewhere. It cannot be a picture of *that* performance —
  // this is a static export with nowhere to render one — so it is a good
  // picture of the instrument instead.
  openGraph: {
    type: 'website',
    siteName: 'Piano Cat',
    title: 'Piano Cat',
    description: blurb,
    url: site,
    locale: 'en',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Piano Cat',
    description: blurb,
  },
}

export const viewport: Viewport = {
  themeColor: '#0b0910',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // the canvas is scaled to whole pixels; pinch-zoom on top of that smears it
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
