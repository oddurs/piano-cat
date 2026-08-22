import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Piano Cat',
  description: 'Mime a masterpiece at your webcam. The cat handles the fingering.',
}
export const viewport: Viewport = { themeColor: '#0b0910' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
